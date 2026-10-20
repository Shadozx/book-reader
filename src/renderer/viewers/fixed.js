// Page viewer for PDF/DjVu: scroll or paged mode (single page or spread),
// zoom, rendering of visible pages only, text layer and links (PDF).
//
// Location: { page, f, zoom, zoomPaged }: page number (0-based), scrolled fraction of the page,
// zoom in scroll mode and in paged mode.

import { h } from '../util.js';

const GAP = 16;                  // gap between pages, px
const MAX_RENDERED = 12;         // how many rendered pages to keep in memory
const MAX_AUTO = 1.25;           // "Auto": fit to window width, but at most 125% of the real size
const MIN_SPREAD_PAGE = 360;     // spread only if each page can be at least this wide, px
const MAX_CANVAS_PIXELS = 24e6;  // size limit for a single canvas (to avoid running out of memory at high zoom)
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// Whether a page is pictorial (colored or mostly dark: a cover, a photo).
// Such pages are not inverted in the dark theme, otherwise they look like a negative.
let sampleCanvas = null;
function isPictorial(canvas) {
  sampleCanvas ??= Object.assign(document.createElement('canvas'), { width: 48, height: 48 });
  const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, 48, 48);
  const { data } = ctx.getImageData(0, 0, 48, 48);
  let saturation = 0;
  let brightness = 0;
  for (let i = 0; i < data.length; i += 4) {
    const max = Math.max(data[i], data[i + 1], data[i + 2]);
    const min = Math.min(data[i], data[i + 1], data[i + 2]);
    saturation += (max - min) / 255;
    brightness += max / 255;
  }
  const n = data.length / 4;
  return saturation / n > 0.12 || brightness / n < 0.6;
}
const isAbort = (err) => err?.name === 'AbortError' || err?.name === 'RenderingCancelledException';

export function createFixedViewer({ source, container, settings, location: initial, onLocationChange, onTocChange }) {
  const count = source.pageCount;
  const sizes = source.sizes;

  /* ---------- DOM ---------- */

  const pagesEl = h('div', { class: 'fixed-pages' });
  const scroller = h('div', { class: 'fixed-scroller' }, pagesEl);
  const root = h('div', { class: 'fixed-view' }, scroller);
  container.replaceChildren(root);

  const pages = sizes.map((_, i) => ({
    el: h('div', { class: 'fixed-page', 'data-num': i + 1 }),
    canvas: null,
    renderedWidth: 0,
    textEl: null,
    linksDone: false,
    near: false,
  }));
  pagesEl.append(...pages.map((p) => p.el));

  /* ---------- State ---------- */

  let current = { ...settings };
  let mode = null;
  // Zoom per mode: 'auto' | 'width' | 'page' | number (1 = 100%)
  // (zoomV is the format version: zooms saved before "Auto" existed are not restored)
  const saved = initial?.zoomV === 2 ? initial : {};
  const zooms = { scroll: saved.zoom ?? 'auto', paged: saved.zoomPaged ?? 'page' };
  let scale = 1;                                // zoom of the current page
  const pageScales = new Array(count).fill(1);  // with "fit width"/"fit page" each page is fitted separately
  let columns = 1;
  let location = Number.isInteger(initial?.page) && initial.page >= 0 && initial.page < count
    ? { page: initial.page, f: clamp(initial.f ?? 0, 0, 1) }
    : { page: 0, f: 0 };
  let needsRestore = true;
  let anchored = false;
  let restoredScrollTop = 0;

  const isVisible = () => root.clientWidth > 0 && root.clientHeight > 0;

  /* ---------- Layout ---------- */

  function spreadPages(page) {
    if (columns === 1) return [page];
    // The first page (cover) alone, then pairs 2–3, 4–5…
    if (page === 0) return [0];
    const start = page % 2 === 1 ? page : page - 1;
    return [start, start + 1].filter((i) => i < count);
  }

  function computeLayout() {
    const width = scroller.clientWidth - 2 * GAP;
    const height = scroller.clientHeight - 2 * GAP;
    const zoom = zooms[mode];
    columns = mode === 'paged' && current.spread && count > 1 &&
      width > height * 1.15 && width >= 2 * MIN_SPREAD_PAGE + GAP ? 2 : 1;

    for (let i = 0; i < count; i++) {
      let s;
      if (typeof zoom === 'number') {
        s = zoom;
      } else {
        // Pages of a spread share one zoom
        const group = mode === 'paged' ? spreadPages(i) : [i];
        const pagesWidth = group.reduce((sum, j) => sum + sizes[j].width, 0);
        const maxHeight = Math.max(...group.map((j) => sizes[j].height));
        const fitWidth = (width - (group.length - 1) * GAP) / pagesWidth;
        if (zoom === 'page') s = Math.min(fitWidth, height / maxHeight);
        else if (zoom === 'auto') s = Math.min(fitWidth, MAX_AUTO);
        else s = fitWidth;
      }
      pageScales[i] = clamp(s, 0.05, 8);
      pages[i].el.style.width = `${Math.round(sizes[i].width * pageScales[i])}px`;
      pages[i].el.style.height = `${Math.round(sizes[i].height * pageScales[i])}px`;
    }
    scale = pageScales[location.page];
  }

  // Center the current page horizontally (if pages are wider than the window)
  function centerHorizontally() {
    const el = pages[location.page].el;
    scroller.scrollLeft = el.offsetLeft + el.offsetWidth / 2 - scroller.clientWidth / 2;
  }

  function showSpread(page) {
    const visible = new Set(spreadPages(page));
    pages.forEach((p, i) => p.el.classList.toggle('off', !visible.has(i)));
    location = { page: Math.min(...visible), f: 0 };
    scroller.scrollTop = 0;
  }

  /* ---------- Location ---------- */

  function scrollLocate() {
    const top = scroller.scrollTop + GAP / 2;
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const el = pages[mid].el;
      if (el.offsetTop + el.offsetHeight <= top) lo = mid + 1;
      else hi = mid;
    }
    const el = pages[lo].el;
    return { page: lo, f: clamp((top - el.offsetTop) / el.offsetHeight, 0, 1) };
  }

  function locate() {
    if (!isVisible() || needsRestore || anchored) return location;
    return mode === 'paged' ? location : scrollLocate();
  }

  function restore() {
    if (!isVisible()) return;
    needsRestore = false;
    anchored = true;
    computeLayout();
    if (mode === 'paged') {
      showSpread(location.page);
    } else {
      const el = pages[location.page].el;
      scroller.scrollTop = el.offsetTop + location.f * el.offsetHeight - (location.f === 0 ? GAP : 0);
      restoredScrollTop = scroller.scrollTop;
    }
    centerHorizontally();
    updateWanted();
    onLocationChange();
  }

  let locateTimer = 0;
  function locationChanged() {
    if (locateTimer) return;
    locateTimer = setTimeout(() => {
      locateTimer = 0;
      if (needsRestore || !isVisible()) return;
      if (!anchored) location = locate();
      updateWanted();
      onLocationChange();
    }, 30);
  }

  function goTo(target) {
    if (!target) return;
    if (target.page === undefined && target.dest !== undefined) {
      source.resolveDest(target.dest).then((resolved) => resolved && goTo(resolved));
      return;
    }
    if (!Number.isInteger(target.page)) return;
    location = { page: clamp(target.page, 0, count - 1), f: clamp(target.f ?? 0, 0, 1) };
    needsRestore = true;
    restore();
  }

  function flip(step) {
    anchored = false;
    const shown = spreadPages(location.page);
    const next = step > 0 ? shown[shown.length - 1] + 1 : shown[0] - 1;
    if (next < 0 || next >= count) return;
    showSpread(next);
    centerHorizontally();
    updateWanted();
    onLocationChange();
  }

  /* ---------- Page rendering ---------- */

  const wanted = new Set();
  let rendering = null;     // { index, controller }

  function targetWidth(i) {
    const css = sizes[i].width * pageScales[i];
    let px = Math.round(css * devicePixelRatio);
    const area = px * px * (sizes[i].height / sizes[i].width);
    if (area > MAX_CANVAS_PIXELS) px = Math.floor(Math.sqrt(MAX_CANVAS_PIXELS * (sizes[i].width / sizes[i].height)));
    return px;
  }

  function updateWanted() {
    wanted.clear();
    if (mode === 'paged') {
      const shown = spreadPages(location.page);
      shown.forEach((i) => wanted.add(i));
      // Prepare neighboring pages in advance
      const after = shown[shown.length - 1] + 1;
      const before = shown[0] - 1;
      for (const i of [after, after + 1, before, before - 1]) if (i >= 0 && i < count) wanted.add(i);
    } else {
      pages.forEach((p, i) => p.near && wanted.add(i));
    }
    if (rendering && !wanted.has(rendering.index)) rendering.controller.abort();
    releaseFar();
    pump();
  }

  function releaseFar() {
    const rendered = pages.map((p, i) => i).filter((i) => pages[i].canvas && !wanted.has(i));
    const total = pages.filter((p) => p.canvas).length;
    if (total <= MAX_RENDERED) return;
    rendered.sort((a, b) => Math.abs(b - location.page) - Math.abs(a - location.page));
    for (const i of rendered.slice(0, total - MAX_RENDERED)) {
      const p = pages[i];
      p.canvas.width = 0;
      p.canvas.remove();
      p.canvas = null;
      p.renderedWidth = 0;
      p.textEl?.remove();
      p.textEl = null;
      pageRanges.delete(i);
    }
  }

  async function pump() {
    if (rendering) return;
    // The page closest to the current one that needs to be (re)rendered
    let best = -1;
    for (const i of wanted) {
      if (pages[i].renderedWidth === targetWidth(i)) continue;
      if (best < 0 || Math.abs(i - location.page) < Math.abs(best - location.page)) best = i;
    }
    if (best < 0) return;

    const i = best;
    const p = pages[i];
    const width = targetWidth(i);
    const controller = new AbortController();
    rendering = { index: i, controller };
    p.el.classList.add('loading');
    try {
      const canvas = await source.render(i, width, controller.signal);
      if (!controller.signal.aborted) {
        if (p.canvas) {
          p.canvas.width = 0;
          p.canvas.remove();
        }
        p.canvas = canvas;
        p.renderedWidth = width;
        p.el.prepend(canvas);
        p.el.classList.toggle('pictorial', isPictorial(canvas));
        await decoratePage(i);
      }
    } catch (err) {
      if (!isAbort(err)) {
        console.error(`Не вдалося намалювати сторінку ${i + 1}`, err);
        p.renderedWidth = width;   // don't retry forever
        p.el.classList.add('failed');
      }
    } finally {
      p.el.classList.remove('loading');
      rendering = null;
    }
    pump();
  }

  // Text layer (selection and copying) and links: PDF only
  async function decoratePage(i) {
    const p = pages[i];
    if (source.textLayer) {
      if (!p.textEl) {
        p.textEl = h('div', { class: 'textLayer' });
        p.el.append(p.textEl);
      }
      try {
        await source.textLayer(i, p.textEl, pageScales[i]);
        onPageDecorated(i);
      } catch (err) {
        console.warn('Текстовий шар', i + 1, err);
      }
    }
    if (source.links && !p.linksDone) {
      p.linksDone = true;
      try {
        const links = await source.links(i);
        if (links.length) {
          const layer = h('div', { class: 'link-layer' });
          for (const link of links) {
            const a = h('a', {
              class: 'page-link',
              style: `left:${link.x * 100}%;top:${link.y * 100}%;width:${link.w * 100}%;height:${link.h * 100}%`,
              title: link.url ?? '',
            });
            if (link.url) {
              a.href = link.url;
              a.target = '_blank';
            } else {
              a.href = '#';
              a.addEventListener('click', (e) => {
                e.preventDefault();
                goTo({ dest: link.dest });
              });
            }
            layer.append(a);
          }
          p.el.append(layer);
        }
      } catch (err) {
        console.warn('Посилання', i + 1, err);
      }
    }
  }

  // Which pages are near the viewport (in scroll mode)
  let wantedTimer = 0;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) pages[Number(entry.target.dataset.num) - 1].near = entry.isIntersecting;
    clearTimeout(wantedTimer);
    wantedTimer = setTimeout(() => mode === 'scroll' && updateWanted(), 40);
  }, { root: scroller, rootMargin: '100% 0px' });
  pages.forEach((p) => observer.observe(p.el));

  /* ---------- Search ---------- */

  let searchQuery = '';
  let searchToken = 0;
  let matches = [];               // [{ page, n }]: the n-th match on the page
  let matchIndex = -1;
  let pendingReveal = false;      // scroll to the match as soon as the page is rendered
  const pageTexts = new Map();    // page number → lowercase page text
  const pageRanges = new Map();   // page number → Ranges of matches in the text layer

  async function pageText(i) {
    if (!pageTexts.has(i)) {
      let text = '';
      try {
        text = (await source.pageText(i)).toLowerCase();
      } catch {
        // page without text
      }
      pageTexts.set(i, text);
    }
    return pageTexts.get(i);
  }

  // Finds matches in the text layer of a rendered page
  function highlightPage(i) {
    const layer = pages[i].textEl;
    if (!searchQuery || !layer) return;
    const nodes = [];
    let text = '';
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      nodes.push({ node: walker.currentNode, start: text.length });
      text += walker.currentNode.data;
    }
    text = text.toLowerCase();
    const ranges = [];
    const at = (pos) => nodes.findLast((n) => n.start <= pos);
    for (let pos = text.indexOf(searchQuery); pos >= 0; pos = text.indexOf(searchQuery, pos + searchQuery.length)) {
      const a = at(pos);
      const b = at(pos + searchQuery.length - 1);
      const range = document.createRange();
      range.setStart(a.node, pos - a.start);
      range.setEnd(b.node, pos + searchQuery.length - b.start);
      ranges.push(range);
    }
    pageRanges.set(i, ranges);
  }

  function currentRange() {
    const m = matches[matchIndex];
    const ranges = m && pageRanges.get(m.page);
    return ranges?.length ? ranges[Math.min(m.n, ranges.length - 1)] : null;
  }

  function paintMatches() {
    if (!window.CSS?.highlights) return;
    CSS.highlights.set('search-hit', new Highlight(...[...pageRanges.values()].flat()));
    const range = currentRange();
    if (range) CSS.highlights.set('search-current', new Highlight(range));
    else CSS.highlights.delete('search-current');
  }

  function scrollToRange(range) {
    const rect = range.getBoundingClientRect();
    if (!rect.height) return;
    const box = scroller.getBoundingClientRect();
    scroller.scrollTop += rect.top - box.top - scroller.clientHeight * 0.3;
    scroller.scrollLeft += rect.left - box.left - scroller.clientWidth / 2;
    anchored = false;
    locationChanged();
  }

  function revealMatch() {
    const m = matches[matchIndex];
    if (!m) return;
    const shown = mode === 'scroll' || !pages[m.page].el.classList.contains('off');
    const range = currentRange();
    if (shown && range) {
      paintMatches();
      scrollToRange(range);
      return;
    }
    pendingReveal = true;
    goTo({ page: m.page, f: 0 });
  }

  // Called after a page's text layer has been rendered
  function onPageDecorated(i) {
    if (!searchQuery) return;
    highlightPage(i);
    paintMatches();
    if (pendingReveal && matches[matchIndex]?.page === i) {
      pendingReveal = false;
      const range = currentRange();
      if (range) scrollToRange(range);
    }
  }

  async function search(query, onUpdate) {
    clearSearch();
    const q = query.trim().toLowerCase();
    if (!q || !source.pageText) return onUpdate?.({ count: 0, index: -1, done: true, noText: !source.pageText });
    searchQuery = q;
    const token = ++searchToken;
    let anyText = false;
    for (let i = 0; i < count; i++) {
      const text = await pageText(i);
      if (token !== searchToken) return;
      if (text) anyText = true;
      for (let pos = text.indexOf(q), n = 0; pos >= 0; pos = text.indexOf(q, pos + q.length), n++) {
        matches.push({ page: i, n });
      }
      // Show the first match from the current page right away, without waiting for the search to finish
      if (matchIndex < 0 && matches.length && matches.at(-1).page >= location.page) {
        matchIndex = matches.findIndex((m) => m.page >= location.page);
        pages.forEach((p, j) => p.textEl && highlightPage(j));
        revealMatch();
      }
      if (i % 10 === 9 || i === count - 1) {
        onUpdate?.({
          count: matches.length, index: matchIndex, done: i === count - 1,
          scanned: i + 1, total: count, noText: i === count - 1 && !anyText,
        });
        await new Promise((r) => setTimeout(r, 0));   // let the UI breathe
        if (token !== searchToken) return;
      }
    }
    if (matchIndex < 0 && matches.length) {
      matchIndex = 0;
      pages.forEach((p, j) => p.textEl && highlightPage(j));
      revealMatch();
      onUpdate?.({ count: matches.length, index: matchIndex, done: true });
    }
    paintMatches();
  }

  function searchStep(direction) {
    if (!matches.length) return { count: 0, index: -1 };
    matchIndex = (matchIndex + direction + matches.length) % matches.length;
    revealMatch();
    paintMatches();
    return { count: matches.length, index: matchIndex };
  }

  function clearSearch() {
    searchToken++;
    searchQuery = '';
    matches = [];
    matchIndex = -1;
    pendingReveal = false;
    pageRanges.clear();
    if (window.CSS?.highlights) {
      CSS.highlights.delete('search-hit');
      CSS.highlights.delete('search-current');
    }
  }

  /* ---------- Zoom ---------- */

  function setZoom(value) {
    location = locate();
    zooms[mode] = value;
    needsRestore = true;
    restore();
  }

  function zoomBy(direction) {
    const next = direction > 0
      ? ZOOM_STEPS.find((z) => z > scale * 1.01) ?? ZOOM_STEPS.at(-1)
      : [...ZOOM_STEPS].reverse().find((z) => z < scale * 0.99) ?? ZOOM_STEPS[0];
    setZoom(next);
  }

  /* ---------- Settings ---------- */

  const LAYOUT_KEYS = ['mode', 'spread'];

  function applySettings(s) {
    const layoutChanged = mode === null || LAYOUT_KEYS.some((k) => s[k] !== current[k]);
    if (layoutChanged && mode !== null) location = locate();
    current = { ...s };
    root.classList.toggle('invert', !!s.invertDark);
    if (!layoutChanged) return;
    mode = s.mode;
    root.classList.toggle('paged', mode === 'paged');
    if (mode === 'scroll') pages.forEach((p) => p.el.classList.remove('off'));
    needsRestore = true;
    if (isVisible()) restore();
  }

  /* ---------- Events ---------- */

  scroller.addEventListener('scroll', () => {
    if (mode !== 'scroll') return;
    if (anchored && Math.abs(scroller.scrollTop - restoredScrollTop) < 2) return;
    anchored = false;
    locationChanged();
  }, { passive: true });

  let wheelAccum = 0;
  let wheelLock = 0;
  scroller.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1 : -1);
      return;
    }
    if (mode !== 'paged') return;
    // If the page doesn't fit, scroll through it first, then turn the page
    const down = e.deltaY > 0;
    const canScroll = down
      ? scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1
      : scroller.scrollTop > 0;
    if (canScroll) return;
    e.preventDefault();
    const now = performance.now();
    if (now < wheelLock) return;
    wheelAccum += e.deltaY;
    if (Math.abs(wheelAccum) >= 40) {
      flip(wheelAccum > 0 ? 1 : -1);
      wheelAccum = 0;
      wheelLock = now + 200;
    }
  }, { passive: false });

  root.addEventListener('click', (e) => {
    if (mode !== 'paged' || e.target.closest('a') || window.getSelection().toString()) return;
    const rect = root.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    if (x < 0.25) flip(-1);
    else if (x > 0.75) flip(1);
  });

  function handleKey(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return false;
    const forward = ['ArrowRight', 'PageDown'].includes(e.key) || (e.key === ' ' && !e.shiftKey);
    const backward = ['ArrowLeft', 'PageUp'].includes(e.key) || (e.key === ' ' && e.shiftKey);
    if (e.key === 'Home' || e.key === 'End') {
      goTo({ page: e.key === 'Home' ? 0 : count - 1, f: 0 });
      return true;
    }
    if (mode === 'paged') {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        scroller.scrollBy({ top: e.key === 'ArrowDown' ? 60 : -60 });
        return true;
      }
      if (forward) flip(1);
      else if (backward) flip(-1);
      else return false;
      return true;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const page = locate().page + (e.key === 'ArrowRight' ? 1 : -1);
      goTo({ page: clamp(page, 0, count - 1), f: 0 });
      return true;
    }
    const page = scroller.clientHeight * 0.9;
    const delta = { ArrowDown: 60, ArrowUp: -60, PageDown: page, PageUp: -page, ' ': e.shiftKey ? -page : page }[e.key];
    if (delta === undefined) return false;
    scroller.scrollBy({ top: delta, behavior: e.key.startsWith('Arrow') ? 'instant' : 'smooth' });
    return true;
  }

  let lastSize = '';
  const resizeObserver = new ResizeObserver(() => {
    const size = `${root.clientWidth}x${root.clientHeight}`;
    if (size === lastSize || !isVisible()) return;
    const firstTime = lastSize === '';
    lastSize = size;
    if (!firstTime && !needsRestore) location = locate();
    needsRestore = true;
    restore();
  });
  resizeObserver.observe(root);

  // Once the exact sizes of all pages are known, rebuild while keeping the location
  source.sizesReady?.then(() => {
    if (!isVisible()) return;
    location = locate();
    needsRestore = true;
    restore();
  });

  applySettings(settings);

  /* ---------- Table of contents ---------- */

  let tocFlat = null;
  // The TOC may arrive later (DjVu reads it in the background)
  source.tocReady?.then(() => {
    tocFlat = null;
    onTocChange?.();
  });

  function currentTocIndex() {
    tocFlat ??= (() => {
      const flat = [];
      const walk = (items) => items.forEach((it) => { flat.push(it); if (it.children) walk(it.children); });
      walk(source.toc);
      return flat;
    })();
    let best = -1;
    tocFlat.forEach((item, i) => {
      const page = item.target?.page;
      if (Number.isInteger(page) && page <= location.page && (best < 0 || page >= tocFlat[best].target.page)) best = i;
    });
    return best;
  }

  // Current chapter (by TOC): from its page to the page of the next entry
  function chapterInfo() {
    const i = currentTocIndex();
    if (i < 0) return null;
    const start = tocFlat[i].target.page;
    let end = count;
    for (const item of tocFlat) {
      const page = item.target?.page;
      if (Number.isInteger(page) && page > start && page < end) end = page;
    }
    const pages = end - start;
    return {
      label: tocFlat[i].label,
      progress: clamp((location.page + location.f - start) / pages, 0, 1),
      page: location.page - start + 1,
      pages,
      remaining: Math.max(0, end - location.page - location.f),
      unit: 'pages',
    };
  }

  return {
    kind: 'fixed',
    pageCount: count,
    meta: source.meta,
    get toc() {
      return source.toc;
    },
    getLocation: () => ({ ...location, zoom: zooms.scroll, zoomPaged: zooms.paged, zoomV: 2 }),
    goTo,
    search,
    searchStep,
    clearSearch,
    progress() {
      const shown = mode === 'paged' ? spreadPages(location.page) : [location.page];
      const pageText = shown.length > 1 ? `${shown[0] + 1}–${shown[1] + 1}` : `${shown[0] + 1}`;
      const value = (location.page + location.f) / count;
      return { value: clamp(value, 0, 1), text: `${pageText} / ${count}` };
    },
    currentTocIndex,
    chapterInfo,
    readingPosition: () => ({ unit: 'pages', value: location.page + location.f }),
    applySettings,
    handleKey,
    get zoomValue() {
      return zooms[mode];
    },
    get scale() {
      return scale;
    },
    setZoom,
    zoomIn: () => zoomBy(1),
    zoomOut: () => zoomBy(-1),
    onShow() {
      if (needsRestore) restore();
    },
    destroy() {
      clearSearch();
      observer.disconnect();
      resizeObserver.disconnect();
      clearTimeout(locateTimer);
      clearTimeout(wantedTimer);
      rendering?.controller.abort();
      for (const p of pages) if (p.canvas) p.canvas.width = 0;
      root.remove();
      source.destroy();
    },
  };
}
