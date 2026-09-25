// Visual smoke test: drives a headless Chrome through home -> solo lobby -> game.
import { chromium } from 'playwright-core';
const base = process.argv[2] || 'http://127.0.0.1:5199/';
const out = process.argv[3] || './shots';
const vp = (process.argv[4] || '1280x800').split('x').map(Number);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: 1, hasTouch: vp[0] < 700 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
const tag = `${vp[0]}x${vp[1]}`;
await page.goto(base);
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/${tag}-1-home.png` });
await page.fill('#name-input', 'César');
await page.click('.action.primary');
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/${tag}-2-lobby.png`, fullPage: true });
await page.evaluate(() => {
  // speed up for the test
});
await page.click('.lobby-foot .btn.primary');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/${tag}-3-start.png` });
// play automatically: whenever a playable tile exists, click it (and first ghost if needed)
for (let i = 0; i < 90; i++) {
  const playable = await page.$('.hand-tile.playable');
  if (playable) {
    await playable.click();
    await page.waitForTimeout(250);
    const ghost = await page.$('.ghost');
    if (ghost) await ghost.dispatchEvent('pointerdown');
  }
  const cont = await page.$('.result-card .btn.primary:not([disabled])');
  if (cont) {
    await page.screenshot({ path: `${out}/${tag}-5-result-${i}.png` });
    if (await page.$('.match-over')) break;
    await cont.click();
  }
  await page.waitForTimeout(700);
  if (i === 6) await page.screenshot({ path: `${out}/${tag}-4-mid.png` });
  if (i === 14) await page.screenshot({ path: `${out}/${tag}-4-mid2.png` });
}
await page.screenshot({ path: `${out}/${tag}-6-end.png` });
console.log('errors:', JSON.stringify(errors.slice(0, 20), null, 1));
await browser.close();
