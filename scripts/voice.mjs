// Two browsers with fake microphones join an online table's voice call.
import { chromium } from 'playwright-core';
const base = process.argv[2] || 'http://127.0.0.1:5199/';
const out = process.argv[3];
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const mk = async (w, h) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, permissions: ['microphone'] });
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
await host.click('.action:nth-of-type(2)');
await host.waitForSelector('.room-code');
const code = (await host.textContent('.room-code')).trim();
await host.waitForTimeout(2500);
await guest.goto(`${base}#/m/${code}`);
await guest.fill('#gate-name', 'Pai');
await guest.click('.who .btn.primary');
await guest.waitForSelector('.voice-panel', { timeout: 30000 });
await host.click('.voice-panel .btn.whatsapp');
await guest.click('.voice-panel .btn.whatsapp');
await host.waitForTimeout(6000);
const probe = (p) =>
  p.evaluate(() => {
    const auds = [...document.querySelectorAll('audio')];
    return {
      members: [...document.querySelectorAll('.voice-member')].map((e) => e.textContent.trim()),
      audios: auds.length,
      live: auds.map((a) => a.srcObject && a.srcObject.getAudioTracks().map((t) => t.readyState).join()),
      talking: document.querySelectorAll('.voice-member.talking').length,
    };
  });
const level = (p) =>
  p.evaluate(async () => {
    const a = document.querySelector('audio');
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    ctx.createMediaStreamSource(a.srcObject).connect(an);
    const buf = new Uint8Array(an.fftSize);
    let max = 0;
    let seenTalking = 0;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 100));
      an.getByteTimeDomainData(buf);
      let s = 0;
      for (const v of buf) s += ((v - 128) / 128) ** 2;
      max = Math.max(max, Math.sqrt(s / buf.length));
      seenTalking = Math.max(seenTalking, document.querySelectorAll('.voice-member.talking').length);
    }
    return { maxRms: max.toFixed(3), seenTalking };
  });
console.log('received audio level host', JSON.stringify(await level(host)), 'guest', JSON.stringify(await level(guest)));
console.log('host', JSON.stringify(await probe(host)));
console.log('guest', JSON.stringify(await probe(guest)));
await host.screenshot({ path: `${out}/voice-host-lobby.png`, fullPage: true });
// start game: call must survive
await host.click('.lobby-foot .btn.primary');
await guest.waitForSelector('.game');
await host.waitForTimeout(3000);
await guest.click('.icon-btn.mic'); // mute
await host.waitForTimeout(1500);
console.log('in game host', JSON.stringify(await probe(host)), 'pill:', await host.textContent('.call-pill').catch(() => null));
console.log('guest mic class:', await guest.getAttribute('.icon-btn.mic', 'class'));
await host.screenshot({ path: `${out}/voice-host-game.png` });
await guest.screenshot({ path: `${out}/voice-guest-game.png` });
console.log('errors', host.errors.slice(0, 5), guest.errors.slice(0, 5));
await browser.close();
