'use strict';
// The two settings popovers.
//
// readingSettings (the "T" button on the toolbar):
//   open(), close(), isOpen()
//   setSlider(key, value)     moves a slider the way a user does (key: fontSize, lineHeight, margin…)
//   sliderText(key)           the value shown next to a slider
//   choose(value)             clicks a segmented button: light/sepia/dark, scroll/paged, justify/left
//   chooseFont(name)          picks a font in the list
//   resetText()               the "Reset font and spacing" button
//   isTextSectionDimmed()     whether the text section is greyed out (PDF/DjVu)
// appPanel (the gear button in the tab bar):
//   open(), close(), isOpen()
//   chooseLanguage('auto' | 'uk' | 'en')
//   dataButtons()             the labels of the "Data" buttons
//   clickDataButton(label)

function popover({ exec, wait, act }, { selector, button, name }) {
  const el = `document.querySelector('${selector}')`;
  return {
    el,
    async open() {
      act(`open ${name}`);
      await exec(`${el}.hidden && document.getElementById('${button}').click()`);
      await wait(100);
    },
    async close() {
      act(`close ${name}`);
      await exec(`!${el}.hidden && document.getElementById('${button}').click()`);
    },
    async clickButton() {
      act(`click the ${name} button`);
      await exec(`document.getElementById('${button}').click()`);
    },
    isOpen: () => exec(`!${el}.hidden`),
  };
}

function readingSettings(kit) {
  const { exec, wait, act } = kit;
  const base = popover(kit, { selector: '.reading-popover', button: 'btn-settings', name: 'reading settings' });
  const slider = (key) => `${base.el}.querySelector('input[data-key="${key}"]')`;
  return {
    ...base,
    async setSlider(key, value) {
      act(`set ${key} to ${value}`);
      await exec(`(() => { const r = ${slider(key)}; r.value = ${value}; r.dispatchEvent(new Event('input')); })()`);
      await wait(300);
    },
    sliderText: (key) => exec(`${slider(key)}.closest('.setting').querySelector('.slider-value').textContent`),
    async choose(value) {
      act(`choose "${value}"`);
      await exec(`${base.el}.querySelector('.seg button[data-value="${value}"]').click()`);
      await wait(300);
    },
    async chooseFont(name) {
      act(`choose the font ${name}`);
      await exec(`(() => { const s = ${base.el}.querySelector('.font-select'); s.value = [...s.options].find((o) => o.textContent === ${JSON.stringify(name)}).value; s.dispatchEvent(new Event('change')); })()`);
      await wait(300);
    },
    async resetText() {
      act('click "Reset font and spacing"');
      await exec(`${base.el}.querySelector('.reset-btn').click()`);
      await wait(300);
    },
    isTextSectionDimmed: () => exec(`${base.el}.querySelectorAll('.settings-section')[1].classList.contains('dimmed')`),
  };
}

function appPanel(kit) {
  const { exec, wait, act } = kit;
  const base = popover(kit, { selector: '.app-popover', button: 'btn-app', name: 'the app panel' });
  return {
    ...base,
    async chooseLanguage(code) {
      act(`choose the language "${code}"`);
      await exec(`${base.el}.querySelector('.seg button[data-value="${code}"]').click()`);
      await wait(300);
    },
    dataButtons: () => exec(`[...${base.el}.querySelectorAll('.data-section .data-btn')].map((b) => b.textContent)`),
    async clickDataButton(label) {
      act(`click "${label}"`);
      await exec(`[...${base.el}.querySelectorAll('.data-btn')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
      await wait(300);
    },
  };
}

module.exports = { readingSettings, appPanel };
