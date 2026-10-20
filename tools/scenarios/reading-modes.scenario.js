// Scroll and paged modes for FB2/EPUB: page turning, and the reading position surviving
// mode switches, window resizes and font changes. reading-modes-restore continues this run.

module.exports = async ({ open, exec, wait, check, press, tocItem, location, resize, shot, log }) => {
  // The same place: same part of the book, a couple of paragraphs apart at most
  const near = (a, b) => a.c === b.c && Math.abs(a.b - b.b) <= 2;
  const settle = () => wait(600);

  await exec(`app.updateSettings({ mode: 'scroll' })`);
  await open('fb2');
  await tocItem(5);
  await settle();
  await press('PageDown');
  await settle();
  const scrolled = await location();
  await shot('modes-01-scroll');

  await exec(`app.updateSettings({ mode: 'paged' })`);
  await settle();
  const paged = await location();
  check('scroll → pages keeps the place', near(scrolled, paged), `${JSON.stringify(scrolled)} → ${JSON.stringify(paged)}`);
  check('paged mode is on', await exec(`app.activeTab.paneEl.querySelector('.flow').classList.contains('paged')`));
  await shot('modes-02-paged');

  for (let i = 0; i < 3; i++) await press('ArrowRight');
  await settle();
  const forward = await location();
  check('→ turns pages forward', forward.c > paged.c || (forward.c === paged.c && forward.b > paged.b), `${JSON.stringify(paged)} → ${JSON.stringify(forward)}`);

  // Across chapter boundaries and back
  for (let i = 0; i < 20; i++) await press('PageDown');
  await settle();
  const far = await location();
  for (let i = 0; i < 20; i++) await press('PageUp');
  await settle();
  const back = await location();
  check('20 pages forward cross into later chapters', far.c > forward.c, `${JSON.stringify(forward)} → ${JSON.stringify(far)}`);
  check('20 pages back return to the same place', near(back, forward), `${JSON.stringify(forward)} → ${JSON.stringify(back)}`);

  resize(800, 860);
  await settle();
  const narrow = await location();
  check('a narrower window keeps the place', near(narrow, forward), JSON.stringify(narrow));
  await shot('modes-03-narrow');

  await exec(`app.updateSettings({ fontSize: 26 })`);
  await settle();
  const bigFont = await location();
  check('a bigger font keeps the place', near(bigFont, narrow), JSON.stringify(bigFont));

  await exec(`app.updateSettings({ mode: 'scroll', fontSize: 20 })`);
  await settle();
  const scrollAgain = await location();
  check('pages → scroll keeps the place', near(scrollAgain, bigFont), JSON.stringify(scrollAgain));

  // Leave the paged mode in the dark theme for the restart check
  await exec(`app.setTheme('dark')`);
  await exec(`app.updateSettings({ mode: 'paged' })`);
  resize(1280, 860);
  await settle();
  await shot('modes-04-dark-paged');

  const note = await exec(`(() => {
    const link = document.querySelector('.pane:not([hidden]) .page-strip a.note-link');
    if (!link) return null;
    link.click();
    return !!document.querySelector('.note-popup');
  })()`);
  if (note === null) log('no footnote on this page, popup in paged mode not checked');
  else check('a footnote opens in paged mode', note);
};
