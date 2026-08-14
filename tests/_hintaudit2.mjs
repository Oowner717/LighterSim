import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
page.on('pageerror', e => console.log('PAGEERR', e.message));
await page.goto('http://localhost:8741/index.html');
await page.waitForFunction(() => window.__booted && window.LIGHTER && window.LIGHTER.frames > 10, null, { timeout: 60000 });
await page.evaluate(() => { LIGHTER.CFG.FUEL_BURN_S = 1e9; LIGHTER.CFG.FLINT_LIFE = 1e9; });
await page.evaluate(() => { LIGHTER.openLid(); });
await page.waitForFunction(() => LIGHTER.lidOpen(), null, { timeout: 5000 });
await page.evaluate(() => { LIGHTER.strike(3); });
await page.waitForFunction(() => LIGHTER.state === 'LIT', null, { timeout: 5000 });
let prev = '';
for (let i = 0; i < 40; i++) {
  const s = await page.evaluate(() => ({
    t: document.getElementById('hint').textContent,
    f: LIGHTER.frames, fps: Math.round(LIGHTER.fps), st: LIGHTER.state,
  }));
  if (s.t !== prev) { console.log(i + 's', JSON.stringify(s)); prev = s.t; }
  await page.waitForTimeout(1000);
}
console.log('final', await page.evaluate(() => ({ f: LIGHTER.frames, fps: Math.round(LIGHTER.fps), st: LIGHTER.state })));
await browser.close();
