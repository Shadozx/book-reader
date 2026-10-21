// Highlighting in an EPUB works the same way as in FB2

module.exports = async ({ step, reader, highlights, check }) => {
  let phrase;

  await step('Open an EPUB at a chapter', async () => {
    await reader.setMode('scroll');
    await reader.open('epub');
    await reader.goToContentsItem(2);
    check('no highlights yet', (await highlights.saved()).length === 0);
  });

  await step('Select a phrase and choose blue', async () => {
    phrase = await highlights.selectWords(1, 1, 5);
    check('the popup is shown', await highlights.popup.isShown());
    await highlights.popup.choose('blue');
    const saved = await highlights.saved();
    check('saved exactly the selected text in blue', saved.length === 1 && saved[0].quote === phrase && saved[0].color === 'blue', saved[0]?.quote);
    const painted = await highlights.painted();
    check('exactly that text is painted blue', painted.length === 1 && painted[0].text === phrase && painted[0].color === 'blue' && painted[0].painted);
  });
};

module.exports.title = 'Highlighting in an EPUB';
