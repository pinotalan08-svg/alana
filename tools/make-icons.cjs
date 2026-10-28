#!/usr/bin/env node
// Renders the app icons with the game's own vector glyphs (needs Playwright: `npm i -D playwright`).
// Usage: node tools/make-icons.cjs
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const scripts = ['js/util.js', 'js/data.js', 'js/gfx.js'].map((f) => fs.readFileSync(path.join(root, f), 'utf8'));

const ICONS = [
  { file: 'icons/icon-512.png', size: 512, inset: 0 },
  { file: 'icons/icon-192.png', size: 192, inset: 0 },
  { file: 'icons/apple-touch-icon.png', size: 180, inset: 0 },
  // maskable icons get cropped to a circle: keep the emblem inside the safe zone
  { file: 'icons/icon-maskable-512.png', size: 512, inset: 0.1 },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');
  for (const src of scripts) await page.addScriptTag({ content: src });
  for (const icon of ICONS) {
    const dataUrl = await page.evaluate(({ size, inset }) => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      // the abyss: black above, a furnace glow rising from below
      const bg = g.createLinearGradient(0, 0, 0, size);
      bg.addColorStop(0, '#0d070b');
      bg.addColorStop(0.65, '#1c0a0e');
      bg.addColorStop(1, '#3a1206');
      g.fillStyle = bg;
      g.fillRect(0, 0, size, size);
      const glow = g.createRadialGradient(size / 2, size * 0.95, 0, size / 2, size * 0.95, size * 0.75);
      glow.addColorStop(0, 'rgba(255,110,40,0.65)');
      glow.addColorStop(1, 'rgba(255,110,40,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, size, size);
      const inner = size * (1 - inset * 2), e = inner * 0.78;
      g.drawImage(emblemCanvas('sword', '#ffd98a', Math.round(e)), (size - e) / 2, (size - e) / 2 - size * 0.02, e, e);
      return c.toDataURL('image/png');
    }, icon);
    fs.writeFileSync(path.join(root, icon.file), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('wrote', icon.file);
  }
  await browser.close();
})();
