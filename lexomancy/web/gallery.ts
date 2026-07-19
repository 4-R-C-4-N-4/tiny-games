import { STAT_HUES, enemyPalette, playerPalette, type SpriteArt } from '../src/sprites.ts';
import type { StatName } from '../src/stats.ts';
import { spriteCanvas } from './sprite-render.ts';

// Art-direction gallery: open the page with ?gallery to see every sprite
// class across sample theme palettes, and the player across all five stats.

const SAMPLE_THEMES: Array<[string, number]> = [
  ['bone', 40], ['frost', 190], ['ember', 20], ['venom', 90], ['dream', 260], ['blood', 0],
];

export function renderGallery(): void {
  document.body.replaceChildren();
  const root = document.createElement('div');
  root.id = 'gallery';
  document.body.appendChild(root);

  const h = document.createElement('h1');
  h.textContent = 'lexomancy sprite gallery — palette swaps by floor theme';
  root.appendChild(h);

  const enemies: Array<Exclude<SpriteArt, 'player'>> = [
    'necromancer', 'hierophant', 'stormcaller', 'mirror',
  ];
  for (const art of enemies) {
    const row = document.createElement('div');
    row.className = 'gallery-row';
    const label = document.createElement('span');
    label.className = 'gallery-label';
    label.textContent = art;
    row.appendChild(label);
    for (const [theme, hue] of SAMPLE_THEMES) {
      const cell = document.createElement('figure');
      cell.appendChild(spriteCanvas(art, enemyPalette(art, hue), 4));
      const cap = document.createElement('figcaption');
      cap.textContent = theme;
      cell.appendChild(cap);
      row.appendChild(cell);
    }
    root.appendChild(row);
  }

  const row = document.createElement('div');
  row.className = 'gallery-row';
  const label = document.createElement('span');
  label.className = 'gallery-label';
  label.textContent = 'player';
  row.appendChild(label);
  for (const stat of Object.keys(STAT_HUES) as StatName[]) {
    const cell = document.createElement('figure');
    cell.appendChild(spriteCanvas('player', playerPalette(stat), 4));
    const cap = document.createElement('figcaption');
    cap.textContent = stat;
    cell.appendChild(cap);
    row.appendChild(cell);
  }
  root.appendChild(row);
}
