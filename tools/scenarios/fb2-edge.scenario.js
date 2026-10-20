// Non-standard FB2 files the parser must still read: HTML entities and a bare ampersand,
// XML broken beyond repair (the HTML parser fallback), windows-1251, a book inside .fb2.zip

module.exports = async ({ exec, check }) => {
  const results = await exec(`(async () => {
    const { parseFb2 } = await import('./formats/fb2.js');
    const { loadJSZip } = await import('./lib.js');
    const utf8 = (s) => new TextEncoder().encode(s);
    const read = async (bytes) => {
      try {
        const b = await parseFb2(bytes);
        return { title: b.meta.title, author: b.meta.author, chunks: b.chunks.length, text: b.chunks.map((c) => c.el.textContent).join('|') };
      } catch (e) {
        return { error: e.message };
      }
    };
    const out = {};

    // HTML entities XML doesn't know, and a bare "&"
    out.entities = await read(utf8('<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><author><first-name>Іван</first-name><last-name>Франко</last-name></author><book-title>Тест &amp; сутності</book-title></title-info></description><body><section><title><p>Розділ&nbsp;1</p></title><p>Том & Джеррі &mdash; тест &laquo;лапок&raquo;</p></section></body></FictionBook>'));

    // An unclosed tag: XML can't be repaired, the lenient HTML parser takes over
    out.htmlFallback = await read(utf8('<?xml version="1.0"?><FictionBook><description><title-info><book-title>Битий</book-title></title-info></description><body><title><p>Назва книги</p></title><section><title><p>Глава</p></title><p>Абзац <emphasis>курсив</p><p>Другий абзац</p></section></body></FictionBook>'));

    // windows-1251 (encoded by hand: Cyrillic letters and і, ї, є)
    const cp1251 = (s) => Uint8Array.from([...s].map((ch) => {
      const c = ch.charCodeAt(0);
      if (c < 128) return c;
      if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0;
      return { 0x456: 0xb3, 0x406: 0xb2, 0x457: 0xbf, 0x454: 0xba }[c] ?? 63;
    }));
    const kobzar = '<?xml version="1.0" encoding="windows-1251"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><book-title>Кобзар</book-title></title-info></description><body><section><title><p>Перша</p></title><p>Привіт, світе</p></section></body></FictionBook>';
    out.cp1251 = await read(cp1251(kobzar));

    // .fb2.zip
    const JSZip = await loadJSZip();
    const zip = new JSZip();
    zip.file('book.fb2', kobzar.replace('windows-1251', 'utf-8'));
    out.zip = await read(await zip.generateAsync({ type: 'uint8array' }));
    return out;
  })()`);

  const { entities, htmlFallback, cp1251, zip } = results;
  check('HTML entities and a bare & are read', entities.title === 'Тест & сутності' && entities.author === 'Іван Франко' && entities.text.includes('Том & Джеррі — тест «лапок»'), JSON.stringify(entities).slice(0, 160));
  check('broken XML falls back to the HTML parser', htmlFallback.chunks > 0 && htmlFallback.text.includes('Другий абзац'), JSON.stringify(htmlFallback).slice(0, 160));
  check('windows-1251 is decoded', cp1251.title === 'Кобзар' && cp1251.text.includes('Привіт, світе'), JSON.stringify(cp1251).slice(0, 160));
  check('a book inside .fb2.zip is read', zip.title === 'Кобзар' && zip.text.includes('Привіт, світе'), JSON.stringify(zip).slice(0, 160));
};
