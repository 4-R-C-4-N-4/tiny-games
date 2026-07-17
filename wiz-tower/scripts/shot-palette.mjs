import { chromium } from 'playwright-core';
const EXE = `${process.env.HOME}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`;
const DIR = '/tmp/claude-1000/-home-ivy-Work-tiny-games/415a3168-d52d-417d-ab56-32b66f9053ff/scratchpad';
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
const page = await ctx.newPage();
await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.wt);
// Choose ICE (class card index 1) and begin, so Fire is a NON-starting school.
await page.locator('.wt-class').nth(1).click();
await page.locator('#begin').click();
await page.waitForFunction(() => window.wt.game);
await page.waitForTimeout(300);
// Read what each element button shows.
const labels = await page.evaluate(() => [...document.querySelectorAll('#palette .wt-tool')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()));
console.log('starting = Ice. palette buttons:', labels);
// crop to the palette
const box = await page.locator('#palette').boundingBox();
await page.screenshot({ path: `${DIR}/wt-palette.png`, clip: { x: box.x - 4, y: box.y - 4, width: box.width + 8, height: box.height + 8 } });
await browser.close();
