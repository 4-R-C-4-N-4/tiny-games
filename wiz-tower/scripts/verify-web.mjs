// Headless end-to-end check of the Phase 1 playable: loads the built page in Chromium,
// exercises the real UI (palette + board clicks + controls), fast-forwards a wave, and
// asserts the loop actually ran without console/page errors. Screenshots to scratch.
import { chromium } from 'playwright-core';

const URL = process.env.WT_URL || 'http://localhost:5199/';
const EXE = process.env.WT_CHROME ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`;
const SHOT = process.argv[2] || '/tmp/claude-1000/-home-ivy-Work-tiny-games/415a3168-d52d-417d-ab56-32b66f9053ff/scratchpad/wiz-tower.png';

const errors = [];
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 420, height: 780 }, deviceScaleFactor: 2 });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.wt && window.wt.game, null, { timeout: 5000 });
await page.waitForTimeout(300); // let a few RAF frames render the build screen

const initial = await page.evaluate(() => ({ state: window.wt.game.state, wave: window.wt.game.wave, currency: window.wt.game.currency }));

// Exercise real input handlers: select the Fire tool (palette btn index 1 = first element)
// and place a couple of towers by clicking the canvas.
const toolButtons = page.locator('.wt-tool');
await toolButtons.nth(1).click(); // Fire element tool
const canvas = page.locator('#board');
const box = await canvas.boundingBox();
const CELL = box.width / 7;
const clickCell = (cx, cy) => canvas.click({ position: { x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL } });
await clickCell(2, 6);
await clickCell(4, 6);
await clickCell(3, 8);

const afterBuild = await page.evaluate(() => ({ towers: window.wt.game.sim.liveTowers().length, currency: window.wt.game.currency }));

// Scout (telegraph) then Start Wave via the real control buttons.
await page.getByText('Scout wave').click();
const telegraph = await page.locator('#telegraph').innerText();
await page.getByText('Start Wave').click();
const startedState = await page.evaluate(() => window.wt.game.state);

// Fast-forward the wave to completion inside the page (exercises the browser bundle's sim).
const result = await page.evaluate(() => {
  const g = window.wt.game;
  let guard = 0, maxMobs = 0;
  while (g.state === 'wave' && guard++ < 2000) {
    g.update(500);
    maxMobs = Math.max(maxMobs, g.sim.liveMobs().length);
  }
  return { state: g.state, wave: g.wave, coreFrac: g.coreHpFraction(), maxMobs };
});

// Switch to the distilled-net opponent and run a wave with it (exercises the bundled
// weights.json + JS forward pass in the browser).
await page.getByText('Net', { exact: true }).click();
const modelRun = await page.evaluate(() => {
  const g = window.wt.game;
  g.buildTower({ x: 2, y: 6 }, 0, 2, 0); // Fire T2 turret
  g.buildTower({ x: 4, y: 6 }, 0, 2, 0);
  g.startWave();
  let guard = 0, maxMobs = 0;
  while (g.state === 'wave' && guard++ < 2000) { g.update(500); maxMobs = Math.max(maxMobs, g.sim.liveMobs().length); }
  return { opponent: g.opponent, state: g.state, wave: g.wave, maxMobs };
});

await page.waitForTimeout(150);
await page.screenshot({ path: SHOT });
await browser.close();

// Assertions
const problems = [];
if (initial.state !== 'build') problems.push(`initial state ${initial.state} != build`);
if (afterBuild.towers !== 3) problems.push(`expected 3 towers, got ${afterBuild.towers}`);
if (afterBuild.currency >= initial.currency) problems.push('building did not spend currency');
if (!telegraph.includes('Incoming')) problems.push(`telegraph missing: "${telegraph}"`);
if (startedState !== 'wave') problems.push(`start did not enter wave (got ${startedState})`);
if (result.maxMobs <= 0) problems.push('no mobs ever spawned during the wave');
if (result.state === 'wave') problems.push('wave never terminated');
if (modelRun.opponent !== 'model') problems.push(`did not switch to net opponent (${modelRun.opponent})`);
if (modelRun.maxMobs <= 0) problems.push('net opponent spawned no mobs');
if (modelRun.state === 'wave') problems.push('net-opponent wave never terminated');

console.log('initial     ', initial);
console.log('afterBuild  ', afterBuild);
console.log('telegraph   ', telegraph);
console.log('wave result ', result);
console.log('model run   ', modelRun);
console.log('console errs', errors.length ? errors : 'none');
console.log('screenshot  ', SHOT);

if (problems.length || errors.length) {
  console.error('\nVERIFY FAILED:\n - ' + [...problems, ...errors].join('\n - '));
  process.exit(1);
}
console.log('\nVERIFY PASS ✓  — build phase, tower placement, telegraph, wave run, clean console');
