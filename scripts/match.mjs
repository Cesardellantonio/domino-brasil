import { chromium } from 'playwright-core';
const out = process.argv[2];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'pt-BR' })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://127.0.0.1:5199/');
await page.fill('#name-input', 'César');
await page.click('.action.primary');
await page.waitForTimeout(500);
await page.click(".segmented button:text-is(\"50\")");
await page.click('.segmented button:has-text("Rápido")');
await page.click('.lobby-foot .btn.primary');
let shotMid = false;
for (let i = 0; i < 400; i++) {
  const p = await page.$('.hand-tile.playable');
  if (p) { await p.click(); await page.waitForTimeout(150); const g = await page.$('.ghost'); if (g) await g.dispatchEvent('pointerdown'); }
  if (!shotMid && (await page.$('.banner'))) { await page.waitForTimeout(250); await page.screenshot({ path: `${out}/banner.png` }); shotMid = true; }
  if (await page.$('.match-over')) break;
  const c = await page.$('.result-card .btn.primary:not([disabled])');
  if (c) {
    if (!globalThis.shotRes) { await page.waitForTimeout(1500); await page.screenshot({ path: `${out}/hand-result.png` }); globalThis.shotRes = 1; }
    await c.click();
  }
  await page.waitForTimeout(300);
}
await page.waitForTimeout(2600);
await page.screenshot({ path: `${out}/matchover.png` });
await page.click('.result-card .btn.primary'); // rematch
await page.waitForTimeout(1500);
console.log('after rematch game visible:', !!(await page.$('.hand-tile')));
await page.goto('http://127.0.0.1:5199/#/');
await page.waitForTimeout(500);
await page.click('.home-links button:nth-child(2)');
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/history.png` });
console.log('errors', errs);
await browser.close();
