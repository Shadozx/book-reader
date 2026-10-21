'use strict';
// A copy of a test FB2 book that a scenario can edit on the disk, the way someone would edit the file.
// The places to edit are found by a piece of text in them (a highlight's quote, for example).
//
//   copy(role)                         copies the book into the scenario's results folder; returns the new path
//   insertParagraphBefore(file, text)  adds a new paragraph before the paragraph with this text
//   insertChapterBefore(file, text)    adds a new chapter before the chapter with this text
//   replaceText(file, text, by)        puts other text in place of this one
//   deleteParagraph(file, text)        removes the paragraph with this text
//   touch(file)                        writes the file again unchanged (only its date changes)

const fs = require('node:fs');
const path = require('node:path');

const NEW_TEXT = 'Цього абзацу не було, коли робили виділення: його дописали пізніше.';

module.exports = ({ book, outDir, act }) => {
  const name = (file) => path.basename(file);

  // Where the text is in the file; it must be there exactly once
  function find(xml, text) {
    const at = xml.indexOf(text);
    if (at < 0) throw new Error(`"${text}" is not in the file as plain text`);
    if (xml.indexOf(text, at + 1) >= 0) throw new Error(`"${text}" is in the file more than once`);
    return at;
  }

  function edit(file, change) {
    const xml = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, change(xml));
  }

  // Start and end of the element <tag> around position at
  function around(xml, at, tag) {
    const start = xml.lastIndexOf(`<${tag}>`, at);
    const end = xml.indexOf(`</${tag}>`, at) + `</${tag}>`.length;
    if (start < 0 || end < at) throw new Error(`No <${tag}> around position ${at}`);
    return [start, end];
  }

  const short = (text) => `"${text.slice(0, 30)}${text.length > 30 ? '…' : ''}"`;

  return {
    copy(role) {
      const dir = path.join(outDir, 'books');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, path.basename(book(role)));
      fs.copyFileSync(book(role), file);
      act(`copy book "${role}" to ${path.relative(outDir, file)}`);
      return file;
    },

    insertParagraphBefore(file, text) {
      act(`in ${name(file)}, add a paragraph before the one with ${short(text)}`);
      edit(file, (xml) => {
        const [start] = around(xml, find(xml, text), 'p');
        return `${xml.slice(0, start)}<p>${NEW_TEXT}</p>${xml.slice(start)}`;
      });
    },

    insertChapterBefore(file, text) {
      act(`in ${name(file)}, add a chapter before the one with ${short(text)}`);
      edit(file, (xml) => {
        const [start] = around(xml, find(xml, text), 'section');
        const chapter = `<section><title><p>Новий розділ</p></title><p>${NEW_TEXT}</p><p>${NEW_TEXT}</p></section>`;
        return `${xml.slice(0, start)}${chapter}${xml.slice(start)}`;
      });
    },

    replaceText(file, text, by) {
      act(`in ${name(file)}, change ${short(text)} to ${short(by)}`);
      edit(file, (xml) => {
        const at = find(xml, text);
        return xml.slice(0, at) + by + xml.slice(at + text.length);
      });
    },

    deleteParagraph(file, text) {
      act(`in ${name(file)}, delete the paragraph with ${short(text)}`);
      edit(file, (xml) => {
        const [start, end] = around(xml, find(xml, text), 'p');
        return xml.slice(0, start) + xml.slice(end);
      });
    },

    touch(file) {
      act(`write ${name(file)} again without changes`);
      const data = fs.readFileSync(file);
      fs.writeFileSync(file, data);
      // The date must differ from the one the app remembered, even on a coarse clock
      const later = new Date(fs.statSync(file).mtimeMs + 2000);
      fs.utimesSync(file, later, later);
    },
  };
};
