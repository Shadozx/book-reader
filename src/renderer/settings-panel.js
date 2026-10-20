// Settings panel (the "T" button): theme, mode, font and spacing, PDF/DjVu options.
// Changes apply immediately; sliders update the book at most once per frame.

import { h } from './util.js';
import { t, LANGUAGES } from './i18n.js';

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
  ['Consolas, "Courier New", monospace', 'Consolas', { mono: true }],
];

// Sliders: settings key (also the label's translation key), range, step, value format
const SLIDERS = [
  { key: 'fontSize', min: 12, max: 40, step: 1, format: (v) => `${v} px` },
  { key: 'lineHeight', min: 1, max: 2.4, step: 0.05, format: (v) => v.toFixed(2) },
  { key: 'margin', min: 0, max: 160, step: 4, format: (v) => `${v} px` },
  // The rightmost position means "unlimited" (maxWidth = 0)
  { key: 'maxWidth', min: 400, max: 1600, step: 20, unlimited: 1600,
    format: (v) => (v === 0 ? t('settings.unlimited') : `${v} px`) },
  { key: 'indent', min: 0, max: 4, step: 0.25, format: (v) => `${v} em` },
  { key: 'paraSpacing', min: 0, max: 2, step: 0.1, format: (v) => `${v.toFixed(1)} em` },
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
    const label = t(`settings.${spec.key}`);
    const input = h('input', { type: 'range', min: spec.min, max: spec.max, step: spec.step, 'aria-label': label });
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
    const minus = h('button', { type: 'button', class: 'step-btn', title: t('settings.less'), 'aria-label': t('settings.lessOf', { label }) }, '−');
    const plus = h('button', { type: 'button', class: 'step-btn', title: t('settings.more'), 'aria-label': t('settings.moreOf', { label }) }, '+');
    minus.addEventListener('click', () => stepBy(-1));
    plus.addEventListener('click', () => stepBy(1));
    controls[spec.key] = {
      sync(v) {
        input.value = fromSetting(v);
        value.textContent = spec.format(v);
      },
    };
    return h('div', { class: 'setting' },
      h('div', { class: 'setting-head' }, h('span', {}, label), value),
      h('div', { class: 'slider-row' }, minus, input, plus));
  };

  const fontSelect = h('select', { class: 'font-select', 'aria-label': t('settings.font') },
    FONTS.map(([family, name, opts]) => h('option', { value: family, style: `font-family:${family}` }, opts?.mono ? t('settings.fontMono', { name }) : name)));
  fontSelect.addEventListener('change', () => update({ fontFamily: fontSelect.value }));
  controls.fontFamily = {
    sync(v) {
      if (![...fontSelect.options].some((o) => o.value === v)) fontSelect.append(h('option', { value: v }, v));
      fontSelect.value = v;
      fontSelect.style.fontFamily = v;
    },
  };

  const resetBtn = h('button', { type: 'button', class: 'reset-btn' }, t('settings.resetText'));
  resetBtn.addEventListener('click', () => {
    update(Object.fromEntries(TEXT_KEYS.map((k) => [k, defaults[k]])));
    sync();
  });

  const textSection = h('section', { class: 'settings-section' },
    h('h3', { 'data-dimmed': t('settings.notApplicable') }, `${t('settings.text')} `, h('span', { class: 'muted' }, t('settings.textFormats'))),
    h('div', { class: 'setting' }, h('div', { class: 'setting-head' }, h('span', {}, t('settings.font'))), fontSelect),
    ...SLIDERS.map(slider),
    h('div', { class: 'setting' },
      h('div', { class: 'setting-head' }, h('span', {}, t('settings.align'))),
      segmented('align', [['justify', t('settings.alignJustify')], ['left', t('settings.alignLeft')]])),
  );

  const el = h('div', { class: 'settings-popover', hidden: true, role: 'dialog', 'aria-label': t('settings.title') },
    h('section', { class: 'settings-section' },
      h('h3', {}, t('settings.language')),
      segmented('language', [['auto', t('settings.languageAuto')], ...LANGUAGES]),
      h('h3', {}, t('settings.theme')),
      segmented('theme', [['light', t('settings.themeLight')], ['sepia', t('settings.themeSepia')], ['dark', t('settings.themeDark')]]),
      h('h3', {}, t('settings.mode')),
      segmented('mode', [['scroll', t('settings.modeScroll')], ['paged', t('settings.modePaged')]]),
      checkbox('spread', t('settings.spread')),
    ),
    textSection,
    h('section', { class: 'settings-section' },
      h('h3', {}, `${t('settings.pages')} `, h('span', { class: 'muted' }, t('settings.pagesFormats'))),
      checkbox('invertDark', t('settings.invertDark')),
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
