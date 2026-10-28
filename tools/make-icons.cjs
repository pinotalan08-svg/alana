#!/usr/bin/env node
// Renders the app icons from the game's own sprites (needs Playwright: `npm i -D playwright`).
// Usage: node tools/make-icons.cjs
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const scripts = ['js/util.js', 'js/data.js', 'js/sprites.js'].map((f) => fs.readFileSync(path.join(root, f), 'utf8'));

const ICONS = [
  { file: 'icons/icon-512.png', size: 512, inset: 0 },
  { file: 'icons/icon-192.png', size: 192, inset: 0 },
  { file: 'icons/apple-touch-icon.png', size: 180, inset: 0 },
  // maskable icons get cropped to a circle: keep the hero inside the safe zone
  { file: 'icons/icon-maskable-512.png', size: 512, inset: 0.12 },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');
  for (const src of scripts) await page.addScriptTag({ content: src });
  for (const icon of ICONS) {
    const dataUrl = await page.evaluate(({ size, inset }) => {
      buildSprites();
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.fillStyle = '#0b0910';
      g.fillRect(0, 0, size, size);
      const glow = g.createRadialGradient(size / 2, size * 0.58, 0, size / 2, size * 0.58, size * 0.62);
      glow.addColorStop(0, 'rgba(242,160,61,0.55)');
      glow.addColorStop(0.45, 'rgba(168,88,26,0.22)');
      glow.addColorStop(1, 'rgba(11,9,16,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, size, size);
      const inner = size * (1 - inset * 2);
      const k = Math.floor((inner * 0.62) / 8);
      const x = Math.round((size - 8 * k) / 2), y = Math.round((size - 8 * k) / 2 + size * 0.03);
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.beginPath();
      g.ellipse(size / 2, y + 8 * k - k * 0.2, 8 * k * 0.36, k * 1.1, 0, 0, Math.PI * 2);
      g.fill();
      g.drawImage(SPR.hero.img, x, y, 8 * k, 8 * k);
      return c.toDataURL('image/png');
    }, icon);
    fs.writeFileSync(path.join(root, icon.file), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('wrote', icon.file);
  }
  await browser.close();
})();
