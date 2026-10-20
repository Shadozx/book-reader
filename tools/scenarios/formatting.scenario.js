// Italic, bold, strikethrough, sub/superscripts and links are really rendered (by their computed style)

const BOOKS = [
  { role: 'fb2', expect: ['italic', 'bold', 'strike', 'sub', 'sup', 'externalLinks'] },
  { role: 'fb2Images', expect: ['italic', 'bold'] },
  { role: 'epub', expect: ['italic', 'bold', 'strike'] },
  { role: 'epubExtra', expect: ['italic', 'bold', 'sup'] },
];

module.exports = async ({ open, exec, check, log }) => {
  await exec(`app.updateSettings({ mode: 'scroll' })`);
  for (const book of BOOKS) {
    await open(book.role);
    const s = await exec(`(() => {
      const content = app.activeTab.paneEl.querySelector('.book-content');
      const stats = { italic: 0, bold: 0, strike: 0, italicLost: 0, boldLost: 0 };
      // Count text-holding elements by their computed style
      const seen = new Set();
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const el = walker.currentNode.parentElement;
        if (!walker.currentNode.data.trim() || seen.has(el)) continue;
        seen.add(el);
        const cs = getComputedStyle(el);
        if (cs.fontStyle === 'italic') stats.italic++;
        if (Number(cs.fontWeight) >= 600) stats.bold++;
        if (cs.textDecorationLine.includes('line-through')) stats.strike++;
      }
      // Tags that should be italic or bold but are shown plain
      for (const el of content.querySelectorAll('em, i')) if (getComputedStyle(el).fontStyle !== 'italic') stats.italicLost++;
      for (const el of content.querySelectorAll('strong, b')) if (Number(getComputedStyle(el).fontWeight) < 600) stats.boldLost++;
      stats.sup = content.querySelectorAll('sup').length;
      stats.sub = content.querySelectorAll('sub').length;
      const links = [...content.querySelectorAll('a[data-href], a[href]')];
      stats.links = links.length;
      stats.linksNotClickable = links.filter((a) => getComputedStyle(a).cursor !== 'pointer').length;
      stats.externalLinks = content.querySelectorAll('a[href^="http"]').length;
      return stats;
    })()`);
    log(`${book.role}: ${JSON.stringify(s)}`);
    for (const kind of book.expect) check(`${book.role}: ${kind} is rendered`, s[kind] > 0, `${s[kind]}`);
    check(`${book.role}: no italic or bold tag shown plain`, s.italicLost === 0 && s.boldLost === 0, `italic ${s.italicLost}, bold ${s.boldLost}`);
    check(`${book.role}: links look clickable`, s.linksNotClickable === 0, `${s.links} links`);
  }
};
