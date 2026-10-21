// Finding a highlight again in the text of a changed book (src/renderer/anchors.js), no interface involved

// A book of three parts; the highlighted phrase is in the second one
const BOOK = [
  'Перша частина. Вітер гнав хмари над старим містом, а капітан мовчки дивився на море.',
  'Друга частина. Маяк світив усю ніч, і кожен мандрівник знаходив дорогу додому. Ранком стало тихо.',
  'Третя частина. Учитель писав лист, поки за вікном падав сніг.',
];
const PHRASE = 'кожен мандрівник знаходив дорогу додому';

// Runs a case in the window: highlights PHRASE in BOOK, lets edit() change the book, then locates it.
// Returns what was found and the text at that place.
const tryCase = (exec, edit) => exec(`(async () => {
  const { describe, locate } = await import('./anchors.js');
  const book = ${JSON.stringify(BOOK)};
  const start = book[1].indexOf(${JSON.stringify(PHRASE)});
  const saved = describe(book, 1, start, start + ${PHRASE.length});
  const changed = (${edit})(structuredClone(book));
  const found = locate(changed, saved);
  return { ...found, text: found.c === null ? null : changed[found.c].slice(found.start, found.end) };
})()`);

module.exports = async ({ step, exec, check }) => {
  await step('An unchanged book: the highlight is where it was', async () => {
    const r = await tryCase(exec, `(book) => book`);
    check('found exactly in place', r.status === 'exact' && r.c === 1 && r.text === PHRASE, JSON.stringify(r));
  });

  await step('Text inserted before it in the same part', async () => {
    const r = await tryCase(exec, `(book) => { book[1] = 'Новий абзац на початку. ' + book[1]; return book; }`);
    check('found the same phrase further on', r.status === 'moved' && r.c === 1 && r.text === PHRASE, JSON.stringify(r));
  });

  await step('A whole part inserted before it', async () => {
    const r = await tryCase(exec, `(book) => { book.splice(1, 0, 'Вставлена частина без цієї фрази.'); return book; }`);
    check('found in the next part', r.status === 'moved' && r.c === 2 && r.text === PHRASE, JSON.stringify(r));
  });

  await step('The phrase appears twice: the copy with the same surroundings wins', async () => {
    // A decoy copy in the same part, closer to the old position than the real one
    const r = await tryCase(exec, `(book) => {
      book[1] = book[1].replace('Друга частина. ', 'Друга частина. Хтось сказав: ${PHRASE}, але не повірив. ');
      return book;
    }`);
    const realStart = BOOK[1].indexOf(PHRASE) + `Хтось сказав: ${PHRASE}, але не повірив. `.length;
    check('found the copy with the old surroundings, not the nearer decoy', r.status === 'moved' && r.c === 1 && r.start === realStart && r.text === PHRASE, JSON.stringify(r));
  });

  await step('A word inside the phrase changed', async () => {
    const r = await tryCase(exec, `(book) => { book[1] = book[1].replace('мандрівник', 'подорожній'); return book; }`);
    check('found the edited phrase between its old surroundings', r.status === 'changed' && r.c === 1 && r.text === 'кожен подорожній знаходив дорогу додому', JSON.stringify(r));
  });

  await step('The sentence with the phrase was deleted', async () => {
    const r = await tryCase(exec, `(book) => { book[1] = 'Друга частина. Ранком стало тихо.'; return book; }`);
    check('reported as lost', r.status === 'lost' && r.c === null, JSON.stringify(r));
  });
};

module.exports.title = 'Finding a highlight again after the book text changed';
