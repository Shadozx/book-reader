'use strict';
// Generates the test books in tools/fixtures/ (committed, so the autotests run right after a clone):
//   npm run fixtures
// The text is made of our own word lists by a seeded generator, so the books have no copyright
// and come out the same on every run. Runs in Electron: the PDF is printed by Chromium.
//
//   book.fb2         main FB2: parts and chapters, footnotes, images, formatting, Ukrainian text
//   images.fb2       FB2 with many images of very different sizes
//   short.fb2        a small English FB2
//   book.epub        EPUB 3: nav + NCX, footnotes, cover, images, book styles, unsafe markup to strip
//   book-epub2.epub  EPUB 2: NCX only
//   book.pdf         PDF with a picture cover and a text layer, no table of contents
// DjVu can't be made without DjVuLibre, so DjVu tests use the optional books in samples/.

const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');
const JSZip = require('jszip');

const OUT = path.join(__dirname, 'fixtures');
// Words the search tests look for; they appear a known number of times
const SEARCH_WORD_UK = 'маяк';
const SEARCH_WORD_EN = 'lighthouse';

/* ---------- Text ---------- */

const UK_WORDS = `
  день ніч ранок вечір дорога місто село річка море берег вітер сонце хмара дощ сніг ліс поле гора
  дім вікно двері стіл книга лист слово голос пісня історія думка мрія надія пам'ять серце рука
  очі погляд усмішка друг сусід мандрівник капітан учитель майстер художник старий молодий тихий
  далекий високий світлий темний теплий холодний новий давній довгий короткий спокійний швидкий
  йти бачити чути думати знати писати читати говорити мовчати чекати шукати знаходити повертатися
  відчиняти зачиняти починати закінчувати пам'ятати забувати сміятися дивитися слухати співати
  і та але або ще вже тут там тоді знову завжди ніколи раптом повільно тихо довго разом поруч
  над під біля через після перед між серед до від з у на по за для про коли де як чому
`.trim().split(/\s+/);

const EN_WORDS = `
  day night morning evening road city village river sea shore wind sun cloud rain snow forest field
  hill house window door table book letter word voice song story thought dream hope memory heart hand
  eyes glance smile friend neighbour traveller captain teacher master painter old young quiet distant
  high bright dark warm cold new ancient long short calm quick walk see hear think know write read
  speak wait search find return open close begin finish remember forget laugh look listen sing
  and but or still already here there then again always never suddenly slowly quietly together near
  over under beside through after before between among to from with in on for about when where how
`.trim().split(/\s+/);

// mulberry32: a small seeded random generator, so every run produces the same books
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function textMaker(words, seed) {
  const rnd = random(seed);
  const pick = () => words[Math.floor(rnd() * words.length)];
  const sentence = () => {
    const n = 6 + Math.floor(rnd() * 10);
    const parts = Array.from({ length: n }, (_, i) => (i > 2 && i < n - 1 && rnd() < 0.12 ? pick() + ',' : pick()));
    const s = parts.join(' ');
    return s[0].toUpperCase() + s.slice(1) + (rnd() < 0.1 ? '?' : '.');
  };
  const paragraph = (sentences = 3 + Math.floor(rnd() * 4)) => Array.from({ length: sentences }, sentence).join(' ');
  return { paragraph, sentence, rnd };
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------- PNG images ---------- */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
// An RGB PNG; color(x, y) returns [r, g, b]
function png(width, height, color) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = color(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;   // bit depth
  header[9] = 2;   // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
const PALETTE = [[214, 69, 65], [242, 153, 74], [247, 208, 96], [76, 175, 80], [41, 128, 185], [142, 68, 173], [26, 37, 72]];
// A colourful picture of stripes and a circle (a "pictorial" page in the dark theme)
function picture(width, height, seed) {
  const rnd = random(seed);
  const colors = Array.from({ length: 5 }, () => PALETTE[Math.floor(rnd() * PALETTE.length)]);
  const cx = width * (0.3 + rnd() * 0.4);
  const cy = height * (0.3 + rnd() * 0.4);
  const r = Math.min(width, height) * 0.25;
  return png(width, height, (x, y) => ((x - cx) ** 2 + (y - cy) ** 2 < r * r ? [250, 250, 245] : colors[Math.floor((y / height) * colors.length)]));
}

/* ---------- FB2 ---------- */

function fb2Book({ title, author, lang, seed, parts, chaptersPerPart, paragraphs, notes, images, searchWord, extraImages = [] }) {
  const text = textMaker(lang === 'uk' ? UK_WORDS : EN_WORDS, seed);
  const binaries = [['cover.png', picture(300, 450, seed)]];
  const noteTexts = [];
  let chapterNo = 0;
  let found = 0;
  const label = lang === 'uk' ? { part: 'Частина', chapter: 'Розділ', notes: 'Примітки' } : { part: 'Part', chapter: 'Chapter', notes: 'Notes' };

  const chapter = () => {
    chapterNo++;
    const body = [];
    for (let i = 0; i < paragraphs; i++) {
      let p = xml(text.paragraph());
      if (i === 2 && notes) {
        noteTexts.push(text.paragraph(2));
        const n = noteTexts.length;
        p += ` ${lang === 'uk' ? 'Виноска' : 'Footnote'}<a l:href="#n${n}" type="note">[${n}]</a>.`;
      }
      if (i === 4) p = `<emphasis>${p.slice(0, 60)}</emphasis> <strong>${xml(text.sentence())}</strong> <strikethrough>${xml(text.sentence())}</strikethrough> H<sub>2</sub>O, x<sup>2</sup>, <a l:href="https://example.org">example.org</a>. ${p.slice(60)}`;
      if (i === 5 && searchWord && chapterNo % 3 === 0) {
        p = `${p} ${searchWord[0].toUpperCase() + searchWord.slice(1)} ${xml(text.sentence().toLowerCase())}`;
        found++;
      }
      body.push(`<p>${p}</p>`);
      if (i === 8 && images && chapterNo % 2 === 1) {
        const id = `img${chapterNo}.png`;
        binaries.push([id, picture(320, 200, seed + chapterNo)]);
        body.push(`<image l:href="#${id}"/>`);
      }
    }
    return `<section><title><p>${label.chapter} ${chapterNo}</p></title>${body.join('')}</section>`;
  };

  const sections = [];
  for (let p = 1; p <= parts; p++) {
    const chapters = Array.from({ length: chaptersPerPart }, chapter).join('\n');
    sections.push(parts > 1 ? `<section><title><p>${label.part} ${p}</p></title><epigraph><p>${xml(text.sentence())}</p></epigraph>${chapters}</section>` : chapters);
  }
  const extras = extraImages.map(([w, h], i) => {
    const id = `extra${i}.png`;
    binaries.push([id, picture(w, h, seed + 100 + i)]);
    return `<section><title><p>${lang === 'uk' ? 'Ілюстрація' : 'Illustration'} ${i + 1} (${w}×${h})</p></title><p>${xml(text.paragraph())}</p><image l:href="#${id}"/><p>${xml(text.paragraph())}</p></section>`;
  });
  const notesBody = noteTexts.length
    ? `<body name="notes"><title><p>${label.notes}</p></title>${noteTexts.map((t, i) => `<section id="n${i + 1}"><title><p>${i + 1}</p></title><p>${xml(t)}</p></section>`).join('')}</body>`
    : '';
  const [first, last] = author.split(' ');
  const fb2 = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><genre>prose</genre><author><first-name>${xml(first)}</first-name><last-name>${xml(last)}</last-name></author><book-title>${xml(title)}</book-title><lang>${lang}</lang><coverpage><image l:href="#cover.png"/></coverpage></title-info><document-info><program-used>tools/make-fixtures.js</program-used></document-info></description>
<body><title><p>${xml(title)}</p></title>
${sections.join('\n')}
${extras.join('\n')}
</body>
${notesBody}
${binaries.map(([id, data]) => `<binary id="${id}" content-type="image/png">${data.toString('base64')}</binary>`).join('\n')}
</FictionBook>
`;
  return { data: fb2, chapters: chapterNo, notes: noteTexts.length, found };
}

/* ---------- EPUB ---------- */

const FIXED_DATE = new Date('2026-01-01T00:00:00Z');

async function epubBook({ title, author, lang, seed, chapters, paragraphs, version }) {
  const text = textMaker(lang === 'uk' ? UK_WORDS : EN_WORDS, seed);
  const zip = new JSZip();
  const add = (name, content, options = {}) => zip.file(name, content, { date: FIXED_DATE, ...options });
  // The mimetype file goes first and uncompressed, as the format requires
  add('mimetype', 'application/epub+zip', { compression: 'STORE' });
  add('META-INF/container.xml', `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  // Book styles: fonts and colors the app must override, a margin it must keep
  add('OEBPS/style.css', `body { font-family: "Comic Sans MS", cursive; color: #802020; background: #fffbe0; line-height: 1.1; }
p { text-indent: 2em; margin: 0; }
.center { text-align: center; margin: 2em 0; }
h1 { font-size: 2em; color: navy; }`);

  const xhtml = (heading, body) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}"><head><title>${xml(heading)}</title><link rel="stylesheet" href="style.css"/></head><body>${body}</body></html>`;
  const notes = [];
  const manifest = [];
  const spine = [];
  const headings = [];

  add('OEBPS/images/cover.png', picture(300, 450, seed));
  manifest.push(`<item id="cover-img" href="images/cover.png" media-type="image/png"${version === 3 ? ' properties="cover-image"' : ''}/>`);

  for (let c = 1; c <= chapters; c++) {
    const heading = `${lang === 'uk' ? 'Глава' : 'Chapter'} ${c}`;
    headings.push(heading);
    const body = [`<h1 id="c${c}">${heading}</h1>`];
    for (let i = 0; i < paragraphs; i++) {
      let p = xml(text.paragraph());
      if (i === 1) {
        notes.push(text.paragraph(2));
        const n = notes.length;
        p += version === 3
          ? ` <a epub:type="noteref" href="notes.xhtml#fn${n}" id="ref${n}">${n}</a>`
          : ` <a href="notes.xhtml#fn${n}" id="ref${n}"><sup>${n}</sup></a>`;
      }
      if (i === 3) p = `<em>${xml(text.sentence())}</em> <strong>${xml(text.sentence())}</strong> <s>${xml(text.sentence())}</s> ${p}`;
      body.push(`<p>${p}</p>`);
      if (i === 4 && c % 2 === 0) {
        const name = `images/pic${c}.png`;
        add(`OEBPS/${name}`, picture(320, 200, seed + c));
        manifest.push(`<item id="pic${c}" href="${name}" media-type="image/png"/>`);
        body.push(`<div class="center"><img src="${name}" alt=""/></div>`);
      }
    }
    // Unsafe markup the reader must strip
    if (c === 1) body.push(`<script>window.hacked = true;</script><p onclick="window.hacked = true">${xml(text.sentence())}</p><iframe src="https://example.org"></iframe>`);
    add(`OEBPS/ch${c}.xhtml`, xhtml(heading, body.join('\n')));
    manifest.push(`<item id="ch${c}" href="ch${c}.xhtml" media-type="application/xhtml+xml"${version === 3 && c === 1 ? ' properties="scripted"' : ''}/>`);
    spine.push(`<itemref idref="ch${c}"/>`);
  }

  const noteMarkup = notes.map((t, i) => version === 3
    ? `<aside epub:type="footnote" id="fn${i + 1}"><p>${i + 1}. ${xml(t)}</p></aside>`
    : `<p id="fn${i + 1}"><a href="ch${i + 1}.xhtml#ref${i + 1}">${i + 1}</a>. ${xml(t)}</p>`).join('\n');
  add('OEBPS/notes.xhtml', xhtml(lang === 'uk' ? 'Примітки' : 'Notes', noteMarkup));
  manifest.push(`<item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/>`);
  spine.push(`<itemref idref="notes" linear="no"/>`);

  // Table of contents: NCX for both versions, nav for EPUB 3
  const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:uuid:chytalka-fixture-${seed}"/></head><docTitle><text>${xml(title)}</text></docTitle><navMap>
${headings.map((h, i) => `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${h}</text></navLabel><content src="ch${i + 1}.xhtml"/></navPoint>`).join('\n')}
</navMap></ncx>`;
  add('OEBPS/toc.ncx', ncx);
  manifest.push(`<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`);
  if (version === 3) {
    add('OEBPS/nav.xhtml', xhtml('Contents', `<nav epub:type="toc"><ol>${headings.map((h, i) => `<li><a href="ch${i + 1}.xhtml">${h}</a></li>`).join('')}</ol></nav>`));
    manifest.push(`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);
  }

  add('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${version}.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:chytalka-fixture-${seed}</dc:identifier><dc:title>${xml(title)}</dc:title><dc:creator>${xml(author)}</dc:creator><dc:language>${lang}</dc:language>${version === 3 ? '<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>' : ''}<meta name="cover" content="cover-img"/></metadata>
<manifest>
${manifest.join('\n')}
</manifest>
<spine toc="ncx">
${spine.join('\n')}
</spine>
</package>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/* ---------- PDF (printed by Chromium) ---------- */

async function pdfBook({ title, seed, chapters, paragraphs }) {
  const { BrowserWindow } = require('electron');
  const text = textMaker(EN_WORDS, seed);
  const cover = picture(300, 425, seed).toString('base64');
  let found = 0;
  const body = [];
  for (let c = 1; c <= chapters; c++) {
    body.push(`<h2>Chapter ${c}</h2>`);
    for (let i = 0; i < paragraphs; i++) {
      let p = text.paragraph();
      if (i === 3 && c % 2 === 0) {
        p += ` The ${SEARCH_WORD_EN} ${text.sentence().toLowerCase()}`;
        found++;
      }
      body.push(`<p>${xml(p)}</p>`);
    }
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${xml(title)}</title><style>
    @page { size: A5; margin: 0; }
    body { margin: 0; font: 11pt Georgia, serif; }
    .cover { height: 209mm; page-break-after: always; }
    .cover img { width: 148mm; height: 209mm; display: block; }
    .text { padding: 14mm 14mm; }
    h2 { page-break-before: always; font: bold 16pt Georgia, serif; }
    h2:first-child { page-break-before: auto; }
    p { margin: 0 0 0.5em; text-align: justify; }
  </style></head><body><div class="cover"><img src="data:image/png;base64,${cover}"></div><div class="text">${body.join('\n')}</div></body></html>`;
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const data = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, generateDocumentOutline: false });
  win.destroy();
  return { data, found };
}

/* ---------- Main ---------- */

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const write = (name, data) => {
    fs.writeFileSync(path.join(OUT, name), data);
    console.log(`  ${name.padEnd(16)} ${(fs.statSync(path.join(OUT, name)).size / 1024).toFixed(0).padStart(5)} KB`);
  };
  const facts = {};

  const book = fb2Book({ title: 'Тестова книга', author: 'Тестовий Автор', lang: 'uk', seed: 1, parts: 3, chaptersPerPart: 8, paragraphs: 28, notes: true, images: true, searchWord: SEARCH_WORD_UK });
  write('book.fb2', book.data);
  facts['book.fb2'] = { chapters: book.chapters, toc: book.chapters + 3, notes: book.notes, searchWord: SEARCH_WORD_UK, searchCount: book.found };

  const sizes = [[2400, 300], [300, 1800], [1200, 900], [640, 480], [160, 120], [900, 1400]];
  const images = fb2Book({ title: 'Книга з ілюстраціями', author: 'Тестовий Художник', lang: 'uk', seed: 2, parts: 1, chaptersPerPart: 12, paragraphs: 12, notes: true, images: true,
    extraImages: Array.from({ length: 24 }, (_, i) => sizes[i % sizes.length]) });
  write('images.fb2', images.data);

  const short = fb2Book({ title: 'A Short Test Book', author: 'Test Writer', lang: 'en', seed: 3, parts: 1, chaptersPerPart: 6, paragraphs: 15, notes: false, images: false });
  write('short.fb2', short.data);

  write('book.epub', await epubBook({ title: 'Тестова книга EPUB', author: 'Тестовий Автор', lang: 'uk', seed: 4, chapters: 12, paragraphs: 30, version: 3 }));
  write('book-epub2.epub', await epubBook({ title: 'EPUB 2 Test Book', author: 'Test Writer', lang: 'en', seed: 5, chapters: 6, paragraphs: 20, version: 2 }));

  const pdf = await pdfBook({ title: 'Test PDF Book', seed: 6, chapters: 10, paragraphs: 14 });
  write('book.pdf', pdf.data);
  facts['book.pdf'] = { searchWord: SEARCH_WORD_EN, searchCount: pdf.found };

  // Facts the tests rely on (how many chapters, how often the search word appears…)
  fs.writeFileSync(path.join(OUT, 'facts.json'), JSON.stringify(facts, null, 2) + '\n');
  console.log('  facts.json');
}

const { app } = require('electron');
app.whenReady()
  .then(main)
  .then(() => app.exit(0))
  .catch((err) => {
    console.error(err);
    app.exit(1);
  });
