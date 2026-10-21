// A highlight stays on its words when the text is laid out differently

module.exports = async ({ step, reader, readingSettings, highlights, check, resize, shot }) => {
  let quote;

  // After every change: the same words are painted, they can be seen, and a click on them opens the highlight
  async function stillOnItsWords(name) {
    const painted = await highlights.painted();
    check('one highlight is painted', painted.length === 1 && painted[0].painted);
    check('it covers the same words', painted[0]?.text === quote, JSON.stringify(painted[0]?.text));
    check('it is on the screen', await highlights.isOnScreen(quote));
    await highlights.clickOn(quote);
    check('a click on it opens it', (await highlights.popup.markedColor()) === 'yellow');
    await shot(`layout-${name}`);
  }

  await step('Highlight a phrase in yellow', async () => {
    resize(1280, 860);
    await reader.setMode('scroll');
    await reader.open('fb2');
    await reader.goToContentsItem(5);
    quote = await highlights.selectWords(0, 1, 6);
    await highlights.popup.choose('yellow');
    check('one highlight saved', (await highlights.saved()).length === 1);
  });

  await step('Make the font bigger', async () => {
    await readingSettings.open();
    await readingSettings.setSlider('fontSize', 30);
    await readingSettings.close();
    await stillOnItsWords('01-font');
  });

  await step('Make the lines further apart', async () => {
    await readingSettings.open();
    await readingSettings.setSlider('lineHeight', 2.2);
    await readingSettings.close();
    await stillOnItsWords('02-spacing');
  });

  await step('Switch to pages (two side by side)', async () => {
    await reader.setMode('paged');
    await stillOnItsWords('03-paged');
  });

  await step('Make the window narrow', async () => {
    resize(560, 700);
    await reader.setMode('paged');
    await stillOnItsWords('04-narrow-paged');
  });

  await step('Turn two pages forward and back', async () => {
    await reader.turnPages(2);
    check('the highlight is off the screen', !(await highlights.isOnScreen(quote)));
    await reader.turnPages(-2);
    await stillOnItsWords('05-pages-turned');
  });

  await step('Switch back to scrolling', async () => {
    await reader.setMode('scroll');
    await stillOnItsWords('06-narrow-scroll');
  });

  resize(1280, 860);
};

module.exports.title = 'A highlight stays on its words when the text is laid out differently';
