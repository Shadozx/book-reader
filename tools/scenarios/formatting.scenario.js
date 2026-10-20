// Check that italic, bold, strikethrough, sub/superscripts and links are actually rendered
const path = require('node:path');

const BOOKS = [
  'Diuna.fb2',
  'German_Smotret_i_vidit.fb2',
  'Platon_Apologiya_Sokrata_Dialogi_1dfc1e_500611.fb2',
  'Holidey_Muzhestvo-Pochemu-smelym-sudba-pomogaet.677332.epub',
  'Відьмак-Час-Погорди-Т4-Анджей-Сапковський-2996627e-1.epub',
];

module.exports = async ({ root, exec, waitFor, log }) => {
  await exec(`app.updateSettings({ mode: 'scroll' })`);
  for (const name of BOOKS) {
    await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', name))})`);
    await waitFor(`app.activeTab.viewer`, 30000);
    const r = await exec(`(() => {
      const c = app.activeTab.paneEl.querySelector('.book-content');
      // Рахуємо «листові» текстові вузли за фактичним (обчисленим) стилем
      const stats = { italic: 0, bold: 0, strike: 0, sup: 0, sub: 0, links: 0, linksClickable: 0, externalLinks: 0, italicTags: 0, boldTags: 0, italicLost: 0, boldLost: 0 };
      const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
      const seen = new Set();
      while (walker.nextNode()) {
        const el = walker.currentNode.parentElement;
        if (!walker.currentNode.data.trim() || seen.has(el)) continue;
        seen.add(el);
        const cs = getComputedStyle(el);
        if (cs.fontStyle === 'italic') stats.italic++;
        if (Number(cs.fontWeight) >= 600) stats.bold++;
        if (cs.textDecorationLine.includes('line-through')) stats.strike++;
      }
      // Теги, які мають бути курсивом/жирним, але чомусь показуються звичайно
      for (const el of c.querySelectorAll('em, i')) { stats.italicTags++; if (getComputedStyle(el).fontStyle !== 'italic') stats.italicLost++; }
      for (const el of c.querySelectorAll('strong, b')) { stats.boldTags++; if (Number(getComputedStyle(el).fontWeight) < 600) stats.boldLost++; }
      stats.sup = c.querySelectorAll('sup').length;
      stats.sub = c.querySelectorAll('sub').length;
      const links = c.querySelectorAll('a[data-href], a[href]');
      stats.links = links.length;
      stats.linksClickable = [...links].filter(a => getComputedStyle(a).cursor === 'pointer').length;
      stats.externalLinks = c.querySelectorAll('a[href^="http"]').length;
      return JSON.stringify(stats);
    })()`);
    log(name.slice(0, 34).padEnd(34), r);
  }
};
