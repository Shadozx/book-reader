// Highlights when the book file was edited while the app was closed

const fs = require('node:fs');
const path = require('node:path');

// What the first run made, for the later runs: { file, quotes: { color: text }, changedQuote }
const notes = (outDir) => path.join(outDir, 'changed-book.json');

// Four highlights, each in its own chapter; each will be hit by a different edit of the file
const PLACES = [
  { color: 'yellow', chapter: 3 },   // a new paragraph is added before it
  { color: 'green', chapter: 7 },    // a new chapter is added before it
  { color: 'blue', chapter: 11 },    // a word inside it is changed
  { color: 'pink', chapter: 15 },    // its paragraph is deleted
];

module.exports = [
  // First run: highlight, then edit the file on the disk
  async ({ step, reader, highlights, fb2File, check, outDir }) => {
    const quotes = {};
    let file;

    await step('Open a copy of the book and highlight four phrases in different chapters', async () => {
      await reader.setMode('scroll');
      file = fb2File.copy('fb2');
      await reader.openFile(file);
      for (const { color, chapter } of PLACES) {
        await reader.goToContentsItem(chapter);
        quotes[color] = await highlights.selectWords(0, 1, 5);
        await highlights.popup.choose(color);
      }
      check('four highlights saved', (await highlights.saved()).length === 4);
    });

    await step('Edit the book file', async () => {
      const words = quotes.blue.split(' ');
      words[2] = 'інакше';
      const changedQuote = words.join(' ');
      fb2File.insertParagraphBefore(file, quotes.yellow);
      fb2File.insertChapterBefore(file, quotes.green);
      fb2File.replaceText(file, quotes.blue, changedQuote);
      fb2File.deleteParagraph(file, quotes.pink);
      fs.writeFileSync(notes(outDir), JSON.stringify({ file, quotes, changedQuote }));
    });
  },

  // After a restart the app opens the edited file
  async ({ step, waitFor, exec, highlights, fb2File, toast, t, check, outDir, shot }) => {
    const { file, quotes, changedQuote } = JSON.parse(fs.readFileSync(notes(outDir), 'utf8'));
    await waitFor(`app.activeTab?.viewer`, 60000);
    const saved = await highlights.saved();
    const painted = await highlights.painted();
    const byColor = (list, color) => list.find((h) => h.color === color);

    await step('A message says what happened to the highlights', async () => {
      const message = await toast();
      const list = [t('highlight.inPlace', { n: 2 }), t('highlight.changedText', { n: 1 }), t('highlight.notFound', { n: 1 })].join(', ');
      check('the message is shown', message.shown);
      check('it counts 2 in place, 1 changed, 1 not found', message.text === t('highlight.bookChanged', { list }), message.text);
      await shot('changed-book-message');
    });

    await step('The highlight after a new paragraph is on its words', async () => {
      check('it is painted on the same words', byColor(painted, 'yellow')?.text === quotes.yellow);
    });

    await step('The highlight after a new chapter is on its words', async () => {
      check('it is painted on the same words', byColor(painted, 'green')?.text === quotes.green);
    });

    await step('The highlight with a changed word covers the new text', async () => {
      check('it is painted on the new text', byColor(painted, 'blue')?.text === changedQuote, JSON.stringify(byColor(painted, 'blue')?.text));
      check('the new text is saved', byColor(saved, 'blue')?.quote === changedQuote);
    });

    await step('The highlight whose paragraph was deleted is kept but not painted', async () => {
      check('all four highlights are still saved', saved.length === 4);
      check('it is marked as not found', byColor(saved, 'pink')?.lost === true);
      check('it is not painted', !byColor(painted, 'pink'));
    });

    // The date of the file as the app saw it, to make sure the next run sees a new one
    const seen = await exec(`app.activeTab.record.file.mtime`);
    fs.writeFileSync(notes(outDir), JSON.stringify({ file, quotes, changedQuote, seen }));
    fb2File.touch(file);
  },

  // The file was only written again, its text is the same
  async ({ step, waitFor, exec, highlights, toast, check, outDir }) => {
    await step('After a file save without changes there is no message', async () => {
      const { seen } = JSON.parse(fs.readFileSync(notes(outDir), 'utf8'));
      await waitFor(`app.activeTab?.viewer`, 60000);
      await new Promise((r) => setTimeout(r, 300));
      check('the app sees the new date of the file', (await exec(`app.activeTab.record.file.mtime`)) !== seen);
      check('no message', !(await toast()).text);
      check('three highlights are painted', (await highlights.painted()).length === 3);
      check('four are saved', (await highlights.saved()).length === 4);
    });
  },
];

module.exports.title = 'Highlights after the book file was edited';
