// Capture build-phase and mid-wave screenshots of the live game for visual review.
import { chromium } from 'playwright-core';
const EXE = `${process.env.HOME}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`;
const DIR = '/tmp/claude-1000/-home-ivy-Work-tiny-games/415a3168-d52d-417d-ab56-32b66f9053ff/scratchpad';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
const page = await ctx.newPage();
await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.wt && window.wt.game);

// Build a defense + scry the wave, then shoot the build phase.
await page.evaluate(() => {
  const g = window.wt.game;
  g.attune(3); // Sonic (anti-air)
  g.buildTower({ x: 2, y: 6 }, 0, 2, 0); // Fire T2
  g.buildTower({ x: 4, y: 6 }, 0, 2, 0);
  g.buildTower({ x: 3, y: 4 }, 3, 1, 0); // Sonic T1
  g.buildWall({ x: 1, y: 5 }); g.buildWall({ x: 5, y: 5 });
  g.planWave();
});
await page.waitForTimeout(400);
await page.screenshot({ path: `${DIR}/wt-build.png` });

// Begin, speed up, let real-time frames render entities + beams + particles, drop a verb.
await page.evaluate(() => { window.wt.game.startWave(); window.wt.speed = 2; });
await page.waitForTimeout(2600);
await page.evaluate(() => { window.wt.game.verb({ kind: 'overcharge', cell: { x: 3, y: 6 } }); });
await page.waitForTimeout(500);
await page.screenshot({ path: `${DIR}/wt-wave.png` });

await browser.close();
console.log('shots saved');
