// Settings panel (the "T" button): theme, mode, font and spacing, PDF/DjVu options.
// Changes apply immediately; sliders update the book at most once per frame.

import { h } from './util.js';

// Fonts available on every Windows 10/11
const FONTS = [
  ['Georgia, "Times New Roman", serif', 'Georgia'],
  ['"Times New Roman", Times, serif', 'Times New Roman'],
  ['Cambria, Georgia, serif', 'Cambria'],
  ['Constantia, Georgia, serif', 'Constantia'],
  ['"Palatino Linotype", "Book Antiqua", serif', 'Palatino Linotype'],
  ['"Book Antiqua", "Palatino Linotype", serif', 'Book Antiqua'],
  ['"Sitka Text", Georgia, serif', 'Sitka Text'],
  ['"Segoe UI", system-ui, sans-serif', 'Segoe UI'],
  ['Calibri, "Segoe UI", sans-serif', 'Calibri'],
  ['Candara, "Segoe UI", sans-serif', 'Candara'],
  ['Corbel, "Segoe UI", sans-serif', 'Corbel'],
  ['Arial, Helvetica, sans-serif', 'Arial'],
  ['Verdana, Geneva, sans-serif', 'Verdana'],
  ['Tahoma, Verdana, sans-serif', 'Tahoma'],
  ['"Trebuchet MS", sans-serif', 'Trebuchet MS'],
  ['Consolas, "Courier New", monospace', 'Consolas (моноширинний)'],
];

// Sliders: settings key, label, range, step, value format
const SLIDERS = [
  { key: 'fontSize', label: 'Розмір шрифту', min: 12, max: 40, step: 1, format: (v) => `${v} px` },
  { key: 'lineHeight', label: 'Міжрядковий інтервал', min: 1, max: 2.4, step: 0.05, format: (v) => v.toFixed(2) },
  { key: 'margin', label: 'Поля', min: 0, max: 160, step: 4, format: (v) => `${v} px` },
  // The rightmost position means "unlimited" (maxWidth = 0)
  { key: 'maxWidth', label: 'Ширина колонки', min: 400, max: 1600, step: 20, unlimited: 1600,
    format: (v) => (v === 0 ? 'без обмеження' : `${v} px`) },
  { key: 'indent', label: 'Абзацний відступ', min: 0, max: 4, step: 0.25, format: (v) => `${v} em` },
  { key: 'paraSpacing', label: 'Відстань між абзацами', min: 0, max: 2, step: 0.1, format: (v) => `${v.toFixed(1)} em` },
];

// What the "Reset" button resets (theme and mode stay as they are)
const TEXT_KEYS = ['fontFamily', 'fontSize', 'lineHeight', 'margin', 'maxWidth', 'indent', 'paraSpacing', 'align'];

export function createSettingsPanel({ getSettings, update, defaults, extra = null }) {
  const controls = {};

  // Update the book at most once per frame
  let pending = null;
  let frame = 0;
  const schedule = (patch) => {
    pending = { ...pending, ...patch };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const p = pending;
      pending = null;
      update(p);
    });
  };

  const segmented = (key, options) => {
    const group = h('div', { class: 'seg', role: 'radiogroup' });
    for (const [value, label] of options) {
      const btn = h('button', { type: 'button', 'data-value': value, role: 'radio' }, label);
      btn.addEventListener('click', () => {
        update({ [key]: value });
        sync();
      });
      group.append(btn);
    }
    controls[key] = {
      sync(v) {
        for (const b of group.children) {
          const on = b.dataset.value === String(v);
          b.classList.toggle('on', on);
          b.setAttribute('aria-checked', on);
        }
      },
    };
    return group;
  };

  const checkbox = (key, label) => {
    const input = h('input', { type: 'checkbox' });
    input.addEventListener('change', () => update({ [key]: input.checked }));
    controls[key] = { sync: (v) => { input.checked = !!v; } };
    return h('label', { class: 'check' }, input, h('span', {}, label));
  };

  const slider = (spec) => {
    const input = h('input', { type: 'range', min: spec.min, max: spec.max, step: spec.step, 'aria-label': spec.label });
    const value = h('span', { class: 'slider-value' });
    const toSetting = (raw) => (spec.unlimited && raw >= spec.unlimited ? 0 : raw);
    const fromSetting = (v) => (spec.unlimited && v === 0 ? spec.unlimited : v);
    input.addEventListener('input', () => {
      const v = toSetting(Number(input.value));
      value.textContent = spec.format(v);
      schedule({ [spec.key]: v });
    });
    const stepBy = (dir) => {
      const next = Math.min(spec.max, Math.max(spec.min, Number(input.value) + dir * spec.step));
      input.value = next;
      input.dispatchEvent(new Event('input'));
    };
    const minus = h('button', { type: 'button', class: 'step-btn', title: 'Менше', 'aria-label': `${spec.label}: менше` }, '−');
    const plus = h('button', { type: 'button', class: 'step-btn', title: 'Більше', 'aria-label': `${spec.label}: більше` }, '+');
    minus.addEventListener('click', () => stepBy(-1));
    plus.addEventListener('click', () => stepBy(1));
    controls[spec.key] = {
      sync(v) {
        input.value = fromSetting(v);
        value.textContent = spec.format(v);
      },
    };
    return h('div', { class: 'setting' },
      h('div', { class: 'setting-head' }, h('span', {}, spec.label), value),
      h('div', { class: 'slider-row' }, minus, input, plus));
  };

  const fontSelect = h('select', { class: 'font-select', 'aria-label': 'Шрифт' },
    FONTS.map(([family, name]) => h('option', { value: family, style: `font-family:${family}` }, name)));
  fontSelect.addEventListener('change', () => update({ fontFamily: fontSelect.value }));
  controls.fontFamily = {
    sync(v) {
      if (![...fontSelect.options].some((o) => o.value === v)) fontSelect.append(h('option', { value: v }, v));
      fontSelect.value = v;
      fontSelect.style.fontFamily = v;
    },
  };

  const resetBtn = h('button', { type: 'button', class: 'reset-btn' }, 'Скинути шрифт і відступи');
  resetBtn.addEventListener('click', () => {
    update(Object.fromEntries(TEXT_KEYS.map((k) => [k, defaults[k]])));
    sync();
  });

  const textSection = h('section', { class: 'settings-section' },
    h('h3', {}, 'Текст ', h('span', { class: 'muted' }, '· FB2 та EPUB')),
    h('div', { class: 'setting' }, h('div', { class: 'setting-head' }, h('span', {}, 'Шрифт')), fontSelect),
    ...SLIDERS.map(slider),
    h('div', { class: 'setting' },
      h('div', { class: 'setting-head' }, h('span', {}, 'Вирівнювання')),
      segmented('align', [['justify', 'По ширині'], ['left', 'По лівому краю']])),
  );

  const el = h('div', { class: 'settings-popover', hidden: true, role: 'dialog', 'aria-label': 'Налаштування' },
    h('section', { class: 'settings-section' },
      h('h3', {}, 'Тема'),
      segmented('theme', [['light', 'Світла'], ['sepia', 'Сепія'], ['dark', 'Темна']]),
      h('h3', {}, 'Режим читання'),
      segmented('mode', [['scroll', 'Прокрутка'], ['paged', 'Сторінки']]),
      checkbox('spread', 'Дві сторінки поруч на широкому екрані'),
    ),
    textSection,
    h('section', { class: 'settings-section' },
      h('h3', {}, 'Сторінки ', h('span', { class: 'muted' }, '· PDF та DjVu')),
      checkbox('invertDark', 'Інвертувати сторінки в темній темі'),
    ),
    resetBtn,
    extra,
  );

  function sync() {
    const s = getSettings();
    for (const [key, control] of Object.entries(controls)) control.sync(s[key]);
  }

  return {
    el,
    sync,
    get open() {
      return !el.hidden;
    },
    setOpen(open, { textApplies = true } = {}) {
      el.hidden = !open;
      if (open) {
        sync();
        textSection.classList.toggle('dimmed', !textApplies);
      }
    },
  };
}
