// Highlighting a phrase with the mouse, changing its colour, copying and deleting it

const { clipboard } = require('electron');

module.exports = async ({ step, reader, highlights, press, check, shot }) => {
  const { popup } = highlights;
  let phrase;

  await step('A new book has no highlights', async () => {
    await reader.setMode('scroll');
    await reader.open('fb2');
    await reader.goToContentsItem(5);
    check('nothing saved', (await highlights.saved()).length === 0);
    check('nothing painted', (await highlights.painted()).length === 0);
  });

  await step('Selecting text with the mouse shows the popup', async () => {
    phrase = await highlights.selectWords(1, 2, 6);
    check('the words are selected', (await highlights.selectedText()).trim() === phrase, phrase);
    check('the popup is shown', await popup.isShown());
    check('no colour is marked yet', (await popup.markedColor()) === null);
    check('there is nothing to delete yet', !(await popup.hasDelete()));
    await shot('highlights-01-popup');
  });

  await step('Choosing yellow highlights exactly the selected text', async () => {
    await popup.choose('yellow');
    const saved = await highlights.saved();
    check('one highlight is saved', saved.length === 1 && saved[0].color === 'yellow');
    check('it saved exactly the selected text', saved[0]?.quote === phrase, saved[0]?.quote);
    const painted = await highlights.painted();
    check('exactly that text is painted yellow', painted.length === 1 && painted[0].text === phrase && painted[0].color === 'yellow' && painted[0].painted, JSON.stringify(painted[0]?.text));
    check('the popup closes', !(await popup.isShown()));
    check('the selection is cleared', (await highlights.selectedText()) === '');
    await shot('highlights-02-yellow');
  });

  await step('A click on the highlight opens it', async () => {
    await highlights.clickOn(phrase);
    await shot('highlights-03-open');
    check('the popup is shown', await popup.isShown());
    check('yellow is marked as its colour', (await popup.markedColor()) === 'yellow');
    check('it can be deleted', await popup.hasDelete());
  });

  await step('Changing the colour to green', async () => {
    await popup.choose('green');
    const saved = await highlights.saved();
    const painted = await highlights.painted();
    check('saved as green', saved.length === 1 && saved[0].color === 'green');
    check('painted green, on the same text', painted.length === 1 && painted[0].color === 'green' && painted[0].text === phrase && painted[0].painted);
  });

  await step('"Copy" puts the highlighted text on the clipboard', async () => {
    // The clipboard API is asynchronous in this Electron version
    await clipboard.clear();
    await highlights.clickOn(phrase);
    await popup.copy();
    const copied = await clipboard.readText();
    check('the clipboard has the text', copied === phrase, JSON.stringify(copied));
  });

  await step('"Delete" removes the highlight', async () => {
    await highlights.clickOn(phrase);
    await popup.delete();
    check('nothing saved', (await highlights.saved()).length === 0);
    check('nothing painted', (await highlights.painted()).length === 0);
    check('the popup closes', !(await popup.isShown()));
  });

  await step('Esc closes the popup and saves nothing', async () => {
    await highlights.selectWords(2, 0, 3);
    check('the popup is shown', await popup.isShown());
    await press('Escape');
    check('the popup closes', !(await popup.isShown()));
    check('the selection is cleared', (await highlights.selectedText()) === '');
    check('nothing saved', (await highlights.saved()).length === 0);
  });
};

module.exports.title = 'Highlighting a phrase with the mouse, changing its colour, copying and deleting it';
