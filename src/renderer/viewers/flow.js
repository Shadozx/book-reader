// Text viewer for FB2/EPUB: scroll mode and paged mode.
//
// Location in the book: { c, b, f }
//   c is the part (section) index, b is the block (paragraph) index within it,
//   f is the fraction of the block already read (0..1).
// Such a location doesn't depend on the font, window size or mode.

import { h } from '../util.js';
import { t } from '../i18n.js';
import { describe, locate } from '../anchors.js';

// Blocks used to track the location (mostly "leaf" elements with text)
const BLOCK_SELECTOR = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', '.image', '.cover',
  'li:not(:has(p, div))', 'td:not(:has(p, div))', 'th:not(:has(p, div))',
  'div:not(:has(p, div, h1, h2, h3, h4, h5, h6, li, table, pre))',
].join(',');

// Settings that affect the text layout
const LAYOUT_KEYS = ['mode', 'fontFamily', 'fontSize', 'lineHeight', 'margin', 'maxWidth', 'indent', 'paraSpacing', 'align', 'spread'];

const PAGE_TOP = 36;        // text offset from the top in paged mode, px
const PAGE_BOTTOM = 48;     // from the bottom (the page number is there), px
const SPREAD_MIN = 900;     // minimum text width for two pages side by side, px

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// Saved highlights are painted with the CSS Custom Highlight API: one Highlight per colour, shared by
// every open book, each viewer adding and removing its own ranges
const highlightLayers = new Map();
function highlightLayer(color) {
  if (!highlightLayers.has(color)) {
    const layer = new Highlight();
    CSS.highlights.set(`hl-${color}`, layer);
    highlightLayers.set(color, layer);
  }
  return highlightLayers.get(color);
}

export function createFlowViewer({ book, container, settings, location: initialLocation, onLocationChange }) {
  const chunks = book.chunks;
  const totalSize = chunks.reduce((sum, ch) => sum + ch.size, 0);
  const sizeBefore = [];
  chunks.reduce((sum, ch, i) => ((sizeBefore[i] = sum), sum + ch.size), 0);

  /* ---------- DOM ---------- */

  // Hyphenation follows the book's language; books that don't declare one use Ukrainian rules
  // as before, so switching the interface language doesn't change how a book is laid out
  const bookLang = book.meta.lang || 'uk';

  // Scroll mode: the whole book as one strip
  const content = h('article', { class: 'book-content', lang: bookLang });
  const scroller = h('div', { class: 'flow-scroller', tabindex: '-1' }, content);

  // Paged mode: one part laid out in columns
  const strip = h('div', { class: 'book-content page-strip', lang: bookLang });
  const clip = h('div', { class: 'page-clip' }, strip);
  const footer = h('div', { class: 'page-footer' });
  const pagedView = h('div', { class: 'paged-view' }, clip, footer);

  const root = h('div', { class: 'flow' }, scroller, pagedView);
  container.replaceChildren(root);

  /* ---------- State ---------- */

  let current = { ...settings };
  let mode = null;
  let location = isValidLocation(initialLocation) ? { ...initialLocation } : { c: 0, b: 0, f: 0 };
  let needsRestore = true;           // restore the location as soon as the tab becomes visible
  // After a restore the location is "anchored" to a paragraph until the user scrolls:
  // this way several font changes in a row don't shift the reading position
  let anchored = false;
  let restoredScrollTop = 0;
  const paged = { chunk: -1, screen: 0, screens: 1, columns: 1, colWidth: 0, gap: 0, step: 0 };

  function isValidLocation(loc) {
    return loc && Number.isInteger(loc.c) && loc.c >= 0 && loc.c < chunks.length;
  }

  const isVisible = () => root.clientWidth > 0 && root.clientHeight > 0;

  /* ---------- Blocks and ids ---------- */

  const blockCache = new Map();
  function blocksOf(c) {
    if (!blockCache.has(c)) blockCache.set(c, [...chunks[c].el.querySelectorAll(BLOCK_SELECTOR)]);
    return blockCache.get(c);
  }

  let idIndex = null;   // data-id → { c, el }
  function findId(id) {
    if (!idIndex) {
      idIndex = new Map();
      chunks.forEach((ch, c) => {
        if (ch.el.dataset.id) idIndex.set(ch.el.dataset.id, { c, el: ch.el });
        for (const el of ch.el.querySelectorAll('[data-id]')) {
          if (!idIndex.has(el.dataset.id)) idIndex.set(el.dataset.id, { c, el });
        }
      });
    }
    // No anchor: go at least to the start of the matching section (chapter file)
    return idIndex.get(id) ?? (id.includes('#') ? idIndex.get(id.slice(0, id.indexOf('#'))) ?? null : null);
  }

  // Element location as { c, b, f: 0 }: the first block that is the element or follows it
  function locationOfElement(c, el) {
    const blocks = blocksOf(c);
    let b = blocks.findIndex((blk) => blk === el || el.contains(blk) || (el.compareDocumentPosition(blk) & Node.DOCUMENT_POSITION_FOLLOWING));
    if (b < 0) b = Math.max(0, blocks.length - 1);
    return { c, b, f: 0 };
  }

  /* ---------- Settings ---------- */

  function setCssVars(s) {
    const st = root.style;
    st.setProperty('--font', s.fontFamily);
    st.setProperty('--size', `${s.fontSize}px`);
    st.setProperty('--line', s.lineHeight);
    st.setProperty('--margin', `${s.margin}px`);
    st.setProperty('--width', s.maxWidth ? `${s.maxWidth}px` : '100000px');
    st.setProperty('--indent', `${s.indent}em`);
    st.setProperty('--pgap', `${s.paraSpacing}em`);
    st.setProperty('--align', s.align);
  }

  function applySettings(s) {
    const layoutChanged = mode === null || LAYOUT_KEYS.some((k) => s[k] !== current[k]);
    if (layoutChanged && isVisible() && mode !== null) location = findLocation();
    current = { ...s };
    setCssVars(s);
    if (!layoutChanged) return;
    closeNote();

    if (s.mode !== mode) {
      mode = s.mode;
      root.classList.toggle('paged', mode === 'paged');
      if (mode === 'scroll') {
        content.replaceChildren(...chunks.map((ch) => ch.el));
        paged.chunk = -1;
      } else {
        content.replaceChildren();
      }
    }
    needsRestore = true;
    if (isVisible()) restore();
  }

  /* ---------- Scroll mode ---------- */

  function scrollLocate() {
    const top = scroller.getBoundingClientRect().top + 1;
    let lo = 0;
    let hi = chunks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (chunks[mid].el.getBoundingClientRect().bottom <= top) lo = mid + 1;
      else hi = mid;
    }
    const c = lo;
    const blocks = blocksOf(c);
    if (!blocks.length) return { c, b: 0, f: 0 };
    lo = 0;
    hi = blocks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (blocks[mid].getBoundingClientRect().bottom <= top) lo = mid + 1;
      else hi = mid;
    }
    const r = blocks[lo].getBoundingClientRect();
    return { c, b: lo, f: r.height > 0 ? clamp((top - r.top) / r.height, 0, 1) : 0 };
  }

  // Sections far from the viewport have an estimated height (content-visibility: auto). If the browser
  // lays out neighboring sections after the jump, the text shifts. So sections around the target
  // are laid out immediately, at least two viewport heights up and down.
  let laidOut = new Set();
  function layOutAround(c) {
    const next = new Set([c]);
    const reach = scroller.clientHeight * 2;
    for (const step of [-1, 1]) {
      let height = 0;
      for (let i = c + step; i >= 0 && i < chunks.length && height < reach; i += step) {
        next.add(i);
        chunks[i].el.classList.add('cv-on');
        height += chunks[i].el.offsetHeight;
      }
    }
    chunks[c].el.classList.add('cv-on');
    for (const i of laidOut) if (!next.has(i)) chunks[i].el.classList.remove('cv-on');
    laidOut = next;
  }

  function scrollRestore(loc) {
    layOutAround(loc.c);
    const el = blocksOf(loc.c)[loc.b] ?? chunks[loc.c].el;
    const r = el.getBoundingClientRect();
    const top = scroller.getBoundingClientRect().top;
    scroller.scrollTop += r.top - top + loc.f * r.height;
  }

  /* ---------- Paged mode ---------- */

  function pagedLayout() {
    const width = root.clientWidth;
    const height = root.clientHeight;
    const margin = current.margin;
    const gap = Math.max(40, margin);
    const available = Math.max(200, width - 2 * margin);
    const columns = current.spread && available >= SPREAD_MIN ? 2 : 1;
    const maxCol = current.maxWidth || Infinity;
    const colWidth = Math.floor(Math.min(maxCol, (available - (columns - 1) * gap) / columns));
    const stripWidth = columns * colWidth + (columns - 1) * gap;

    clip.style.left = `${Math.round((width - stripWidth) / 2)}px`;
    clip.style.width = `${stripWidth}px`;
    clip.style.top = `${PAGE_TOP}px`;
    clip.style.height = `${height - PAGE_TOP - PAGE_BOTTOM}px`;
    strip.style.width = `${stripWidth}px`;
    strip.style.columnCount = columns;
    strip.style.columnGap = `${gap}px`;
    root.style.setProperty('--page-h', `${height - PAGE_TOP - PAGE_BOTTOM}px`);

    paged.columns = columns;
    paged.colWidth = colWidth;
    paged.gap = gap;
    paged.step = columns * (colWidth + gap);
  }

  function pagedMeasure() {
    const totalColumns = Math.max(1, Math.round((strip.scrollWidth + paged.gap) / (paged.colWidth + paged.gap)));
    paged.screens = Math.max(1, Math.ceil(totalColumns / paged.columns));
  }

  function showChunk(c) {
    if (paged.chunk !== c) {
      strip.replaceChildren(chunks[c].el);
      paged.chunk = c;
    }
    pagedMeasure();
  }

  function setScreen(screen) {
    paged.screen = clamp(screen, 0, paged.screens - 1);
    strip.style.transform = `translateX(${-paged.screen * paged.step}px)`;
    footer.textContent = `${paged.screen + 1} / ${paged.screens}`;
    locationChanged();
  }

  function pagedLocate() {
    const c = paged.chunk;
    const blocks = blocksOf(c);
    if (!blocks.length) return { c, b: 0, f: 0 };
    const left = clip.getBoundingClientRect().left + 1;
    const endsBefore = (el) => {
      const rects = el.getClientRects();
      return !rects.length || rects[rects.length - 1].right <= left;
    };
    let lo = 0;
    let hi = blocks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (endsBefore(blocks[mid])) lo = mid + 1;
      else hi = mid;
    }
    // How much of the block (by the height of its fragments in columns) remained on previous pages
    const rects = [...blocks[lo].getClientRects()];
    const total = rects.reduce((s, r) => s + r.height, 0);
    const before = rects.filter((r) => r.right <= left).reduce((s, r) => s + r.height, 0);
    return { c, b: lo, f: total > 0 ? before / total : 0 };
  }

  function pagedRestore(loc) {
    pagedLayout();
    showChunk(loc.c);
    const el = blocksOf(loc.c)[loc.b];
    let screen = 0;
    if (el) {
      const rects = [...el.getClientRects()];
      const total = rects.reduce((s, r) => s + r.height, 0);
      let acc = 0;
      let target = rects[0];
      for (const r of rects) {
        target = r;
        acc += r.height;
        if (acc > loc.f * total + 1) break;
      }
      if (target) {
        const x = target.left - strip.getBoundingClientRect().left;
        screen = Math.floor((x + 2) / paged.step);
      }
    }
    setScreen(screen);
  }

  function nextPage() {
    anchored = false;
    if (paged.screen < paged.screens - 1) setScreen(paged.screen + 1);
    else if (paged.chunk < chunks.length - 1) {
      showChunk(paged.chunk + 1);
      setScreen(0);
    }
  }

  function prevPage() {
    anchored = false;
    if (paged.screen > 0) setScreen(paged.screen - 1);
    else if (paged.chunk > 0) {
      showChunk(paged.chunk - 1);
      setScreen(paged.screens - 1);
    }
  }

  /* ---------- Shared: location, navigation, progress ---------- */

  function findLocation() {
    if (!isVisible() || needsRestore || anchored) return location;
    return mode === 'paged' ? pagedLocate() : scrollLocate();
  }

  function restore() {
    if (!isVisible()) return;
    needsRestore = false;
    anchored = true;
    if (mode === 'paged') {
      pagedRestore(location);
    } else {
      scrollRestore(location);
      restoredScrollTop = scroller.scrollTop;
    }
    onLocationChange();
  }

  // The location is recalculated with a short delay (not via requestAnimationFrame:
  // it doesn't fire while the window is minimized or covered)
  let locateTimer = 0;
  function locationChanged() {
    if (locateTimer) return;
    locateTimer = setTimeout(() => {
      locateTimer = 0;
      if (needsRestore || !isVisible()) return;
      if (!anchored) location = findLocation();
      onLocationChange();
    }, 30);
  }

  function goTo(target) {
    closeNote();
    let loc = null;
    if (target?.id) {
      const found = findId(target.id);
      if (found) loc = locationOfElement(found.c, found.el);
    } else if (isValidLocation(target)) {
      loc = target;
    }
    if (!loc) return;
    location = loc;
    needsRestore = true;
    restore();
  }

  // Text at the current location (for the bookmark label): headings are skipped since the chapter title is shown separately
  function snippet() {
    const blocks = blocksOf(location.c);
    const texts = [];
    let length = 0;
    for (let i = location.b; i < blocks.length && length < 90; i++) {
      if (/^H[1-6]$/.test(blocks[i].tagName)) continue;
      const t = blocks[i].textContent.replace(/\s+/g, ' ').trim();
      if (!t) continue;
      texts.push(t);
      length += t.length;
    }
    return texts.join(' ') || (blocks[location.b]?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function goToProgress(value) {
    const target = Math.min(Math.max(value, 0), 1) * totalSize;
    let c = chunks.findIndex((ch, i) => sizeBefore[i] + ch.size > target);
    if (c < 0) c = chunks.length - 1;
    const blocks = blocksOf(c).length;
    const within = Math.min(Math.max((target - sizeBefore[c]) / chunks[c].size, 0), 0.999);
    goTo({ c, b: Math.floor(within * blocks), f: 0 });
  }

  function progress() {
    const c = location.c;
    const blocks = blocksOf(c).length || 1;
    const within = clamp((location.b + location.f) / blocks, 0, 1);
    const value = totalSize ? (sizeBefore[c] + within * chunks[c].size) / totalSize : 0;
    const percent = `${Math.floor(value * 100)}%`;
    if (mode === 'paged') return { value, text: `${paged.screen + 1} / ${paged.screens} · ${percent}` };
    return { value, text: percent };
  }

  // Flat TOC in the same order as in the side panel
  let tocFlat = null;
  let tocLabels = [];
  function currentTocIndex() {
    if (!tocFlat) {
      tocFlat = [];
      tocLabels = [];
      const walk = (items) => items.forEach((item) => {
        const found = item.target?.id ? findId(item.target.id) : null;
        tocFlat.push(found ? locationOfElement(found.c, found.el) : null);
        tocLabels.push(item.label);
        if (item.children) walk(item.children);
      });
      walk(book.toc);
    }
    const before = (a, b) => a.c < b.c || (a.c === b.c && a.b <= b.b);
    let best = -1;
    tocFlat.forEach((pos, i) => {
      if (pos && before(pos, location) && (best < 0 || before(tocFlat[best], pos))) best = i;
    });
    return best;
  }

  // Location in text characters from the start of the book: more precise than counting paragraphs
  const blockOffsetCache = new Map();
  function charOffset(loc) {
    if (!blockOffsetCache.has(loc.c)) {
      const offsets = [];
      let sum = 0;
      for (const blk of blocksOf(loc.c)) {
        offsets.push(sum);
        sum += blk.textContent.length;
      }
      blockOffsetCache.set(loc.c, { offsets, total: sum || 1 });
    }
    const { offsets, total } = blockOffsetCache.get(loc.c);
    const length = blocksOf(loc.c)[loc.b]?.textContent.length ?? 0;
    const within = ((offsets[loc.b] ?? 0) + (loc.f || 0) * length) / total;
    return sizeBefore[loc.c] + clamp(within, 0, 1) * chunks[loc.c].size;
  }

  // Current chapter (by TOC) and how much of it has been read
  function chapterInfo() {
    const i = currentTocIndex();
    if (i < 0) return null;
    const start = charOffset(tocFlat[i]);
    let end = totalSize;
    for (const pos of tocFlat) {
      if (!pos) continue;
      const offset = charOffset(pos);
      if (offset > start + 1 && offset < end) end = offset;
    }
    const current = charOffset(location);
    return {
      label: tocLabels[i],
      progress: clamp((current - start) / Math.max(1, end - start), 0, 1),
      remaining: Math.max(0, end - current),
      unit: 'chars',
    };
  }

  /* ---------- Footnotes and links ---------- */

  let notePopup = null;
  let noteScrollTop = 0;

  function closeNote() {
    notePopup?.remove();
    notePopup = null;
  }

  const NOTE_MAX = 4000;   // text longer than this is no longer a footnote

  // Footnote content: the element itself, the nearest small block around the anchor,
  // or the text after an "empty" anchor up to the next marker
  function noteNodes(target) {
    for (let el = target; el && !el.classList.contains('chunk'); el = el.parentElement) {
      const len = el.textContent.trim().length;
      if (/^H[1-6]$/.test(el.tagName)) return null;          // this is a heading, not a note
      if (len >= 8 && len <= NOTE_MAX) return [el];
      if (len > NOTE_MAX) break;
    }
    const nodes = [];
    let total = 0;
    for (let n = target.nextSibling; n && total < NOTE_MAX; n = n.nextSibling) {
      if (n.nodeType === Node.ELEMENT_NODE && (n.dataset.id || n.querySelector('[data-id]'))) break;
      nodes.push(n);
      total += n.textContent.length;
    }
    const len = nodes.reduce((sum, n) => sum + n.textContent.trim().length, 0);
    return len >= 2 && len <= NOTE_MAX ? nodes : null;
  }

  function showNote(link, target) {
    const nodes = noteNodes(target);
    if (!nodes) return false;
    closeNote();
    const body = h('div');
    for (const n of nodes) body.append(n.cloneNode(true));
    body.querySelectorAll('[data-id]').forEach((e) => e.removeAttribute('data-id'));
    body.querySelector('.title')?.remove();
    const goBtn = h('button', { class: 'note-goto' }, t('book.goToNote'));
    goBtn.addEventListener('click', () => goTo({ id: target.dataset.id }));
    notePopup = h('div', { class: 'note-popup book-content' }, h('div', { class: 'note-body' }, ...body.childNodes), goBtn);
    root.append(notePopup);
    noteScrollTop = scroller.scrollTop;

    const linkRect = link.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const popupRect = notePopup.getBoundingClientRect();
    const left = clamp(linkRect.left - rootRect.left - popupRect.width / 2, 12, rootRect.width - popupRect.width - 12);
    let top = linkRect.bottom - rootRect.top + 8;
    if (top + popupRect.height > rootRect.height - 12) top = linkRect.top - rootRect.top - popupRect.height - 8;
    notePopup.style.left = `${left}px`;
    notePopup.style.top = `${Math.max(12, top)}px`;
    return true;
  }

  root.addEventListener('click', (e) => {
    if (notePopup?.contains(e.target)) return;
    const hadNote = !!notePopup;
    closeNote();

    const link = e.target.closest('a[data-href]');
    if (link) {
      e.preventDefault();
      const found = findId(link.dataset.href);
      if (!found) return;
      // An explicit footnote always opens in a popup; a "footnote-like" one only if the target isn't a heading
      const isNote = link.classList.contains('note-link') || link.classList.contains('maybe-note') ||
        found.el.closest('.chunk.notes, [data-note]');
      if (!(isNote && showNote(link, found.el))) goTo({ id: link.dataset.href });
      return;
    }
    if (e.target.closest('a[href]') || hadNote) return;
    // A click on a highlight belongs to the highlight, not to page turning
    if (highlightAt(e.clientX, e.clientY)) return;

    // A click on the page edges turns the page
    if (mode === 'paged' && !window.getSelection().toString()) {
      const rect = root.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      if (x < 0.3) prevPage();
      else if (x > 0.7) nextPage();
    }
  });

  /* ---------- Scrolling, wheel, keys ---------- */

  scroller.addEventListener('scroll', () => {
    if (notePopup && Math.abs(scroller.scrollTop - noteScrollTop) > 60) closeNote();
    if (mode !== 'scroll') return;
    if (anchored && Math.abs(scroller.scrollTop - restoredScrollTop) < 2) return;
    anchored = false;
    locationChanged();
  }, { passive: true });

  let wheelAccum = 0;
  let wheelLock = 0;
  pagedView.addEventListener('wheel', (e) => {
    if (e.ctrlKey) return;
    e.preventDefault();
    const now = performance.now();
    if (now < wheelLock) return;
    wheelAccum += e.deltaY || e.deltaX;
    if (Math.abs(wheelAccum) >= 40) {
      if (wheelAccum > 0) nextPage();
      else prevPage();
      wheelAccum = 0;
      wheelLock = now + 180;
      closeNote();
    }
  }, { passive: false });

  function handleKey(e) {
    if (e.key === 'Escape' && notePopup) {
      closeNote();
      return true;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return false;
    const forward = ['ArrowRight', 'ArrowDown', 'PageDown'].includes(e.key) || (e.key === ' ' && !e.shiftKey);
    const backward = ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key) || (e.key === ' ' && e.shiftKey);

    if (e.key === 'Home' || e.key === 'End') {
      const last = chunks.length - 1;
      goTo(e.key === 'Home' ? { c: 0, b: 0, f: 0 } : { c: last, b: Math.max(0, blocksOf(last).length - 1), f: 0 });
      return true;
    }
    if (mode === 'paged') {
      if (forward) nextPage();
      else if (backward) prevPage();
      else return false;
      closeNote();
      return true;
    }
    const line = 60;
    const page = scroller.clientHeight * 0.9;
    const delta = { ArrowDown: line, ArrowUp: -line, PageDown: page, PageUp: -page, ' ': e.shiftKey ? -page : page }[e.key];
    if (delta === undefined) return false;
    scroller.scrollBy({ top: delta, behavior: e.key.startsWith('Arrow') ? 'instant' : 'smooth' });
    return true;
  }

  /* ---------- Search ---------- */

  const MAX_MATCHES = 5000;
  const textIndex = new Map();   // part index → { raw, text (lowercase), nodes: [{ node, start }] }
  let matches = [];              // [{ c, range }]
  let matchIndex = -1;

  function indexOf(c) {
    if (!textIndex.has(c)) {
      const nodes = [];
      let text = '';
      const walker = document.createTreeWalker(chunks[c].el, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        nodes.push({ node: walker.currentNode, start: text.length });
        text += walker.currentNode.data;
      }
      textIndex.set(c, { raw: text, text: text.toLowerCase(), nodes });
    }
    return textIndex.get(c);
  }

  function rangeAt(nodes, start, length, Kind = Range) {
    const nodeAt = (pos) => {
      let lo = 0;
      let hi = nodes.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (nodes[mid].start <= pos) lo = mid;
        else hi = mid - 1;
      }
      return nodes[lo];
    };
    const a = nodeAt(start);
    const b = nodeAt(start + length - 1);
    if (Kind === StaticRange) {
      return new StaticRange({ startContainer: a.node, startOffset: start - a.start, endContainer: b.node, endOffset: start + length - b.start });
    }
    const range = document.createRange();
    range.setStart(a.node, start - a.start);
    range.setEnd(b.node, start + length - b.start);
    return range;
  }

  function paintMatches() {
    if (!window.CSS?.highlights) return;
    // Search is painted over saved highlights
    const hits = new Highlight(...matches.map((m) => m.range));
    hits.priority = 1;
    CSS.highlights.set('search-hit', hits);
    const current = matches[matchIndex];
    if (current) {
      const shown = new Highlight(current.range);
      shown.priority = 2;
      CSS.highlights.set('search-current', shown);
    } else {
      CSS.highlights.delete('search-current');
    }
  }

  function revealMatch(m) {
    closeNote();
    const node = m.range.startContainer.parentElement;
    const b = Math.max(0, blocksOf(m.c).findIndex((blk) => blk.contains(node)));
    location = { c: m.c, b, f: 0 };
    needsRestore = true;
    restore();
    const rect = m.range.getBoundingClientRect();
    if (mode === 'paged') {
      const x = rect.left - strip.getBoundingClientRect().left;
      anchored = false;
      setScreen(Math.floor((x + 2) / paged.step));
    } else {
      // The match is placed at about a third of the viewport height
      const blockRect = blocksOf(m.c)[b]?.getBoundingClientRect();
      if (blockRect?.height) {
        const f = (rect.top - blockRect.top - scroller.clientHeight * 0.3) / blockRect.height;
        location = { c: m.c, b, f: clamp(f, 0, 1) };
        needsRestore = true;
        restore();
      }
    }
  }

  async function search(query, onUpdate) {
    clearSearch();
    const q = query.trim().toLowerCase();
    if (!q) return onUpdate?.({ count: 0, index: -1, done: true });
    for (let c = 0; c < chunks.length && matches.length < MAX_MATCHES; c++) {
      const { text, nodes } = indexOf(c);
      for (let pos = text.indexOf(q); pos >= 0 && matches.length < MAX_MATCHES; pos = text.indexOf(q, pos + q.length)) {
        matches.push({ c, range: rangeAt(nodes, pos, q.length) });
      }
    }
    // The first match is searched from the current reading position
    matchIndex = matches.length ? Math.max(0, matches.findIndex((m) => m.c >= location.c)) : -1;
    paintMatches();
    if (matchIndex >= 0) revealMatch(matches[matchIndex]);
    onUpdate?.({ count: matches.length, index: matchIndex, done: true, capped: matches.length >= MAX_MATCHES });
  }

  function searchStep(direction) {
    if (!matches.length) return { count: 0, index: -1 };
    matchIndex = (matchIndex + direction + matches.length) % matches.length;
    paintMatches();
    revealMatch(matches[matchIndex]);
    return { count: matches.length, index: matchIndex };
  }

  function clearSearch() {
    matches = [];
    matchIndex = -1;
    if (window.CSS?.highlights) {
      CSS.highlights.delete('search-hit');
      CSS.highlights.delete('search-current');
    }
  }

  /* ---------- Highlights ---------- */

  // A part element moves between the scroll and paged containers, which collapses live Ranges.
  // Its text nodes stay the same, so highlights use StaticRange, which isn't affected by the move.
  // Highlights are kept in the order they were made, and a later one lies over an earlier one:
  // where they overlap only the later one is painted and gets the clicks.
  let marks = [];   // [{ id, color, c, start, end, ranges }]: ranges are the visible pieces

  const partTexts = () => chunks.map((_, c) => indexOf(c).raw);

  // Character offset of a DOM position within the text of part c
  function offsetIn(c, node, offset) {
    const range = document.createRange();
    range.setStart(chunks[c].el, 0);
    range.setEnd(node, offset);
    return range.toString().length;
  }

  const partOf = (node) => chunks.findIndex((ch) => ch.el.contains(node));

  // The text selected in this book as a highlight to save: { anchor, quote, prefix, suffix, rect },
  // or null. A selection over several parts is cut at the end of the first one.
  function selectionMark() {
    const selection = getSelection();
    if (!selection.rangeCount || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    const c = partOf(range.startContainer);
    if (c < 0) return null;
    const startOffset = offsetIn(c, range.startContainer, range.startOffset);
    const endOffset = chunks[c].el.contains(range.endContainer)
      ? offsetIn(c, range.endContainer, range.endOffset)
      : indexOf(c).raw.length;
    // Without the spaces a double-click or a drag picks up at the ends
    const raw = indexOf(c).raw;
    let start = startOffset;
    let end = endOffset;
    while (start < end && /\s/.test(raw[start])) start++;
    while (end > start && /\s/.test(raw[end - 1])) end--;
    if (start >= end) return null;
    return { ...describe(partTexts(), c, start, end), rect: range.getBoundingClientRect() };
  }

  function unpaint() {
    for (const m of marks) for (const r of m.ranges) highlightLayer(m.color).delete(r);
    marks = [];
  }

  // The pieces of a highlight not covered by later ones: [[start, end], …]
  function visiblePieces(mark, later) {
    let pieces = [[mark.start, mark.end]];
    for (const m of later) {
      if (m.c !== mark.c) continue;
      pieces = pieces.flatMap(([s, e]) => (m.end <= s || m.start >= e ? [[s, e]] : [[s, m.start], [m.end, e]].filter(([a, b]) => b > a)));
    }
    return pieces;
  }

  // A Range over a highlight's whole text (for its text and position on the screen)
  const wholeRange = (mark) => rangeAt(indexOf(mark.c).nodes, mark.start, mark.end - mark.start);

  // Finds the saved highlights in the text and paints them. Returns, for each one, where it was found
  // ({ id, status, anchor, quote, prefix, suffix }), or { id, status: 'lost' } if it wasn't.
  function setHighlights(list) {
    unpaint();
    const parts = partTexts();
    const found = [];
    for (const saved of list) {
      const where = locate(parts, saved);
      if (where.status === 'lost') {
        found.push({ id: saved.id, status: 'lost' });
        continue;
      }
      marks.push({ id: saved.id, color: saved.color, c: where.c, start: where.start, end: where.end, ranges: [] });
      found.push({ id: saved.id, status: where.status, ...describe(parts, where.c, where.start, where.end) });
    }
    marks.forEach((m, i) => {
      const nodes = indexOf(m.c).nodes;
      m.ranges = visiblePieces(m, marks.slice(i + 1)).map(([s, e]) => rangeAt(nodes, s, e - s, StaticRange));
      for (const r of m.ranges) highlightLayer(m.color).add(r);
    });
    return found;
  }

  // What is painted now: [{ id, color, text, shown, painted, rect }]
  // text: the whole highlight; shown: the pieces you can see (not covered by later highlights);
  // painted: all those pieces are in the colour's layer; rect: its first line on the screen
  function paintedHighlights() {
    return marks.map((m) => {
      const r = wholeRange(m).getClientRects()[0] ?? new DOMRect();
      const shown = m.ranges.map((s) => {
        const piece = document.createRange();
        piece.setStart(s.startContainer, s.startOffset);
        piece.setEnd(s.endContainer, s.endOffset);
        return piece.toString();
      });
      return {
        id: m.id,
        color: m.color,
        text: wholeRange(m).toString(),
        shown,
        painted: m.ranges.every((s) => highlightLayer(m.color).has(s)),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      };
    });
  }

  // The highlight under a point of the window: { id, rect } or null
  function highlightAt(x, y) {
    if (!marks.length) return null;
    const caret = document.caretPositionFromPoint(x, y);
    if (!caret || !root.contains(caret.offsetNode)) return null;
    const c = partOf(caret.offsetNode);
    if (c < 0) return null;
    const offset = offsetIn(c, caret.offsetNode, caret.offset);
    // The latest highlight at this point is the one on top
    const mark = marks.findLast((m) => m.c === c && offset >= m.start && offset < m.end);
    if (!mark) return null;
    return { id: mark.id, rect: wholeRange(mark).getBoundingClientRect() };
  }

  /* ---------- Resizing, image loading ---------- */

  let lastSize = '';
  const resizeObserver = new ResizeObserver(() => {
    const size = `${root.clientWidth}x${root.clientHeight}`;
    if (size === lastSize || !isVisible()) return;
    const firstTime = lastSize === '';
    lastSize = size;
    if (!firstTime && !needsRestore) location = findLocation();
    needsRestore = true;
    restore();
  });
  resizeObserver.observe(root);

  // A late-loading image changes the page count
  let imageTimer = 0;
  strip.addEventListener('load', () => {
    if (mode !== 'paged') return;
    clearTimeout(imageTimer);
    imageTimer = setTimeout(() => {
      const loc = findLocation();
      pagedMeasure();
      location = loc;
      needsRestore = true;
      restore();
    }, 50);
  }, true);

  applySettings(settings);

  return {
    kind: 'flow',
    meta: book.meta,
    toc: book.toc,
    getLocation: () => ({ ...location }),
    goTo,
    goToProgress,
    snippet,
    search,
    searchStep,
    clearSearch,
    selectionMark,
    setHighlights,
    highlightAt,
    paintedHighlights,
    progress,
    currentTocIndex,
    chapterInfo,
    readingPosition: () => ({ unit: 'chars', value: charOffset(location) }),
    applySettings,
    handleKey,
    onShow() {
      if (needsRestore) restore();
    },
    destroy() {
      clearSearch();
      unpaint();
      resizeObserver.disconnect();
      clearTimeout(locateTimer);
      clearTimeout(imageTimer);
      book.destroy();
      root.remove();
    },
  };
}
