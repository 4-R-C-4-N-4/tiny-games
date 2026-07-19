// Fold the built SPA into ONE self-contained .html: inline CSS + JS and embed
// lexicon.bin as base64, so the file opens straight from disk — no server, no
// network, the full 80k-word model included. Run after `vite build`.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const dist = 'dist';
let html = readFileSync(`${dist}/index.html`, 'utf8');
const assets = readdirSync(`${dist}/assets`);
const jsName = assets.find((f) => f.endsWith('.js'));
const cssName = assets.find((f) => f.endsWith('.css'));
let js = readFileSync(`${dist}/assets/${jsName}`, 'utf8');
const css = readFileSync(`${dist}/assets/${cssName}`, 'utf8');
const lexicon = readFileSync(`${dist}/lexicon.bin`);

// Keep the inline <script> from being closed early by any literal in the bundle.
js = js.split('</script>').join('<\\/script>');

html = html.replace(/<link[^>]*rel="stylesheet"[^>]*>/, `<style>${css}</style>`);
html = html.replace(
  /<script[^>]*src="[^"]*\.js"[^>]*><\/script>/,
  `<script>globalThis.LEXICON_B64=\`${lexicon.toString('base64')}\`;</script>\n` +
    `<script type="module">${js}</script>`,
);

writeFileSync(`${dist}/lexomancy.html`, html);
console.log(
  `wrote ${dist}/lexomancy.html (${(html.length / 1e6).toFixed(1)} MB, self-contained, ` +
    `${(lexicon.length / 1e6).toFixed(1)} MB lexicon embedded)`,
);
