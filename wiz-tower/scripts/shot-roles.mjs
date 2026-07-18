import { chromium } from 'playwright-core';
const EXE = `${process.env.HOME}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`;
const DIR = '/tmp/claude-1000/-home-ivy-Work-tiny-games/415a3168-d52d-417d-ab56-32b66f9053ff/scratchpad';
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
const page = await ctx.newPage();
await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.wt);
await page.locator('.wt-class').first().click(); // Fire
await page.locator('#begin').click();
await page.waitForFunction(() => window.wt.game);
// Build a Turret, a Pylon (Structure=1), and an Emitter (Active=2) of different elements + support mobs.
await page.evaluate(() => {
  const g = window.wt.game;
  g.sim.player.currency = 5000;
  g.attune(1); g.attune(5); // Ice, Light
  g.buildTower({ x: 3, y: 6 }, 0, 2, 0); // Fire turret
  g.buildTower({ x: 2, y: 6 }, 0, 1, 1); // Fire PYLON (buff)
  g.buildTower({ x: 4, y: 7 }, 1, 1, 2); // Ice EMITTER (slow field)
  g.buildTower({ x: 3, y: 8 }, 5, 1, 2); // Light EMITTER (detect field)
  g.planWave();
  // hand-place support summons so they render in the build preview
  g.sim.spawnGroup(3, 1, 9, 1); // Warden (Trait 9)
  g.sim.spawnGroup(4, 4, 10, 1); // Totem (Trait 10)
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${DIR}/wt-roles.png` });
console.log('roles shot saved');
await browser.close();
