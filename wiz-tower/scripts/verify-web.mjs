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
// Block the service worker so each run always tests the freshly built bundle, not a cache.
const context = await browser.newContext({ viewport: { width: 420, height: 780 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.wt, null, { timeout: 5000 });
// Discipline-select: choose the first class (Fire) and begin the run (default Search foe).
await page.locator('.wt-class').first().click();
await page.locator('#begin').click();
await page.waitForFunction(() => window.wt.game, null, { timeout: 5000 });
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
await page.getByText('Scry wave').click();
const telegraph = await page.locator('#telegraph').innerText();
await page.getByText('▶ Begin').click();
const startedState = await page.evaluate(() => window.wt.game.state);

// Fast-forward the wave to completion inside the page (exercises the browser bundle's sim),
// firing an in-wave verb partway through.
const result = await page.evaluate(() => {
  const g = window.wt.game;
  let guard = 0, maxMobs = 0, usedVerb = false, verbOk = false;
  while (g.state === 'wave' && guard++ < 40000) {
    g.update(20); // fine steps so we actually sample mid-wave (short waves resolve fast)
    const live = g.sim.liveMobs().length;
    maxMobs = Math.max(maxMobs, live);
    if (!usedVerb && live > 0) { usedVerb = true; verbOk = g.verb({ kind: 'overcharge', cell: { x: 3, y: 6 } }); }
  }
  return { state: g.state, wave: g.wave, coreFrac: g.coreHpFraction(), maxMobs, verbOk, verbsLeft: g.verbsLeft };
});
// Back in the build phase, the telegraph area should show the post-wave recap.
const recapText = await page.locator('#telegraph').innerText();

// New run against the distilled-net opponent (exercises the bundled weights.json + JS
// forward pass): back to the discipline screen, pick the Net foe + Fire, begin.
await page.locator('#newrun').click();
await page.getByText('Net', { exact: true }).click();
await page.locator('.wt-class').first().click();
await page.locator('#begin').click();
await page.waitForFunction(() => window.wt.game && window.wt.game.opponent === 'model', null, { timeout: 5000 });
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
if (!telegraph.includes('Scried')) problems.push(`telegraph missing: "${telegraph}"`);
if (startedState !== 'wave') problems.push(`start did not enter wave (got ${startedState})`);
if (result.maxMobs <= 0) problems.push('no mobs ever spawned during the wave');
if (result.state === 'wave') problems.push('wave never terminated');
if (!result.verbOk) problems.push('in-wave verb (overcharge) did not apply');
if (result.verbsLeft !== 1) problems.push(`verb charge not spent (left ${result.verbsLeft})`);
if (!/Wave 1/.test(recapText)) problems.push(`post-wave recap missing: "${recapText}"`);
if (modelRun.opponent !== 'model') problems.push(`did not switch to net opponent (${modelRun.opponent})`);
if (modelRun.maxMobs <= 0) problems.push('net opponent spawned no mobs');
if (modelRun.state === 'wave') problems.push('net-opponent wave never terminated');

console.log('initial     ', initial);
console.log('afterBuild  ', afterBuild);
console.log('telegraph   ', telegraph);
console.log('wave result ', result);
console.log('recap       ', recapText);
console.log('model run   ', modelRun);
console.log('console errs', errors.length ? errors : 'none');
console.log('screenshot  ', SHOT);

if (problems.length || errors.length) {
  console.error('\nVERIFY FAILED:\n - ' + [...problems, ...errors].join('\n - '));
  process.exit(1);
}
console.log('\nVERIFY PASS ✓  — build phase, tower placement, telegraph, wave run, clean console');
