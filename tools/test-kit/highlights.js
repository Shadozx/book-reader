'use strict';
// Highlights in the active text book (FB2/EPUB).
//
//   selectWords(n, from, to)   drags the mouse over words from..to (0-based) of the n-th plain paragraph
//                              on the screen, like a user; returns the text that should now be selected
//   selectedText()             what is selected in the window
//   saved()                    the book's saved highlights ({ id, color, quote, anchor, … })
//   painted()                  what is painted: [{ id, color, text, shown, painted }]
//                              (shown: the visible pieces, not covered by later highlights; painted: really in the colour layer)
//   clickOn(text, at)          clicks the highlight with this text: the middle of its first line, or at: 'start'
//   isOnScreen(text)           whether the first line of the highlight with this text is inside the reading area
//   popup.isShown(), popup.markedColor(), popup.hasDelete()
//   popup.choose(color), popup.copy(), popup.delete()

const POPUP = `document.querySelector('.mark-popup')`;

module.exports = ({ exec, wait, act, click, drag }) => {
  const highlights = {
    async selectWords(n, from, to) {
      act(`select words ${from + 1}–${to + 1} of paragraph ${n + 1} on the screen`);
      const target = await exec(`(() => {
        const pane = app.activeTab.paneEl;
        const box = pane.getBoundingClientRect();
        const visible = (el) => { const r = el.getBoundingClientRect(); return r.top >= box.top && r.bottom <= box.bottom && r.left >= box.left && r.right <= box.right; };
        const paragraphs = [...pane.querySelectorAll('.chunk p')]
          .filter((p) => !p.closest('blockquote, h1, h2, h3, h4, h5, h6, .annotation, .note-popup') && visible(p))
          .filter((p) => (p.textContent.match(/\\S+/g) ?? []).length > ${to});
        const p = paragraphs[${n}];
        if (!p) return null;
        // Text nodes of the paragraph and where each one starts in its text
        const nodes = [];
        let text = '';
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) { nodes.push({ node: walker.currentNode, start: text.length }); text += walker.currentNode.data; }
        const words = [...text.matchAll(/\\S+/g)];
        const start = words[${from}].index;
        const end = words[${to}].index + words[${to}][0].length;
        const charRect = (pos) => {
          const n = nodes.findLast((x) => x.start <= pos);
          const r = document.createRange();
          r.setStart(n.node, pos - n.start);
          r.setEnd(n.node, pos - n.start + 1);
          return r.getBoundingClientRect();
        };
        const a = charRect(start);
        const b = charRect(end - 1);
        return { text: text.slice(start, end), x1: Math.ceil(a.left + 1), y1: Math.round(a.top + a.height / 2), x2: Math.floor(b.right - 1), y2: Math.round(b.top + b.height / 2) };
      })()`);
      if (!target) throw new Error(`No paragraph ${n + 1} with ${to + 1} words on the screen`);
      await drag(target.x1, target.y1, target.x2, target.y2);
      await wait(100);
      return target.text;
    },

    selectedText: () => exec(`getSelection().toString()`),

    saved: () => exec(`app.activeTab.record.highlights ?? []`),

    painted: () => exec(`app.activeTab.viewer.paintedHighlights?.() ?? []`),

    async clickOn(text, at = 'middle') {
      act(`click ${at === 'start' ? 'the start of ' : ''}the highlight "${text.slice(0, 30)}${text.length > 30 ? '…' : ''}"`);
      const mark = (await highlights.painted()).find((m) => m.text === text);
      if (!mark) throw new Error(`No painted highlight "${text}"`);
      const x = at === 'start' ? mark.rect.x + 4 : mark.rect.x + mark.rect.width / 2;
      await click(Math.round(x), Math.round(mark.rect.y + mark.rect.height / 2));
      await wait(150);
    },

    async isOnScreen(text) {
      const mark = (await highlights.painted()).find((m) => m.text === text);
      if (!mark || !mark.rect.width) return false;
      const box = await exec(`(() => { const r = app.activeTab.paneEl.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })()`);
      const r = mark.rect;
      return r.x >= box.left && r.y >= box.top && r.x + r.width <= box.right && r.y + r.height <= box.bottom;
    },

    popup: {
      isShown: () => exec(`!!${POPUP} && !${POPUP}.hidden`),
      markedColor: () => exec(`${POPUP}.querySelector('.mark-color.on')?.dataset.color ?? null`),
      hasDelete: () => exec(`!${POPUP}.querySelector('.mark-delete').hidden`),
      async choose(color) {
        act(`choose ${color} in the popup`);
        await exec(`${POPUP}.querySelector('.mark-color[data-color="${color}"]').click()`);
        await wait(150);
      },
      async copy() {
        act('click "Copy" in the popup');
        await exec(`${POPUP}.querySelector('.mark-copy').click()`);
        await wait(200);
      },
      async delete() {
        act('click "Delete" in the popup');
        await exec(`${POPUP}.querySelector('.mark-delete').click()`);
        await wait(150);
      },
    },
  };
  return highlights;
};
