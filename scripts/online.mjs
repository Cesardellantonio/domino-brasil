// Two independent browsers: host creates an online table, guest joins by link, both play a hand.
import { chromium } from 'playwright-core';
const base = process.argv[2] || 'http://127.0.0.1:5199/';
const out = process.argv[3];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const mk = async (w, h) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && page.errors.push(m.text()));
  return page;
};
const host = await mk(1100, 760);
const guest = await mk(390, 844);
await host.goto(base);
await host.fill('#name-input', 'César');
await host.click('.action:has-text("online"), .action:nth-of-type(2)');
await host.waitForSelector('.room-code', { timeout: 15000 });
const code = (await host.textContent('.room-code')).trim();
console.log('room', code);
// wait for peer registration
await host.waitForTimeout(2500);
const t0 = Date.now();
await guest.goto(`${base}#/m/${code}`);
await guest.fill('#gate-name', 'Pai');
await guest.click('.who .btn.primary');
await guest.waitForSelector('.lobby', { timeout: 30000 });
console.log('guest joined lobby in', Date.now() - t0, 'ms');
await host.waitForTimeout(1500);
await host.screenshot({ path: `${out}/online-host-lobby.png`, fullPage: true });
await guest.screenshot({ path: `${out}/online-guest-lobby.png`, fullPage: true });
const seats = await host.$$eval('.lobby-seat .ls-name', (els) => els.map((e) => e.textContent));
console.log('host sees seats:', seats);
await host.click('.lobby-foot .btn.primary');
await guest.waitForSelector('.game', { timeout: 10000 });
const play = async (p) => {
  const t = await p.$('.hand-tile.playable');
  if (t) {
    await t.click();
    await p.waitForTimeout(200);
    const g = await p.$('.ghost');
    if (g) await g.dispatchEvent('pointerdown');
  }
};
for (let i = 0; i < 80; i++) {
  await play(host);
  await play(guest);
  if (i === 2) await guest.evaluate(() => document.querySelector('.emote-wrap .icon-btn')?.click());
  if (i === 3) await guest.evaluate(() => document.querySelector('.emote-phrases button')?.click());
  if (i === 4) await host.screenshot({ path: `${out}/online-host-game.png` });
  if (i === 4) await guest.screenshot({ path: `${out}/online-guest-game.png` });
  if ((await host.$('.result-card')) && (await guest.$('.result-card'))) break;
  await host.waitForTimeout(500);
}
await host.waitForTimeout(2500);
const hs = await host.$$eval('.score-val', (e) => e.map((x) => x.textContent));
const gs = await guest.$$eval('.score-val', (e) => e.map((x) => x.textContent));
console.log('host scores', hs, 'guest scores', gs);
await host.screenshot({ path: `${out}/online-host-result.png` });
await guest.screenshot({ path: `${out}/online-guest-result.png` });
// guest reconnect test: reload guest page mid-game
await guest.click('.result-card .btn.primary');
await host.click('.result-card .btn.primary');
await host.waitForTimeout(1500);
await guest.reload();
await guest.waitForSelector('.game', { timeout: 30000 });
console.log('guest reconnected after reload; hand tiles:', (await guest.$$('.hand-tile')).length);
console.log('errors host', host.errors.slice(0, 5), 'guest', guest.errors.slice(0, 5));
await browser.close();
