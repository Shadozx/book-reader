// Where a highlight is in a book, and finding it again after the book file has changed.
//
// The book's text is passed as an array of strings, one per part of the book (the viewer's parts).
// A highlight is remembered three ways, so it survives edits of the file:
//   anchor { c, start, end }  the part and the character positions in its text (fast, exact)
//   quote                     the highlighted text itself
//   prefix, suffix            some text just before and after it, in the same part
// locate() tries them in that order (the same idea as W3C Web Annotation text selectors).

export const CONTEXT = 32;
// How much longer than the old quote a changed one may be, when it's found between its prefix and suffix
const CHANGE_SLACK = 100;

export function describe(parts, c, start, end) {
  const text = parts[c];
  return {
    anchor: { c, start, end },
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
  };
}

// Length of the common end of a and b / of the common start of a and b
function commonEnd(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function commonStart(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

// Every position of needle in the parts: [{ c, start }]
function occurrences(parts, needle, limit = 2000) {
  const found = [];
  if (!needle) return found;
  for (let c = 0; c < parts.length && found.length < limit; c++) {
    for (let i = parts[c].indexOf(needle); i >= 0 && found.length < limit; i = parts[c].indexOf(needle, i + 1)) {
      found.push({ c, start: i });
    }
  }
  return found;
}

// The best candidate: the most matching context first, then the closest to where it used to be
function best(candidates, saved) {
  const { c, start } = saved.anchor;
  const distance = (x) => Math.abs(x.c - c) * 1e7 + Math.abs(x.start - start);
  return candidates.reduce((a, b) => (b.score > a.score || (b.score === a.score && distance(b) < distance(a)) ? b : a));
}

// Finds a saved highlight in the (possibly changed) text.
// Returns { c, start, end, status }: 'exact' (where it was), 'moved' (same text elsewhere),
// 'changed' (the text itself differs, found between its prefix and suffix) or 'lost' (c, start, end are null).
export function locate(parts, saved) {
  const { anchor, quote, prefix = '', suffix = '' } = saved;
  if (parts[anchor.c]?.slice(anchor.start, anchor.end) === quote) return { ...anchor, status: 'exact' };

  // The same text somewhere else; with several copies, the one whose surroundings match best
  const copies = occurrences(parts, quote).map((x) => {
    const text = parts[x.c];
    const end = x.start + quote.length;
    const score = commonEnd(prefix, text.slice(Math.max(0, x.start - CONTEXT), x.start)) + commonStart(suffix, text.slice(end, end + CONTEXT));
    return { c: x.c, start: x.start, end, score };
  });
  if (copies.length) {
    const { c, start, end } = best(copies, saved);
    return { c, start, end, status: 'moved' };
  }

  // The text was edited: look for its old surroundings, with a piece of a sensible length between them
  const maxLength = quote.length * 2 + CHANGE_SLACK;
  const between = [];
  if (prefix && suffix) {
    for (const p of occurrences(parts, prefix)) {
      const text = parts[p.c];
      const from = p.start + prefix.length;
      const s = text.indexOf(suffix, from);
      if (s >= 0 && s - from > 0 && s - from <= maxLength) {
        between.push({ c: p.c, start: from, end: s, score: -Math.abs(s - from - quote.length) });
      }
    }
  } else if (suffix) {
    // The highlight started its part: the part's start up to the old suffix
    for (const x of occurrences(parts, suffix)) {
      if (x.start > 0 && x.start <= maxLength) between.push({ c: x.c, start: 0, end: x.start, score: -Math.abs(x.start - quote.length) });
    }
  } else if (prefix) {
    // The highlight ended its part: the old prefix up to the part's end
    for (const x of occurrences(parts, prefix)) {
      const from = x.start + prefix.length;
      const rest = parts[x.c].length - from;
      if (rest > 0 && rest <= maxLength) between.push({ c: x.c, start: from, end: parts[x.c].length, score: -Math.abs(rest - quote.length) });
    }
  }
  if (between.length) {
    const { c, start, end } = best(between, saved);
    return { c, start, end, status: 'changed' };
  }
  return { c: null, start: null, end: null, status: 'lost' };
}
