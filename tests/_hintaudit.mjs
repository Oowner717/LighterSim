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
const snap = async (label) => {
  const s = await page.evaluate(() => {
    const el = document.getElementById('hint');
    return {
      text: el.textContent, clipped: el.scrollWidth > el.clientWidth + 1,
      state: LIGHTER.state, lid: LIGHTER.lidOpen(), handle: LIGHTER.bendHandleShown,
      wickK: +LIGHTER.wickK.toFixed(2), bent: LIGHTER.wickBent(),
    };
  });
  console.log(label.padEnd(22), JSON.stringify(s));
};
await snap('boot');
await page.evaluate(() => { LIGHTER.openLid(); });
await page.waitForFunction(() => LIGHTER.lidOpen(), null, { timeout: 5000 });
await page.evaluate(() => { LIGHTER.strike(3); });
await page.waitForFunction(() => LIGHTER.state === 'LIT', null, { timeout: 5000 }).catch(() => console.log('did not light'));
await page.waitForTimeout(400);
await snap('lit');
for (let i = 0; i < 7; i++) {
  await page.waitForTimeout(8200);
  await snap('lit +' + ((i + 1) * 8) + 's');
}
const cls = await page.evaluate(() => {
  const t = LIGHTER.anchor('tip');
  return { cls: LIGHTER.classifyAt(t.x, t.y), handleShown: LIGHTER.bendHandleShown };
});
console.log('classify at tip while LIT:', JSON.stringify(cls));
await browser.close();
