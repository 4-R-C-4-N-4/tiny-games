import { chromium } from 'playwright-core';
const EXE = `${process.env.HOME}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`;
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await (await b.newContext({ serviceWorkers: 'block' })).newPage();
await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.wt);
await page.locator('.wt-class').first().click();
await page.locator('#begin').click();
await page.waitForFunction(() => window.wt.game);
// build a small defense, then play 2 waves via the real Begin path (so onWaveStart fires)
const out = await page.evaluate(async () => {
  const v = window.wt, g = v.game;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let w = 0; w < 2; w++) {
    g.attune(3); g.buildTower({x:3,y:6},0,1,0); g.buildTower({x:2,y:6},3,1,0);
    v.recorder.onWaveStart(g); g.startWave();       // mirrors the Begin button
    let guard = 0; while (g.state === 'wave' && guard++ < 400) { g.update(200); }
    v.recorder.onWaveEnd(g);
    await sleep(0);
    if (g.state === 'gameover') break;
  }
  const log = v.recorder.build(g);
  const r0 = log.records[0];
  return { count: v.recorder.count, records: log.records.length,
    firstBoardTowers: r0?.board?.towers?.length ?? 0, firstFeatures: r0?.features?.length ?? 0,
    hasOutcome: r0 ? (r0.coreHpBefore >= r0.coreHpAfter) : false, jsonBytes: JSON.stringify(log).length };
});
console.log('recorder:', JSON.stringify(out));
await b.close();
