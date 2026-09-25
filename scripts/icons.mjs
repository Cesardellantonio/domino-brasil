import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
const svg = readFileSync('public/icon.svg', 'utf8');
const b = await chromium.launch({ channel: 'chrome', headless: true });
for (const size of [192, 512]) {
  const p = await (await b.newContext({ viewport: { width: size, height: size } })).newPage();
  await p.setContent(`<body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  await p.screenshot({ path: `public/icon-${size}.png`, omitBackground: true });
}
await b.close();
