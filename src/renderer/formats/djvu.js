// DjVu → "page source" for the page viewer (the interface is described in formats/pdf.js)
//
// The main path is djvu-rs (WebAssembly) in a background thread: it renders a page directly at the required
// resolution and provides a text layer. The TOC (bookmarks) is read by DjVu.js in the background, since djvu-rs lacks it.
// If djvu-rs cannot handle a file, a fallback runs entirely on DjVu.js.

import { loadDjVu } from '../lib.js';
import { t } from '../i18n.js';

export async function openDjvu(bytes) {
  // A copy for reading the TOC with DjVu.js (the original is transferred to the djvu-rs thread)
  const tocBytes = bytes.slice();
  try {
    return await openWithDjvuRs(bytes, tocBytes);
  } catch (err) {
    console.warn('djvu-rs could not open the file, falling back to DjVu.js:', err);
    return openWithDjvuJs(tocBytes);
  }
}

/* ---------- Main path: djvu-rs ---------- */

async function openWithDjvuRs(bytes, tocBytes) {
  const worker = new Worker(new URL('./djvu-worker.js', import.meta.url), { type: 'module' });
  let seq = 0;
  const pending = new Map();
  worker.onmessage = ({ data }) => {
    const call = pending.get(data.id);
    if (!call) return;
    pending.delete(data.id);
    if (data.error) call.reject(new Error(data.error));
    else call.resolve(data.result);
  };
  worker.onerror = (e) => {
    for (const call of pending.values()) call.reject(new Error(e.message || t('error.djvuWorker')));
    pending.clear();
  };
  const call = (type, payload = {}, transfer = []) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, ...payload }, transfer);
  });

  let info;
  try {
    // Transfer the buffer to the thread without copying if the bytes occupy all of it
    const own = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
    info = await call('open', { bytes: own }, [own.buffer]);
  } catch (err) {
    worker.terminate();
    throw err;
  }

  const native = info.pages;
  const sizes = native.map((p) => ({ width: (p.width / p.dpi) * 96, height: (p.height / p.dpi) * 96 }));

  const source = {
    meta: { title: '', author: '' },
    pageCount: info.pageCount,
    sizes,
    sizesReady: Promise.resolve(),
    toc: [],
    tocReady: null,
    async resolveDest() {
      return null;
    },

    async render(i, widthPx, signal) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const dpi = Math.max(10, Math.round((widthPx / native[i].width) * native[i].dpi));
      const { width, height, pixels } = await call('render', { page: i, dpi });
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d', { alpha: false }).putImageData(new ImageData(pixels, width, height), 0, 0);
      return canvas;
    },

    async pageText(i) {
      const { zones } = await call('text', { page: i, dpi: 72 });
      return (zones ?? []).filter(isWord).map((z) => `${z.t} `).join('');
    },

    async textLayer(i, container, cssScale) {
      // Resolution at which 1 zone pixel = 1 CSS pixel on screen
      const dpi = Math.max(10, Math.round(96 * cssScale));
      const k = (96 * cssScale) / dpi;
      const { zones } = await call('text', { page: i, dpi });
      container.replaceChildren();
      container.className = 'djvuTextLayer';
      if (!zones?.length) return;
      const ctx = measureContext();
      const fragment = document.createDocumentFragment();
      for (const z of zones) {
        if (!isWord(z)) continue;
        const fontSize = z.h * k * 0.85;
        ctx.font = `${fontSize}px sans-serif`;
        const measured = ctx.measureText(z.t).width || 1;
        const span = document.createElement('span');
        span.textContent = `${z.t} `;
        span.style.cssText = `left:${z.x * k}px;top:${z.y * k}px;font-size:${fontSize}px;transform:scaleX(${(z.w * k) / measured})`;
        fragment.append(span);
      }
      container.append(fragment);
    },

    destroy() {
      worker.terminate();
      for (const call of pending.values()) call.reject(new DOMException('Cancelled', 'AbortError'));
      pending.clear();
    },
  };

  // TOC in the background so it doesn't delay opening
  source.tocReady = readTocWithDjvuJs(tocBytes)
    .then((toc) => {
      source.toc = toc;
    })
    .catch((err) => console.warn('DjVu: failed to read the TOC', err));

  return source;
}

// Text zone shown in the text layer (and used for search)
const isWord = (z) => z.t?.trim() && z.w > 0 && z.h > 0;

let measureCanvas = null;
function measureContext() {
  measureCanvas ??= document.createElement('canvas');
  return measureCanvas.getContext('2d');
}

/* ---------- TOC via DjVu.js ---------- */

async function readTocWithDjvuJs(bytes) {
  const DjVu = await loadDjVu();
  const worker = new DjVu.Worker();
  try {
    await worker.createDocument(bytes.buffer);
    return await readToc(worker);
  } finally {
    worker.terminate();
  }
}

// Bookmarks (NAVM) with links like "#12" or "#page_name"
async function readToc(worker) {
  const contents = (await worker.doc.getContents().run()) ?? [];
  const convert = (items) => Promise.all(items.map(async (item) => {
    let page = null;
    if (item.url) {
      const num = await worker.doc.getPageNumberByUrl(item.url).run().catch(() => null);
      if (num) page = num - 1;
    }
    return {
      label: (item.description ?? '').replace(/\s+/g, ' ').trim() || '—',
      target: page !== null ? { page, f: 0 } : null,
      children: item.children?.length ? await convert(item.children) : undefined,
    };
  }));
  return convert(contents);
}

/* ---------- Fallback: everything on DjVu.js (slower, no text layer) ---------- */

const CACHE_PAGES = 3;   // how many full-size decoded pages to keep in memory

async function openWithDjvuJs(bytes) {
  const DjVu = await loadDjVu();
  const worker = new DjVu.Worker();
  try {
    await worker.createDocument(bytes.buffer);
  } catch (err) {
    worker.terminate();
    throw new Error(t('error.djvuRead', { message: err?.message ?? err }));
  }

  const pageCount = await worker.doc.getPagesQuantity().run();
  let rawSizes = [];
  try {
    rawSizes = await worker.doc.getPagesSizes().run();
  } catch (err) {
    console.warn('DjVu: failed to get page sizes', err);
  }
  const sizes = Array.from({ length: pageCount }, (_, i) => {
    const s = rawSizes[i] ?? rawSizes[0] ?? { width: 2480, height: 3508, dpi: 300 };
    const dpi = s.dpi > 0 ? s.dpi : 300;
    return { width: (s.width / dpi) * 96, height: (s.height / dpi) * 96 };
  });

  let toc = [];
  try {
    toc = await readToc(worker);
  } catch (err) {
    console.warn('DjVu: failed to read the TOC', err);
  }

  // Cache of decoded pages: page number → full-resolution ImageBitmap
  const cache = new Map();
  async function decode(i) {
    if (cache.has(i)) {
      const bitmap = cache.get(i);
      cache.delete(i);
      cache.set(i, bitmap);   // refresh the order (LRU)
      return bitmap;
    }
    const imageData = await worker.doc.getPage(i + 1).getImageData().run();
    const bitmap = await createImageBitmap(imageData);
    cache.set(i, bitmap);
    while (cache.size > CACHE_PAGES) {
      const [oldest, old] = cache.entries().next().value;
      cache.delete(oldest);
      old.close();
    }
    return bitmap;
  }

  return {
    meta: { title: '', author: '' },
    pageCount,
    sizes,
    sizesReady: Promise.resolve(),
    toc,
    async resolveDest() {
      return null;
    },

    async render(i, widthPx, signal) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const bitmap = await decode(i);
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(widthPx);
      canvas.height = Math.round((widthPx * bitmap.height) / bitmap.width);
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas;
    },

    destroy() {
      for (const bitmap of cache.values()) bitmap.close();
      cache.clear();
      worker.terminate();
    },
  };
}
