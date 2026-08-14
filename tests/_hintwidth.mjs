import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const STRINGS = [
  'flip the lid • flick down the wheel',
  'try the squeeze: pinch lid-top + base-bottom',
  'swipe slowly across the flame to snuff it',
  'drag the blue ball to fold the wick — either way',
  'bend the wick low, then swipe the flame away…',
  'the flame is hiding — tap it, or snap the phone!',
  'the flame is hiding — tap the lighter!',
  'tank’s low — close the lid, hold the base to refill',
  'or service it properly: flame out, lid open, pull the insert up and out',
  'tap the round swatch (top-left) to restyle the case',
  'tap the flame drop (top-left) to tint the flame',
  'out of fuel — close it and hold the base to refill',
];
for (const [name, w, h] of [['se', 320, 568], ['ip', 390, 844], ['ipmax', 430, 932]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true });
  await page.goto('http://localhost:8741/index.html');
  await page.waitForFunction(() => window.__booted && window.LIGHTER && window.LIGHTER.frames > 10, null, { timeout: 60000 });
  const res = await page.evaluate((list) => {
    const el = document.getElementById('hint');
    el.classList.remove('wrap');
    el.classList.add('show');
    const out = [];
    for (const s of list) {
      el.textContent = s;
      const clipped = el.scrollWidth > el.clientWidth + 1;
      out.push({ s, sw: el.scrollWidth, cw: el.clientWidth, clipped });
    }
    return out;
  }, STRINGS);
  console.log('=== ' + name + ' ' + w + 'px ===');
  for (const r of res) console.log((r.clipped ? 'CLIPPED ' : '   ok   ') + r.sw + '/' + r.cw + '  ' + r.s);
  await page.close();
}
await browser.close();
