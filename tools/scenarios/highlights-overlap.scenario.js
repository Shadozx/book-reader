// A highlight made over part of another one lies on top of it

module.exports = async ({ step, reader, highlights, check, shot }) => {
  const { popup } = highlights;
  let wide;
  let inner;
  const byColor = async (color) => (await highlights.painted()).find((p) => p.color === color);

  await step('Highlight a long phrase in yellow', async () => {
    await reader.setMode('scroll');
    await reader.open('fb2');
    await reader.goToContentsItem(5);
    wide = await highlights.selectWords(1, 1, 9);
    await popup.choose('yellow');
    check('one yellow highlight', (await highlights.saved()).length === 1);
  });

  await step('Highlight a few words inside it in green', async () => {
    inner = await highlights.selectWords(1, 4, 6);
    await popup.choose('green');
    check('two highlights are saved', (await highlights.saved()).length === 2);
    const green = await byColor('green');
    const yellow = await byColor('yellow');
    check('the green words are painted green', green?.shown.join('') === inner && green.painted, JSON.stringify(green?.shown));
    check('yellow is painted only around them', yellow?.shown.length === 2 && !yellow.shown.join('').includes(inner) && yellow.painted, JSON.stringify(yellow?.shown));
    await shot('overlap-01-green-over-yellow');
  });

  await step('A click on the green words opens the green highlight', async () => {
    await highlights.clickOn(inner);
    check('green is marked in the popup', (await popup.markedColor()) === 'green');
  });

  await step('A click on the yellow part opens the yellow highlight', async () => {
    await highlights.clickOn(wide, 'start');
    check('yellow is marked in the popup', (await popup.markedColor()) === 'yellow');
  });

  await step('Deleting the green highlight shows the whole yellow one again', async () => {
    await highlights.clickOn(inner);
    await popup.delete();
    const painted = await highlights.painted();
    check('only the yellow highlight is left', painted.length === 1 && painted[0].color === 'yellow');
    check('it is painted whole again', painted[0]?.shown.join('') === wide && painted[0].painted, JSON.stringify(painted[0]?.shown));
  });
};

module.exports.title = 'A highlight over part of another one lies on top of it';
