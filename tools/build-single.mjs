#!/usr/bin/env node
// Bundles the whole game into one self-contained HTML file: dist/abysses.html.
// Handy to send to a phone or play offline without a web server.
// Usage: node tools/build-single.mjs [--out=path/to/file.html]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.find((a) => a.startsWith('--out='));
const out = outArg ? outArg.slice('--out='.length) : join(root, 'dist', 'abysses.html');
const read = (file) => readFileSync(join(root, file), 'utf8');

let html = read('index.html');
const scripts = [...html.matchAll(/<script src="(js\/[^"]+)"><\/script>\n?/g)];
const js = scripts.map((m) => read(m[1])).join('\n');
if (js.includes('</script')) throw new Error('A script contains "</script", which would break inlining.');

html = html
  .replace(/<link rel="stylesheet" href="css\/style.css">/, () => `<style>\n${read('css/style.css')}</style>`)
  .replace(/<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\n/g, '');
for (const m of scripts) html = html.replace(m[0], '');
html = html.replace('</body>', () => `<script>window.ABYSSES_NO_SW = true;</script>\n<script>\n${js}</script>\n</body>`);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`wrote ${out} (${Math.round(html.length / 1024)} KB)`);
