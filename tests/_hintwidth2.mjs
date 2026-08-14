import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const STRINGS = [
  'flame out, lid open — pull the insert up and out',
  'service it: flame out, lid open, pull the insert out',
  'pull the insert up and out to service it properly',
  'or service it: pull the insert up out of the case',
  'grip the chimney and pull the insert up and out',
  'fold the wick low, then swipe the flame away…',
  'swipe across the flame — a folded wick hides it',
  'shake the phone hard to snuff the flame',
  'tilt or shake the phone — the flame answers',
  'tap the swatch or the drop (top-left) to restyle it',
  'drag the blue ball to fold the wick — either way',
];
for (const [name, w, h] of [['se', 320, 568], ['ip', 390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true });
  await page.goto('http://localhost:8741/index.html');
  await page.waitForFunction(() => window.__booted && window.LIGHTER, null, { timeout: 60000 });
  const res = await page.evaluate((list) => {
    const el = document.getElementById('hint');
    el.classList.remove('wrap'); el.classList.add('show');
    return list.map(s => { el.textContent = s; return { s, sw: el.scrollWidth, cw: el.clientWidth }; });
  }, STRINGS);
  console.log('=== ' + name + ' ' + w + 'px ===');
  for (const r of res) console.log((r.sw > r.cw + 1 ? 'CLIPPED ' : '   ok   ') + r.sw + '/' + r.cw + '  ' + r.s);
  await page.close();
}
await browser.close();
