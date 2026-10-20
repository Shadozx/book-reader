// On-demand loading of third-party libraries (only when the matching format is opened)
import { t } from './i18n.js';

const BASE = 'app://bundle';

let jszipPromise = null;
export function loadJSZip() {
  // jszip.min.js is a UMD script that registers the global window.JSZip
  jszipPromise ??= import(`${BASE}/node_modules/jszip/dist/jszip.min.js`).then(() => window.JSZip);
  return jszipPromise;
}

let pdfjsPromise = null;
export function loadPdfjs() {
  pdfjsPromise ??= import(`${BASE}/node_modules/pdfjs-dist/build/pdf.mjs`).then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = `${BASE}/node_modules/pdfjs-dist/build/pdf.worker.mjs`;
    return pdfjs;
  });
  return pdfjsPromise;
}

let djvuPromise = null;
export function loadDjVu() {
  // djvu.js is a classic (non-module) script that declares the global DjVu
  djvuPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${BASE}/vendor/djvu.js`;
    script.onload = () => resolve(window.DjVu);
    script.onerror = () => reject(new Error(t('error.djvuLibrary')));
    document.head.append(script);
  });
  return djvuPromise;
}
