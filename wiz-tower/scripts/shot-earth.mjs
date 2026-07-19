import { chromium } from 'playwright-core';
const EXE = `${process.env.HOME}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`;
const DIR = '/tmp/claude-1000/-home-ivy-Work-tiny-games/415a3168-d52d-417d-ab56-32b66f9053ff/scratchpad';
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 400, height: 720 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
const page = await ctx.newPage();
await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.wt);
// pick Geomancy (Earth) — 3rd class card
await page.locator('.wt-class').nth(2).click();
await page.locator('#begin').click();
await page.waitForFunction(() => window.wt.game);
await page.evaluate(() => {
  const g = window.wt.game; g.sim.player.currency = 5000;
  // a line of Earth turrets = a shooting wall (row 7), gap at x=3
  for (let x=0;x<7;x++) if (x!==3) g.buildTower({x,y:7}, 2, 1, 0); // element 2 = Earth
  g.buildTower({x:3,y:9}, 2, 2, 0); g.buildTower({x:2,y:9}, 2, 1, 0); g.buildTower({x:4,y:9}, 2, 1, 0);
  g.planWave();
});
await page.waitForTimeout(400);
await page.screenshot({ path: `${DIR}/wt-earth.png` });
console.log('earth shot saved'); await b.close();
