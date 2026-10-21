// Highlights stay after the app is closed and started again

module.exports = [
  // First run: two highlights in different chapters, in different colours
  async ({ step, reader, highlights, check }) => {
    await step('Highlight a phrase in yellow', async () => {
      await reader.setMode('scroll');
      await reader.open('fb2');
      await reader.goToContentsItem(5);
      await highlights.selectWords(0, 1, 4);
      await highlights.popup.choose('yellow');
      check('one highlight saved', (await highlights.saved()).length === 1);
    });

    await step('Highlight a phrase in another chapter in pink', async () => {
      await reader.goToContentsItem(12);
      await highlights.selectWords(1, 3, 8);
      await highlights.popup.choose('pink');
      check('two highlights saved', (await highlights.saved()).length === 2);
    });
  },

  // After a restart
  async ({ step, waitFor, highlights, check }) => {
    await step('Both highlights are back, on the same text, in the same colours', async () => {
      await waitFor(`app.activeTab?.viewer`, 60000);
      const saved = await highlights.saved();
      const painted = await highlights.painted();
      check('two highlights are saved', saved.length === 2);
      check('both are painted', painted.length === 2 && painted.every((p) => p.painted));
      for (const h of saved) {
        const p = painted.find((x) => x.id === h.id);
        check(`"${h.quote.slice(0, 30)}…" is painted ${h.color} on its text`, p?.text === h.quote && p?.color === h.color, JSON.stringify(p?.text));
      }
    });
  },
];

module.exports.title = 'Highlights after the app is closed and started again';
