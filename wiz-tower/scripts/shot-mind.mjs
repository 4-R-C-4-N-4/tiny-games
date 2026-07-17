// Capture the L3 Strategist ("Mind") after a few waves, showing its stated intent.
import { chromium } from 'playwright-core';
const EXE = `${process.env.HOME}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`;
const DIR = '/tmp/claude-1000/-home-ivy-Work-tiny-games/415a3168-d52d-417d-ab56-32b66f9053ff/scratchpad';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 400, height: 960 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
const page = await ctx.newPage();
await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.wt && window.wt.game);

await page.evaluate(() => { window.wt.diffChoice = 2; });
await page.getByText('Mind', { exact: true }).click();
// One completed wave against a pure-Fire, no-anti-air defense is enough for a read.
await page.evaluate(() => {
  const g = window.wt.game;
  for (const [x, y] of [[1, 5], [2, 5], [3, 6], [4, 6], [2, 8]]) g.buildTower({ x, y }, 0, 1, 0); // Fire T1 ward line
  g.buildWall({ x: 3, y: 4 }); g.buildWall({ x: 3, y: 5 });
  g.startWave();
  let n = 0; while (g.state === 'wave' && n++ < 500) g.update(5000);
});
// Wave 2: reinforce + scry, so the evolved intent shows above the telegraph.
await page.evaluate(() => { const g = window.wt.game; if (g.state === 'build') { g.buildTower({ x: 5, y: 5 }, 0, 1, 0); g.planWave(); } });
await page.waitForTimeout(500);
const intent = await page.locator('#telegraph').innerText();
await page.screenshot({ path: `${DIR}/wt-mind.png` });
await browser.close();
console.log('intent:', intent);
