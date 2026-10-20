// FB2 → book model for the text viewer
//
// Book model (shared by FB2 and EPUB):
//   meta:   { title, author, lang }
//   chunks: [{ el, size }]   — parts of the book (sections); el is a <section class="chunk">
//   toc:    [{ label, target: { id }, children? }]
//   destroy()                — releases the image blob URLs

import { loadJSZip } from '../lib.js';
import { t } from '../i18n.js';

const SPLIT_NESTED = 60_000;   // a section with subsections longer than this is split into its subsections
const SPLIT_LEAF = 120_000;    // a section without subsections longer than this is cut into pieces
const LEAF_PIECE = 60_000;

/* ---------- Decoding and XML parsing ---------- */

function decodeText(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 300));
  const encoding = head.match(/encoding\s*=\s*["']([\w-]+)["']/i)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

// HTML entities that often appear in hand-made FB2 files but are unknown to the XML parser
const ENTITIES = {
  nbsp: 160, mdash: 8212, ndash: 8211, laquo: 171, raquo: 187, hellip: 8230, copy: 169, reg: 174,
  bdquo: 8222, ldquo: 8220, rdquo: 8221, lsquo: 8216, rsquo: 8217, sbquo: 8218, middot: 183,
  deg: 176, times: 215, shy: 173, bull: 8226, trade: 8482, sect: 167, para: 182, minus: 8722,
  thinsp: 8201, ensp: 8194, emsp: 8195, laquo2: 171, euro: 8364, prime: 8242, Prime: 8243,
};

function repairXml(text) {
  return text
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) =>
      ['amp', 'lt', 'gt', 'quot', 'apos'].includes(name) ? m : ENTITIES[name] ? `&#${ENTITIES[name]};` : `&amp;${name};`)
    .replace(/&(?!#?[a-zA-Z0-9]+;)/g, '&amp;');
}

// Cuts <binary> elements (base64 images) out of the text before XML parsing:
// they take up most of the file and the parser has nothing to do there
function extractBinaries(text) {
  const binaries = new Map();
  const parts = [];
  const openRe = /<binary\b([^>]*)>/gi;
  const closeRe = /<\/binary\s*>/gi;
  let pos = 0;
  let m;
  while ((m = openRe.exec(text))) {
    closeRe.lastIndex = openRe.lastIndex;
    const close = closeRe.exec(text);
    if (!close) break;
    const attrs = m[1];
    const id = attrs.match(/\bid\s*=\s*["']([^"']*)["']/)?.[1];
    const type = attrs.match(/content-type\s*=\s*["']([^"']*)["']/)?.[1];
    if (id) binaries.set(id, { type, data: text.slice(openRe.lastIndex, close.index) });
    parts.push(text.slice(pos, m.index));
    pos = closeRe.lastIndex;
    openRe.lastIndex = pos;
  }
  parts.push(text.slice(pos));
  return { xml: parts.join(''), binaries };
}

function hasParseError(doc) {
  return doc.getElementsByTagName('parsererror').length > 0;
}

function parseXml(text) {
  const parser = new DOMParser();
  let doc = parser.parseFromString(text, 'application/xml');
  if (!hasParseError(doc)) return doc;

  doc = parser.parseFromString(repairXml(text), 'application/xml');
  if (!hasParseError(doc)) return doc;

  // Last resort: the lenient HTML parser. Rename the tags it treats specially.
  console.warn('FB2: broken XML, falling back to the HTML parser');
  const renamed = text
    .replace(/<\?xml[^>]*\?>/, '')
    .replace(/<(\/?)(title|image|style|table|tr|td|th|body|binary|description|a)\b/gi, '<$1fb-$2');
  return parser.parseFromString(renamed, 'text/html');
}

/* ---------- XML helpers ---------- */

const tagName = (el) => el.localName.toLowerCase().replace(/^fb-/, '');
const childElements = (el, name) => [...el.children].filter((c) => !name || tagName(c) === name);
const firstChild = (el, name) => el && [...el.children].find((c) => tagName(c) === name);

function getHref(el) {
  for (const attr of el.attributes) {
    if (attr.localName === 'href' || attr.name.endsWith(':href')) return attr.value;
  }
  return null;
}

function cleanText(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/* ---------- FB2 element to HTML converter ---------- */

const BLOCK_CONTEXT = new Set(['body', 'section', 'epigraph', 'cite', 'annotation', 'poem', 'stanza', 'title', 'table', 'tr', 'history', 'coverpage']);

class Converter {
  constructor(binaries) {
    this.binaries = binaries;  // id → { type, data }
    this.urls = new Map();     // id → blob URL
    this.idCounter = 0;
  }

  imageUrl(href) {
    const id = href?.replace(/^#/, '');
    if (!id || !this.binaries.has(id)) return null;
    if (!this.urls.has(id)) {
      const { type, data } = this.binaries.get(id);
      try {
        const bytes = base64ToBytes(data);
        this.urls.set(id, URL.createObjectURL(new Blob([bytes], { type: type || 'image/jpeg' })));
      } catch {
        this.urls.set(id, null);
      }
    }
    return this.urls.get(id);
  }

  autoId() {
    return `fb-auto-${++this.idCounter}`;
  }

  children(src, dest, depth) {
    const blockContext = BLOCK_CONTEXT.has(tagName(src));
    for (const node of src.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (blockContext && !node.data.trim()) continue;
        dest.append(node.data);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const converted = this.element(node, depth, src);
        if (converted) dest.append(converted);
      }
    }
    return dest;
  }

  make(tag, className, src) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    const id = src?.getAttribute('id');
    if (id) el.dataset.id = id;
    return el;
  }

  title(src, depth) {
    const level = Math.min(Math.max(depth, 1), 6);
    const heading = this.make(`h${level}`, 'title', src);
    let first = true;
    for (const child of src.children) {
      const name = tagName(child);
      if (name === 'p') {
        if (!first) heading.append(document.createElement('br'));
        this.children(child, heading, depth);
        first = false;
      } else if (name === 'empty-line' && !first) {
        heading.append(document.createElement('br'));
      }
    }
    return heading;
  }

  image(src, inline) {
    const url = this.imageUrl(getHref(src));
    if (!url) return null;
    const img = document.createElement('img');
    img.src = url;
    img.alt = src.getAttribute('alt') ?? '';
    if (inline) {
      img.className = 'inline-image';
      return img;
    }
    const wrap = this.make('div', 'image', src);
    wrap.append(img);
    const title = src.getAttribute('title');
    if (title) wrap.append(Object.assign(document.createElement('div'), { className: 'image-title', textContent: title }));
    return wrap;
  }

  element(src, depth, parent) {
    const name = tagName(src);
    switch (name) {
      case 'section': {
        const el = this.make('section', 'sec', src);
        if (!el.dataset.id) el.dataset.id = this.autoId();
        return this.children(src, el, depth + 1);
      }
      case 'title':
        return this.title(src, depth);
      case 'p':
        return this.children(src, this.make('p', null, src), depth);
      case 'subtitle':
        return this.children(src, this.make('p', 'subtitle', src), depth);
      case 'empty-line':
        return this.make('div', 'empty-line');
      case 'epigraph':
        return this.children(src, this.make('blockquote', 'epigraph', src), depth);
      case 'cite':
        return this.children(src, this.make('blockquote', 'cite', src), depth);
      case 'annotation':
        return this.children(src, this.make('div', 'annotation', src), depth);
      case 'text-author':
        return this.children(src, this.make('p', 'text-author', src), depth);
      case 'poem':
        return this.children(src, this.make('div', 'poem', src), depth);
      case 'stanza':
        return this.children(src, this.make('div', 'stanza', src), depth);
      case 'v':
        return this.children(src, this.make('p', 'v', src), depth);
      case 'date':
        return this.children(src, this.make('p', 'date', src), depth);
      case 'image':
        return this.image(src, !BLOCK_CONTEXT.has(tagName(parent)));
      case 'emphasis':
        return this.children(src, this.make('em'), depth);
      case 'strong':
        return this.children(src, this.make('strong'), depth);
      case 'strikethrough':
        return this.children(src, this.make('s'), depth);
      case 'sub':
      case 'sup':
      case 'code':
        return this.children(src, this.make(name), depth);
      case 'a': {
        const href = getHref(src) ?? '';
        const a = this.make('a', null, src);
        if (href.startsWith('#')) {
          a.dataset.href = href.slice(1);
          if (src.getAttribute('type') === 'note') a.className = 'note-link';
        } else if (/^https?:\/\//i.test(href)) {
          a.href = href;
          a.target = '_blank';
        }
        return this.children(src, a, depth);
      }
      case 'table':
        return this.children(src, this.make('table', null, src), depth);
      case 'tr':
        return this.children(src, this.make('tr'), depth);
      case 'td':
      case 'th': {
        const cell = this.make(name);
        for (const attr of ['colspan', 'rowspan', 'align']) {
          if (src.hasAttribute(attr)) cell.setAttribute(attr, src.getAttribute(attr));
        }
        return this.children(src, cell, depth);
      }
      case 'binary':
      case 'description':
      case 'stylesheet':
        return null;
      default:
        // Unknown or decorative tag (style etc.): keep only the content
        return this.children(src, document.createElement(BLOCK_CONTEXT.has(tagName(parent)) ? 'div' : 'span'), depth);
    }
  }
}

function base64ToBytes(data) {
  const clean = data.replace(/[^A-Za-z0-9+/=]/g, '');
  if (Uint8Array.fromBase64) return Uint8Array.fromBase64(clean);
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/* ---------- Splitting into parts and the TOC ---------- */

function buildChunks(body, conv, { notes = false } = {}) {
  const chunks = [];
  let current = null;

  const newChunk = (id) => {
    current = document.createElement('section');
    current.className = notes ? 'chunk notes' : 'chunk';
    if (id) current.dataset.id = id;
    chunks.push(current);
    return current;
  };
  const append = (node) => {
    if (!node) return;
    (current ?? newChunk()).append(node);
  };

  const addSection = (sec, depth) => {
    const size = sec.textContent.length;
    const subsections = childElements(sec, 'section');
    const id = sec.getAttribute('id') || conv.autoId();
    sec.setAttribute('id', id);

    if (subsections.length && size > SPLIT_NESTED) {
      // Large section: title and intro separately, each subsection as its own part
      const header = newChunk(id);
      header.classList.add('part-header');
      let afterSubsections = false;
      for (const child of sec.children) {
        if (tagName(child) === 'section') {
          addSection(child, depth + 1);
          afterSubsections = true;
        } else {
          if (afterSubsections) {
            newChunk();
            afterSubsections = false;
          }
          append(conv.element(child, depth + 1, sec));
        }
      }
      if (!header.childNodes.length) header.classList.add('empty');
      current = null;
      return;
    }

    const el = conv.element(sec, depth, sec.parentElement);
    if (size > SPLIT_LEAF && el.childNodes.length > 1) {
      // Very long section without subsections: cut by paragraphs
      let piece = newChunk(id);
      let pieceSize = 0;
      for (const child of [...el.childNodes]) {
        const len = child.textContent.length;
        if (pieceSize > LEAF_PIECE && pieceSize + len > LEAF_PIECE) {
          piece = newChunk();
          pieceSize = 0;
        }
        piece.append(child);
        pieceSize += len;
      }
    } else {
      newChunk().append(el);
    }
    current = null;
  };

  for (const child of body.children) {
    if (notes) {
      // Notes are short sections, so group them into parts of moderate size
      if (current && current.textContent.length > LEAF_PIECE) newChunk();
      append(conv.element(child, 1, body));
    } else if (tagName(child) === 'section') {
      addSection(child, 1);
    } else {
      append(conv.element(child, 0, body));
    }
  }
  return chunks.filter((c) => !c.classList.contains('empty'));
}

function buildToc(body) {
  const walk = (el) => {
    const items = [];
    for (const sec of childElements(el, 'section')) {
      const titleEl = firstChild(sec, 'title');
      const label = titleEl ? cleanText(childElements(titleEl, 'p').map((p) => p.textContent).join('. ')) : '';
      const children = walk(sec);
      if (label) items.push({ label, target: { id: sec.getAttribute('id') }, children: children.length ? children : undefined });
      else items.push(...children);
    }
    return items;
  };
  return walk(body);
}

/* ---------- Metadata ---------- */

function readMeta(doc) {
  const description = doc.querySelector('description, fb-description');
  const titleInfo = firstChild(description, 'title-info');
  const text = (el) => cleanText(el?.textContent ?? '');
  const authors = titleInfo
    ? childElements(titleInfo, 'author').map((a) => {
        const name = ['first-name', 'middle-name', 'last-name'].map((n) => text(firstChild(a, n))).filter(Boolean).join(' ');
        return name || text(firstChild(a, 'nickname'));
      }).filter(Boolean)
    : [];
  return {
    title: text(firstChild(titleInfo, 'book-title')),
    author: authors.join(', '),
    lang: text(firstChild(titleInfo, 'lang')),
    coverHref: getHref(firstChild(firstChild(titleInfo, 'coverpage'), 'image') ?? document.createElement('x')),
  };
}

/* ---------- Main function ---------- */

async function unzipFb2(bytes) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(bytes);
  const entry = Object.values(zip.files).find((f) => !f.dir && /\.fb2$/i.test(f.name));
  if (!entry) throw new Error(t('error.fb2NoFile'));
  return entry.async('uint8array');
}

export async function parseFb2(bytes) {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) bytes = await unzipFb2(bytes);

  const { xml, binaries } = extractBinaries(decodeText(bytes));
  const doc = parseXml(xml);
  const all = (name) => [...doc.getElementsByTagName('*')].filter((e) => tagName(e) === name);

  // If some <binary> couldn't be cut out beforehand, take it from the parsed document
  for (const bin of all('binary')) {
    const id = bin.getAttribute('id');
    if (id && !binaries.has(id)) binaries.set(id, { type: bin.getAttribute('content-type'), data: bin.textContent });
  }

  const meta = readMeta(doc);
  const conv = new Converter(binaries);

  // In HTML-parser mode the document's real <body> is not a book body; book bodies are renamed to fb-body
  const isHtml = doc.contentType === 'text/html';
  const bodies = all('body').filter((b) => !isHtml || b.localName === 'fb-body');
  if (!bodies.length) throw new Error(t('error.fb2NoBody'));
  const isNotes = (b) => /^(notes|comments|footnotes)$/i.test(b.getAttribute('name') ?? '');
  const mainBodies = bodies.filter((b) => !isNotes(b));
  const noteBodies = bodies.filter(isNotes);

  // All sections need ids before the TOC is built
  for (const sec of all('section')) {
    if (!sec.getAttribute('id')) sec.setAttribute('id', conv.autoId());
  }

  const chunks = [];
  const toc = [];
  for (const body of mainBodies) {
    chunks.push(...buildChunks(body, conv));
    toc.push(...buildToc(body));
  }

  const coverUrl = conv.imageUrl(meta.coverHref);
  if (coverUrl && chunks.length) {
    const cover = document.createElement('div');
    cover.className = 'cover';
    cover.append(Object.assign(document.createElement('img'), { src: coverUrl, alt: t('book.cover') }));
    const coverChunk = document.createElement('section');
    coverChunk.className = 'chunk cover-chunk';
    coverChunk.append(cover);
    chunks.unshift(coverChunk);
  }

  for (const body of noteBodies) {
    const noteChunks = buildChunks(body, conv, { notes: true });
    if (!noteChunks.length) continue;
    const id = conv.autoId();
    noteChunks[0].dataset.id ??= id;
    toc.push({ label: firstChild(body, 'title')?.textContent.trim() || t('book.notes'), target: { id: noteChunks[0].dataset.id } });
    chunks.push(...noteChunks);
  }

  return {
    meta: { title: meta.title, author: meta.author, lang: meta.lang },
    chunks: chunks.map((el) => ({ el, size: Math.max(el.textContent.length, 200) })),
    toc,
    destroy() {
      for (const url of conv.urls.values()) if (url) URL.revokeObjectURL(url);
    },
  };
}
