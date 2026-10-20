'use strict';
// Draws the app icon (build/icon.png, 512×512): npx electron tools/make-icon.js

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const html = `<!doctype html><canvas id="c" width="512" height="512"></canvas><script>
const ctx = document.getElementById('c').getContext('2d');
// Тло: заокруглений квадрат із градієнтом
const g = ctx.createLinearGradient(0, 0, 512, 512);
g.addColorStop(0, '#3b7bea');
g.addColorStop(1, '#1f4fb5');
ctx.fillStyle = g;
ctx.beginPath();
ctx.roundRect(24, 24, 464, 464, 104);
ctx.fill();

// Відкрита книга: дві сторінки з вигином до корінця
function pageShape(side) {
  const s = side;               // -1 ліва, 1 права
  ctx.beginPath();
  ctx.moveTo(256, 168);
  ctx.bezierCurveTo(256 + s * 60, 132, 256 + s * 130, 128, 256 + s * 168, 140);
  ctx.lineTo(256 + s * 168, 378);
  ctx.bezierCurveTo(256 + s * 130, 366, 256 + s * 60, 370, 256, 404);
  ctx.closePath();
}
ctx.fillStyle = '#ffffff';
ctx.strokeStyle = '#ffffff';
ctx.lineJoin = 'round';
ctx.lineWidth = 14;
for (const side of [-1, 1]) {
  pageShape(side);
  ctx.fill();
  ctx.stroke();
}
// Рядки тексту
ctx.strokeStyle = '#9db8ee';
ctx.lineWidth = 10;
ctx.lineCap = 'round';
for (const side of [-1, 1]) {
  for (let i = 0; i < 4; i++) {
    const y = 200 + i * 42;
    ctx.beginPath();
    ctx.moveTo(256 + side * 40, y + 6);
    ctx.quadraticCurveTo(256 + side * 90, y - 10, 256 + side * 136, y - 4);
    ctx.stroke();
  }
}
// Корінець
ctx.strokeStyle = '#1f4fb5';
ctx.lineWidth = 8;
ctx.beginPath();
ctx.moveTo(256, 172);
ctx.lineTo(256, 398);
ctx.stroke();
</script>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 512, height: 512 });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const dataUrl = await win.webContents.executeJavaScript(`document.getElementById('c').toDataURL('image/png')`);
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('icon:', out);
  app.quit();
});
