// PDF → "page source" for the page viewer (viewers/fixed.js)
//
// Page source:
//   meta: { title, author }
//   pageCount, sizes: [{ width, height }] — page size in CSS pixels at 100% zoom
//   sizesReady: Promise — resolves when the exact sizes of all pages are known
//   toc: [{ label, target: { page?, f?, dest? }, children? }]
//   render(i, widthPx, signal) → Promise<canvas>
//   textLayer?(i, container, cssScale), links?(i) → [{ x, y, w, h, url?, dest? }]
//   resolveDest(dest) → Promise<{ page, f } | null>
//   destroy()

import { loadPdfjs } from '../lib.js';

const BASE = 'app://bundle/node_modules/pdfjs-dist/';
const PDF_TO_CSS = 96 / 72;   // 1 typographic point = 4/3 CSS pixels

export async function openPdf(bytes) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: bytes,
    cMapUrl: `${BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${BASE}standard_fonts/`,
    wasmUrl: `${BASE}wasm/`,
    iccUrl: `${BASE}iccs/`,
    isEvalSupported: false,
    enableXfa: false,
  });
  task.onPassword = () => {
    task.destroy();
  };
  let pdf;
  try {
    pdf = await task.promise;
  } catch (err) {
    if (err?.name === 'PasswordException') throw new Error('PDF захищений паролем — такі файли поки не підтримуються');
    throw err;
  }

  const pageCount = pdf.numPages;
  const pageCache = new Map();
  const getPage = (i) => {
    if (!pageCache.has(i)) pageCache.set(i, pdf.getPage(i + 1));
    return pageCache.get(i);
  };
  const sizeOf = (page) => {
    const vp = page.getViewport({ scale: PDF_TO_CSS });
    return { width: vp.width, height: vp.height };
  };

  // First give every page the size of the first one, then refine in the background
  const first = sizeOf(await getPage(0));
  const sizes = Array.from({ length: pageCount }, () => ({ ...first }));
  const sizesReady = (async () => {
    const BATCH = 64;
    for (let start = 1; start < pageCount; start += BATCH) {
      const batch = [];
      for (let i = start; i < Math.min(pageCount, start + BATCH); i++) {
        batch.push(pdf.getPage(i + 1).then((page) => {
          sizes[i] = sizeOf(page);
          page.cleanup();
        }));
      }
      await Promise.all(batch);
    }
  })().catch((err) => console.warn('PDF: не вдалося отримати розміри сторінок', err));

  // Metadata
  let meta = { title: '', author: '' };
  try {
    const { info } = await pdf.getMetadata();
    meta = { title: (info?.Title ?? '').trim(), author: (info?.Author ?? '').trim() };
  } catch {
    // metadata is optional
  }

  async function resolveDest(dest) {
    try {
      const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
      if (!Array.isArray(explicit)) return null;
      const ref = explicit[0];
      const page = typeof ref === 'object' && ref !== null ? await pdf.getPageIndex(ref) : Number.isInteger(ref) ? ref : null;
      if (page === null || page < 0 || page >= pageCount) return null;
      // [ref, {name: 'XYZ'}, left, top, zoom]: top is in points from the bottom of the page
      let f = 0;
      if (explicit[1]?.name === 'XYZ' && typeof explicit[3] === 'number') {
        const vp = (await getPage(page)).getViewport({ scale: 1 });
        const [, y] = vp.convertToViewportPoint(0, explicit[3]);
        f = Math.min(Math.max(y / vp.height, 0), 1);
      }
      return { page, f };
    } catch {
      return null;
    }
  }

  // TOC from PDF bookmarks; page numbers are resolved in the background (for highlighting in the TOC)
  let toc = [];
  try {
    const outline = (await pdf.getOutline()) ?? [];
    const convert = (items) => items.map((item) => ({
      label: (item.title ?? '').replace(/\s+/g, ' ').trim() || '—',
      target: item.dest ? { dest: item.dest } : null,
      children: item.items?.length ? convert(item.items) : undefined,
    }));
    toc = convert(outline);
    const all = [];
    const walk = (items) => items.forEach((it) => { all.push(it); if (it.children) walk(it.children); });
    walk(toc);
    (async () => {
      for (const item of all) {
        if (!item.target?.dest) continue;
        const resolved = await resolveDest(item.target.dest);
        if (resolved) Object.assign(item.target, resolved);
      }
    })();
  } catch (err) {
    console.warn('PDF: не вдалося прочитати зміст', err);
  }

  return {
    meta,
    pageCount,
    sizes,
    sizesReady,
    toc,
    resolveDest,

    async render(i, widthPx, signal) {
      const page = await getPage(i);
      if (signal.aborted) throw new DOMException('Скасовано', 'AbortError');
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: widthPx / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const renderTask = page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport });
      const onAbort = () => renderTask.cancel();
      signal.addEventListener('abort', onAbort);
      try {
        await renderTask.promise;
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
      return canvas;
    },

    async textLayer(i, container, cssScale) {
      const page = await getPage(i);
      const viewport = page.getViewport({ scale: cssScale * PDF_TO_CSS });
      container.replaceChildren();
      container.style.setProperty('--total-scale-factor', viewport.scale);
      const layer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
        container,
        viewport,
      });
      await layer.render();
    },

    async pageText(i) {
      const page = await getPage(i);
      const content = await page.getTextContent();
      return content.items.map((item) => item.str ?? '').join('');
    },

    async links(i) {
      const page = await getPage(i);
      const annotations = await page.getAnnotations({ intent: 'display' });
      const vp = page.getViewport({ scale: 1 });
      return annotations
        .filter((a) => a.subtype === 'Link' && (a.dest || a.url))
        .map((a) => {
          const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
          return {
            x: Math.min(x1, x2) / vp.width,
            y: Math.min(y1, y2) / vp.height,
            w: Math.abs(x2 - x1) / vp.width,
            h: Math.abs(y2 - y1) / vp.height,
            url: a.url,
            dest: a.dest,
          };
        });
    },

    destroy() {
      // In pdf.js 6 the document has no destroy(), so close it via the loading task
      task.destroy();
    },
  };
}
