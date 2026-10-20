// Parsing of non-standard FB2: broken XML, windows-1251, .fb2.zip
module.exports = async ({ exec, log }) => {
  const result = await exec(`(async () => {
    const { parseFb2 } = await import('./formats/fb2.js');
    const { loadJSZip } = await import('./lib.js');
    const enc = (s) => new TextEncoder().encode(s);
    const out = {};
    const summarize = (b) => ({ title: b.meta.title, author: b.meta.author, chunks: b.chunks.length, toc: b.toc.map(t => t.label), text: b.chunks.map(c => c.el.textContent).join('|').slice(0, 120) });

    // 1. HTML-сутності та «голий» амперсанд
    const broken = '<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><author><first-name>Іван</first-name><last-name>Франко</last-name></author><book-title>Тест &amp; сутності</book-title></title-info></description><body><section><title><p>Розділ&nbsp;1</p></title><p>Том & Джеррі &mdash; тест &laquo;лапок&raquo;</p></section></body></FictionBook>';
    try { out.entities = summarize(await parseFb2(enc(broken))); } catch (e) { out.entities = 'ERR ' + e.message; }

    // 2. Незакритий тег — XML не розбирається навіть після виправлень, працює HTML-парсер
    const veryBroken = '<?xml version="1.0"?><FictionBook><description><title-info><book-title>Битий</book-title></title-info></description><body><title><p>Назва книги</p></title><section><title><p>Глава</p></title><p>Абзац <emphasis>курсив</p><p>Другий абзац</p></section></body></FictionBook>';
    try { out.htmlFallback = summarize(await parseFb2(enc(veryBroken))); } catch (e) { out.htmlFallback = 'ERR ' + e.message; }

    // 3. windows-1251
    const cp1251 = (s) => Uint8Array.from([...s].map(ch => { const c = ch.charCodeAt(0); if (c < 128) return c; if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0; if (c === 0x456) return 0xb3; if (c === 0x406) return 0xb2; if (c === 0x457) return 0xbf; if (c === 0x454) return 0xba; return 63; }));
    const win = '<?xml version="1.0" encoding="windows-1251"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><book-title>Кобзар</book-title></title-info></description><body><section><title><p>Перша</p></title><p>Привіт, світе</p></section></body></FictionBook>';
    try { out.cp1251 = summarize(await parseFb2(cp1251(win))); } catch (e) { out.cp1251 = 'ERR ' + e.message; }

    // 4. .fb2.zip
    const JSZip = await loadJSZip();
    const zip = new JSZip(); zip.file('book.fb2', win.replace('windows-1251', 'utf-8'));
    try { out.zip = summarize(await parseFb2(await zip.generateAsync({ type: 'uint8array' }))); } catch (e) { out.zip = 'ERR ' + e.message; }
    return JSON.stringify(out, null, 1);
  })()`);
  log(result);
};
