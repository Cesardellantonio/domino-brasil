import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await page.goto('http://127.0.0.1:5199/');
await page.fill('#name-input', 'Tester');
await page.click('.action.primary');
await page.waitForTimeout(500);
await page.click('.lobby-foot .btn.primary');
for (let i = 0; i < 80; i++) {
  const p = await page.$('.hand-tile.playable');
  if (p) { await p.click(); await page.waitForTimeout(200); const g = await page.$('.ghost'); if (g) await g.dispatchEvent('pointerdown'); }
  if (await page.$('.result-card')) break;
  await page.waitForTimeout(600);
}
await page.waitForTimeout(3000);
const info = await page.evaluate(() => [...document.querySelectorAll('.reveal-row')].map(r => {
  const tiles = [...r.querySelectorAll('.reveal-tile')];
  return { n: tiles.length, ops: tiles.map(t => getComputedStyle(t).opacity + '/' + t.getBoundingClientRect().width.toFixed(0) + 'x' + t.getBoundingClientRect().height.toFixed(0)), html: tiles[0]?.innerHTML.slice(0, 120) };
}));
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: process.argv[2] });
await browser.close();
