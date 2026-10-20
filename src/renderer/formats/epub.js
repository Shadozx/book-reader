// EPUB → book model for the text viewer (the same as for FB2):
//   meta, chunks: [{ el, size }], toc: [{ label, target: { id }, children? }], destroy()
//
// Ids inside the book: "path/to/chapter.xhtml" for a chapter,
// "path/to/chapter.xhtml#anchor" for an element with an id.

import { loadJSZip } from '../lib.js';

const SPLIT_SIZE = 120_000;   // a chapter longer than this (in characters) is split into parts
const PIECE_SIZE = 60_000;

let bookCounter = 0;

/* ---------- Paths inside the archive ---------- */

function dirOf(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i + 1);
}

// Resolves a link relative to the base file. Returns { path, fragment }, or null for external links
function resolveHref(base, href) {
  if (!href) return null;
  href = href.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;          // http:, mailto:, data: etc.
  const hashAt = href.indexOf('#');
  const fragment = hashAt >= 0 ? decodeSafe(href.slice(hashAt + 1)) : '';
  const rel = (hashAt >= 0 ? href.slice(0, hashAt) : href).split('?')[0];
  if (!rel) return { path: base, fragment };
  const url = new URL(rel, `http://book/${dirOf(base)}`);
  return { path: decodeSafe(url.pathname.slice(1)), fragment };
}

function decodeSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const idKey = (path, fragment) => (fragment ? `${path}#${fragment}` : path);

/* ---------- XML/HTML parsing ---------- */

function parseMarkup(text, preferXml = true) {
  const parser = new DOMParser();
  if (preferXml) {
    const doc = parser.parseFromString(text, 'application/xhtml+xml');
    if (!doc.getElementsByTagName('parsererror').length) return doc;
  }
  return parser.parseFromString(text, 'text/html');
}

function parseXmlDoc(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Пошкоджений службовий файл EPUB');
  return doc;
}

const byLocalName = (root, name) => [...root.getElementsByTagName('*')].filter((e) => e.localName === name);
const childByName = (el, name) => el && [...el.children].find((c) => c.localName === name);

function attr(el, name) {
  // Namespaced attributes (epub:type, xlink:href): also look them up by local name
  if (el.hasAttribute(name)) return el.getAttribute(name);
  const local = name.split(':').pop();
  for (const a of el.attributes) if (a.localName === local) return a.value;
  return null;
}

/* ---------- Book stylesheet cleanup ---------- */

const ABSOLUTE_UNITS = /(px|pt|pc|cm|mm|in|q|rem)\s*$|^(xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)$/i;

function toEm(value) {
  const m = value.trim().match(/^(-?[\d.]+)(em|px|pt|%|rem)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch ((m[2] || '').toLowerCase()) {
    case 'em': case 'rem': return n;
    case 'px': return n / 16;
    case 'pt': return n / 12;
    case '%': return n / 100;
    case '': return n;
    default: return null;
  }
}

// Strips from declarations everything the user should control: fonts, colors, backgrounds,
// line height, paragraph indents and small gaps between paragraphs.
function sanitizeDeclarations(style, { isRoot = false } = {}) {
  const textAlign = style.getPropertyValue('text-align');
  for (const prop of [...style]) {
    const value = style.getPropertyValue(prop);
    let remove =
      prop === 'color' ||
      prop.startsWith('background') ||
      prop === 'line-height' ||
      prop === 'font-family' && !/monospace|courier|consolas/i.test(value) ||
      prop === 'font-size' && ABSOLUTE_UNITS.test(value) ||
      prop === 'position' && value === 'fixed' ||
      prop === 'user-select' || prop === '-webkit-user-select' ||
      // Border color comes from the theme text color; body text alignment is set by the user
      /^border-.*color$/.test(prop) ||
      prop === 'text-align' && /^(left|justify|start)$/i.test(value.trim()) ||
      /url\(/i.test(value);
    if (prop === 'text-indent') {
      // A negative indent (hanging line) and a zero one in centered blocks are part of the design
      const em = toEm(value);
      const keep = (em !== null && em < 0) || (em === 0 && /center|right/.test(textAlign));
      remove = !keep;
    }
    if (prop === 'margin-top' || prop === 'margin-bottom') {
      // Regular gaps between paragraphs are set by the user; large ones (scene breaks, headings) are kept
      const em = toEm(value);
      remove = em !== null && em <= 1.2;
    }
    if (isRoot && /^(margin|padding|width|max-width|min-width|height|max-height|min-height)/.test(prop)) remove = true;
    if (remove) style.removeProperty(prop);
  }
}

function splitSelectors(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((s) => s.trim()).filter(Boolean);
}

// "html body.x p" → ".epub-1.x p": the book's root elements become the chapter itself
function scopeSelector(sel, scope) {
  let rest = sel.trim();
  let rootCompound = '';
  for (const tag of [/^(:root|html)(?![\w-])/i, /^body(?![\w-])/i]) {
    rest = rest.replace(/^>\s*/, '');
    const m = rest.match(tag);
    if (!m) continue;
    rest = rest.slice(m[0].length);
    const compound = rest.match(/^[^\s>+~]*/)[0];
    rootCompound += compound;
    rest = rest.slice(compound.length).trim();
  }
  const scoped = `.${scope}${rootCompound}`;
  return rest ? { selector: `${scoped} ${rest}`, root: false } : { selector: scoped, root: true };
}

// Limits the book's CSS rules to its own chapters (the scope class); html/body/:root → the chapter itself
function scopeCss(cssText, scope) {
  const sheet = new CSSStyleSheet();
  try {
    sheet.replaceSync(cssText);
  } catch {
    return '';
  }
  const convert = (rules) => {
    let out = '';
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        let isRoot = false;
        const selectors = splitSelectors(rule.selectorText).map((sel) => {
          const { selector, root } = scopeSelector(sel, scope);
          if (root) isRoot = true;
          return selector;
        });
        sanitizeDeclarations(rule.style, { isRoot });
        if (rule.style.length) out += `${selectors.join(', ')} { ${rule.style.cssText} }\n`;
      } else if (rule instanceof CSSMediaRule) {
        const inner = convert(rule.cssRules);
        if (inner) out += `@media ${rule.conditionText} {\n${inner}}\n`;
      } else if (rule instanceof CSSSupportsRule) {
        const inner = convert(rule.cssRules);
        if (inner) out += `@supports ${rule.conditionText} {\n${inner}}\n`;
      }
      // @font-face, @import, @page etc. are dropped
    }
    return out;
  };
  return convert(sheet.cssRules);
}

/* ---------- Chapter markup cleanup and conversion ---------- */

const DROP_TAGS = new Set([
  'script', 'style', 'link', 'meta', 'title', 'base', 'iframe', 'frame', 'frameset', 'object', 'embed',
  'applet', 'form', 'input', 'button', 'select', 'textarea', 'noscript', 'audio', 'video', 'source', 'track', 'canvas',
]);

const NOTE_TYPES = /\b(footnote|endnote|rearnote|note)\b/;
const looksLikeNoteRef = (a) =>
  a.closest('sup') !== null || /^\s*[[(]?\s*(\d{1,4}|\*{1,3}|[a-z†‡§])\s*[\])]?\s*$/i.test(a.textContent);

class ChapterConverter {
  constructor(path) {
    this.path = path;
  }

  // Moves the body content into our document, stripping everything unsafe
  convert(srcBody, target) {
    for (const node of srcBody.childNodes) {
      const out = this.node(node);
      if (out) target.append(out);
    }
    return target;
  }

  node(src) {
    if (src.nodeType === Node.TEXT_NODE) return document.createTextNode(src.data);
    if (src.nodeType !== Node.ELEMENT_NODE) return null;
    const name = src.localName.toLowerCase();
    if (DROP_TAGS.has(name)) return null;

    const isSvg = src.namespaceURI === 'http://www.w3.org/2000/svg';
    if (isSvg && name === 'foreignobject') return null;
    const el = isSvg ? document.createElementNS('http://www.w3.org/2000/svg', src.localName) : document.createElement(name === 'body' ? 'div' : name);

    for (const a of src.attributes) {
      const an = a.localName.toLowerCase();
      const value = a.value;
      if (an.startsWith('on')) continue;
      if (an === 'id' || (an === 'name' && name === 'a')) {
        el.dataset.id = idKey(this.path, value);
        continue;
      }
      if (an === 'href' && (name === 'a' || name === 'area')) continue;   // handled below
      if (an === 'src' || (an === 'href' && name === 'image')) continue;   // images are handled below
      if (an === 'srcset' || an === 'xmlns' || a.name.startsWith('xmlns')) continue;
      if (an === 'style') {
        el.setAttribute('style', value);
        sanitizeDeclarations(el.style);
        continue;
      }
      if (an === 'type' && a.name.includes(':')) {                         // epub:type
        el.dataset.epubType = value;
        continue;
      }
      try {
        if (a.namespaceURI && isSvg) el.setAttributeNS(a.namespaceURI, a.name, value);
        else el.setAttribute(a.name.includes(':') ? an : a.name, value);
      } catch {
        // invalid attribute name: skip it
      }
    }

    if (name === 'a') this.link(src, el);
    if (name === 'img') this.image(src, el, attr(src, 'src'));
    if (isSvg && name === 'image') this.image(src, el, attr(src, 'xlink:href') ?? attr(src, 'href'));

    const epubType = el.dataset.epubType ?? '';
    const role = src.getAttribute('role') ?? '';
    if (NOTE_TYPES.test(epubType) || /doc-(foot|end)note/.test(role)) el.dataset.note = '';

    for (const child of src.childNodes) {
      const out = this.node(child);
      if (out) el.append(out);
    }
    return el;
  }

  link(src, el) {
    const href = attr(src, 'href');
    if (!href) return;
    const resolved = resolveHref(this.path, href);
    if (!resolved) {
      if (/^https?:\/\//i.test(href)) {
        el.setAttribute('href', href);
        el.setAttribute('target', '_blank');
      }
      return;
    }
    el.dataset.href = idKey(resolved.path, resolved.fragment);
    const epubType = attr(src, 'epub:type') ?? '';
    const role = src.getAttribute('role') ?? '';
    if (/noteref/.test(epubType) || role === 'doc-noteref') el.classList.add('note-link');
    else if (resolved.fragment && looksLikeNoteRef(src)) el.classList.add('maybe-note');
  }

  image(src, el, href) {
    const resolved = resolveHref(this.path, href);
    if (resolved) el.dataset.res = resolved.path;
  }
}

/* ---------- Splitting long chapters ---------- */

function splitChunk(chunk) {
  if (chunk.textContent.length <= SPLIT_SIZE) return [chunk];
  // Descend through "wrappers" that have a single child element
  let container = chunk;
  const wrappers = [];
  while (container.children.length === 1 && container.firstElementChild.children.length > 1) {
    container = container.firstElementChild;
    wrappers.push(container);
  }
  const children = [...container.childNodes];
  if (children.length < 2) return [chunk];

  const pieces = [];
  let piece = null;
  let size = 0;
  const startPiece = () => {
    const first = pieces.length === 0;
    const section = chunk.cloneNode(false);
    if (!first) delete section.dataset.id;
    let inner = section;
    for (const w of wrappers) {
      const copy = w.cloneNode(false);
      if (!first) delete copy.dataset.id;
      inner.append(copy);
      inner = copy;
    }
    pieces.push(section);
    piece = inner;
    size = 0;
  };
  startPiece();
  for (const child of children) {
    const len = child.textContent.length;
    if (size > PIECE_SIZE && size + len > PIECE_SIZE) startPiece();
    piece.append(child);
    size += len;
  }
  return pieces;
}

/* ---------- Table of contents ---------- */

function parseNavToc(doc, navPath) {
  const navs = byLocalName(doc, 'nav');
  const nav = navs.find((n) => /\btoc\b/.test(attr(n, 'epub:type') ?? '')) ?? navs[0];
  const ol = nav && childByName(nav, 'ol');
  const walk = (list) => [...list.children].filter((li) => li.localName === 'li').map((li) => {
    const a = childByName(li, 'a') ?? childByName(li, 'span');
    const sub = childByName(li, 'ol');
    const resolved = a && resolveHref(navPath, attr(a, 'href'));
    const item = {
      label: (a?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      target: resolved ? { id: idKey(resolved.path, resolved.fragment) } : null,
    };
    const children = sub ? walk(sub) : [];
    if (children.length) item.children = children;
    return item;
  }).filter((item) => item.label);
  return ol ? walk(ol) : [];
}

function parseNcxToc(doc, ncxPath) {
  const navMap = byLocalName(doc, 'navMap')[0];
  const walk = (el) => [...el.children].filter((c) => c.localName === 'navPoint').map((point) => {
    const label = byLocalName(childByName(point, 'navLabel') ?? point, 'text')[0]?.textContent ?? '';
    const src = childByName(point, 'content')?.getAttribute('src');
    const resolved = resolveHref(ncxPath, src);
    const item = {
      label: label.replace(/\s+/g, ' ').trim(),
      target: resolved ? { id: idKey(resolved.path, resolved.fragment) } : null,
    };
    const children = walk(point);
    if (children.length) item.children = children;
    return item;
  }).filter((item) => item.label);
  return navMap ? walk(navMap) : [];
}

/* ---------- Main function ---------- */

export async function parseEpub(bytes) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(bytes);

  // Case-insensitive file lookup: some EPUBs link to files with a different letter case
  const lowerIndex = new Map(Object.keys(zip.files).map((name) => [name.toLowerCase(), name]));
  const getFile = (path) => zip.file(path) ?? zip.file(lowerIndex.get(path.toLowerCase()) ?? '\0');
  const readText = async (path) => {
    const file = getFile(path);
    if (!file) throw new Error(`У книзі бракує файлу ${path}`);
    return file.async('string');
  };

  const container = parseXmlDoc(await readText('META-INF/container.xml'));
  const opfPath = byLocalName(container, 'rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) throw new Error('Не знайдено опис книги (content.opf)');
  const opf = parseXmlDoc(await readText(opfPath));

  // Manifest and chapter order
  const manifest = new Map();
  for (const item of byLocalName(opf, 'item')) {
    const resolved = resolveHref(opfPath, item.getAttribute('href'));
    if (!resolved) continue;
    manifest.set(item.getAttribute('id'), {
      path: resolved.path,
      type: item.getAttribute('media-type') ?? '',
      props: item.getAttribute('properties') ?? '',
    });
  }
  const spineEl = byLocalName(opf, 'spine')[0];
  const spine = byLocalName(opf, 'itemref')
    .map((ref) => manifest.get(ref.getAttribute('idref')))
    .filter((item) => item && /html|xml/.test(item.type));

  // Metadata
  const metaText = (name) => byLocalName(opf, name).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const meta = {
    title: metaText('title')[0] ?? '',
    author: metaText('creator').join(', '),
    lang: metaText('language')[0] ?? '',
  };

  // Images: path in the archive → blob URL (each file is read once)
  const urls = new Map();
  const resourceUrl = (path) => {
    if (!urls.has(path)) {
      const file = getFile(path);
      const type = [...manifest.values()].find((m) => m.path === path)?.type || guessType(path);
      urls.set(path, file
        ? file.async('uint8array').then((data) => URL.createObjectURL(new Blob([data], { type })))
        : Promise.resolve(null));
    }
    return urls.get(path);
  };

  // Book styles go into a separate <style> scoped by this book's class
  const scope = `epub-${++bookCounter}`;
  const cssCache = new Map();
  const loadCss = async (path) => {
    if (!cssCache.has(path)) cssCache.set(path, readText(path).then((t) => scopeCss(t, scope)).catch(() => ''));
    return cssCache.get(path);
  };
  const cssParts = new Set();

  // Chapters
  const chunks = [];
  for (const item of spine) {
    let text;
    try {
      text = await readText(item.path);
    } catch {
      continue;
    }
    const doc = parseMarkup(text, !/html$/i.test(item.path) || /xhtml/.test(item.type));
    for (const link of byLocalName(doc, 'link')) {
      if (!/stylesheet/i.test(link.getAttribute('rel') ?? '')) continue;
      const resolved = resolveHref(item.path, link.getAttribute('href'));
      if (resolved) cssParts.add(await loadCss(resolved.path));
    }
    for (const style of byLocalName(doc, 'style')) cssParts.add(scopeCss(style.textContent, scope));

    const body = byLocalName(doc, 'body')[0];
    if (!body) continue;
    const section = document.createElement('section');
    section.className = `chunk ${scope}`;
    section.dataset.id = item.path;
    for (const cls of (body.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)) section.classList.add(cls);
    new ChapterConverter(item.path).convert(body, section);
    const types = byLocalName(body, '*').map((e) => attr(e, 'epub:type') ?? '').join(' ') + ' ' + (attr(body, 'epub:type') ?? '');
    if (/\b(foot|end|rear)notes\b/.test(types) || /notes?|footnote|endnote|comment|примеч|приміт|коммент|комент/i.test(item.path)) {
      section.classList.add('notes');
    }
    chunks.push(...splitChunk(section));
  }
  if (!chunks.length) throw new Error('У книзі не знайдено жодної глави');

  // Substitute the real image URLs
  await Promise.all(chunks.flatMap((chunk) => [...chunk.querySelectorAll('[data-res]')].map(async (el) => {
    const url = await resourceUrl(el.dataset.res);
    delete el.dataset.res;
    if (!url) el.remove();
    else el.setAttribute(el.localName === 'img' ? 'src' : 'href', url);
  })));

  // Cover, if it isn't among the chapters
  const coverItem = [...manifest.values()].find((m) => /cover-image/.test(m.props)) ??
    manifest.get(byLocalName(opf, 'meta').find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content'));
  if (coverItem && /^image\//.test(coverItem.type) && !chunks[0].querySelector('img, image')) {
    const data = await getFile(coverItem.path)?.async('uint8array');
    if (data) {
      const url = URL.createObjectURL(new Blob([data], { type: coverItem.type }));
      urls.set(`cover:${coverItem.path}`, Promise.resolve(url));
      const cover = document.createElement('section');
      cover.className = `chunk cover-chunk ${scope}`;
      cover.innerHTML = '<div class="cover"><img alt="Обкладинка"></div>';
      cover.querySelector('img').src = url;
      chunks.unshift(cover);
    }
  }

  // TOC: EPUB 3 (nav) or EPUB 2 (ncx)
  let toc = [];
  try {
    const navItem = [...manifest.values()].find((m) => /\bnav\b/.test(m.props));
    if (navItem) toc = parseNavToc(parseMarkup(await readText(navItem.path)), navItem.path);
    if (!toc.length) {
      const ncxItem = manifest.get(spineEl?.getAttribute('toc')) ?? [...manifest.values()].find((m) => /ncx/.test(m.type));
      if (ncxItem) toc = parseNcxToc(parseXmlDoc(await readText(ncxItem.path)), ncxItem.path);
    }
  } catch (err) {
    console.warn('EPUB: не вдалося прочитати зміст', err);
  }

  const styleEl = document.createElement('style');
  styleEl.dataset.book = scope;
  styleEl.textContent = [...cssParts].join('\n');
  document.head.append(styleEl);

  return {
    meta,
    chunks: chunks.map((el) => ({ el, size: Math.max(el.textContent.length, 200) })),
    toc,
    destroy() {
      styleEl.remove();
      for (const promise of urls.values()) promise.then((url) => url && URL.revokeObjectURL(url));
    },
  };
}

function guessType(path) {
  const ext = path.split('.').pop().toLowerCase();
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' }[ext] ?? '';
}
