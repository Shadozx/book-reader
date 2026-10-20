// Background thread for DjVu: pages are decoded by djvu-rs (WebAssembly)
// so the UI never stalls, even on large color scans.
//
// Messages (request → response, with the same id):
//   { type: 'open', bytes }               → { pageCount, pages: [{ width, height, dpi }] }
//   { type: 'render', page, dpi }         → { width, height, pixels }   (pixels is RGBA, transferred without copying)
//   { type: 'text', page, dpi }           → { zones: [{ t, x, y, w, h }] | null }

import init, { WasmDocument } from 'app://bundle/node_modules/djvu-rs/djvu_rs.js';

let doc = null;
const ready = init();

const handlers = {
  async open({ bytes }) {
    doc = WasmDocument.from_bytes(bytes);
    const pageCount = doc.page_count();
    const pages = [];
    for (let i = 0; i < pageCount; i++) {
      const page = doc.page(i);
      const dpi = page.dpi() || 300;
      pages.push({ width: page.width_at(dpi), height: page.height_at(dpi), dpi });
      page.free();
    }
    return { pageCount, pages };
  },

  async render({ page: index, dpi }) {
    const page = doc.page(index);
    try {
      const width = page.width_at(dpi);
      const height = page.height_at(dpi);
      const pixels = page.render(dpi);
      return { result: { width, height, pixels }, transfer: [pixels.buffer] };
    } finally {
      page.free();
    }
  },

  async text({ page: index, dpi }) {
    const page = doc.page(index);
    try {
      const json = page.text_zones_json(dpi);
      return { zones: json ? JSON.parse(json) : null };
    } finally {
      page.free();
    }
  },
};

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    await ready;
    const out = await handlers[type](data);
    if (out?.transfer) self.postMessage({ id, result: out.result }, out.transfer);
    else self.postMessage({ id, result: out });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message ?? err) });
  }
};
