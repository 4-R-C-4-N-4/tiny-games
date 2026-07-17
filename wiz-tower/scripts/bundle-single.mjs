// Fold the built SPA into ONE self-contained .html file (inline JS, inline sigil) that
// opens straight from disk with no server. Run after `vite build`.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const dist = 'dist';
let html = readFileSync(`${dist}/index.html`, 'utf8');
const jsName = readdirSync(`${dist}/assets`).find((f) => f.endsWith('.js'));
let js = readFileSync(`${dist}/assets/${jsName}`, 'utf8');
const svg = readFileSync(`${dist}/art/affinity-sigil.svg`, 'utf8');

// Inline the sigil (referenced by <img src="./art/affinity-sigil.svg"> in the bundle).
const svgData = 'data:image/svg+xml,' + encodeURIComponent(svg);
js = js.split('./art/affinity-sigil.svg').join(svgData);
// Keep the inline <script> from being closed early by any literal in the bundle.
js = js.split('</script>').join('<\\/script>');

// Replace the external module script with the inlined bundle.
html = html.replace(/<script[^>]*src="[^"]*\.js"[^>]*><\/script>/, `<script type="module">${js}</script>`);

writeFileSync(`${dist}/wiz-tower.html`, html);
console.log(`wrote ${dist}/wiz-tower.html (${(html.length / 1024).toFixed(0)} KB, self-contained)`);
