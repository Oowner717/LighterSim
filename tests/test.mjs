// Runs against a locally-served copy of index.html whose import map points at
// a local three@0.169.0 (built by build-local.mjs). Browser resolution:
// CHROME_PATH env var if set, else the playwright package's bundled chromium.
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = await import('playwright-core')); }

const URL = 'http://localhost:8741/index.html';
let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; failures.push(name); console.log(`FAIL  ${name} ${extra}`); }
}

const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
});
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

await page.goto(URL);
await page.waitForFunction(() => window.__booted && window.LIGHTER && window.LIGHTER.frames > 10, null, { timeout: 30000 });
console.log('booted, frames rendering');

// helpers injected into the page
await page.evaluate(() => {
  const c = document.getElementById('c');
  window.__pt = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, {
    pointerId: id, clientX: x, clientY: y, pointerType: 'touch',
    bubbles: true, cancelable: true, isPrimary: id === 1,
  }));
  window.__sleep = ms => new Promise(r => setTimeout(r, ms));
  // wall-clock-driven swipe: positions follow elapsed time so measured px/s
  // stays truthful even when frames stall the event loop
  window.__swipe = async (x0, y0, x1, y1, ms, id = 9) => {
    window.__pt('pointerdown', id, x0, y0);
    const t0 = performance.now();
    let el = 0;
    while (el < ms) {
      await window.__sleep(Math.min(12, ms / 8));
      el = Math.min(ms, performance.now() - t0);
      const k = el / ms;
      window.__pt('pointermove', id, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k);
    }
    window.__pt('pointerup', id, x1, y1);
  };
});
const L = sel => page.evaluate(sel);
// NOTE: string must be an EXPRESSION (polled for truthiness), not a function literal
const waitL = (expr, timeout = 12000) => page.waitForFunction(expr, null, { timeout, polling: 100 });
async function settleLid(open) {
  await L(open ? '(LIGHTER.openLid(), 0)' : '(LIGHTER.closeLid(), 0)');
  await waitL(open
    ? 'LIGHTER.lidTheta > LIGHTER.CFG.LID_OPEN - 0.05 && Math.abs(LIGHTER.sim.lid.omega) < 0.5'
    : 'LIGHTER.lidTheta < 0.05 && Math.abs(LIGHTER.sim.lid.omega) < 0.5');
}
async function lightIt() {
  await page.waitForFunction(() => {
    const L = window.LIGHTER;
    if (L.state === 'LIT') return true;
    L.strike(3);
    return false;
  }, null, { timeout: 20000, polling: 500 });
}
const swipeAcrossMouth = async (pxPerSec) => {
  const m = await L('LIGHTER.anchor("mouth")');
  const mx = await L('LIGHTER.anchor("mouthX")');
  const hw = Math.hypot(mx.x - m.x, mx.y - m.y) * 1.15;
  const total = hw * 2.0;
  await page.evaluate(([m, hw, total, v]) =>
    window.__swipe(m.x - hw * 0.95, m.y, m.x + hw * 1.05, m.y, (total / v) * 1000),
  [m, hw, total, pxPerSec]);
};

/* 1 ── lid snaps fully open/shut, never rests mid-arc */
await settleLid(true);
check('lid opens fully via flick', await L('LIGHTER.lidTheta > LIGHTER.CFG.LID_OPEN - 0.05'));
await settleLid(false);
check('lid closes fully', await L('LIGHTER.lidTheta') < 0.05);
await L('(LIGHTER.sim.lid.theta = LIGHTER.CFG.LID_OPEN * 0.5, LIGHTER.sim.lid.omega = 0)');
await page.waitForTimeout(1500);
{
  const ok = await L('LIGHTER.lidTheta < 0.1 || LIGHTER.lidTheta > LIGHTER.CFG.LID_OPEN - 0.1');
  check('lid never rests mid-arc', ok, `theta=${(await L('LIGHTER.lidTheta')).toFixed(2)}`);
}
{ // a weak flick falls back instead of hanging mid-arc
  await settleLid(false);
  await L('LIGHTER.sim.lid.omega = 12');
  await waitL('LIGHTER.lidTheta < 0.1 && Math.abs(LIGHTER.sim.lid.omega) < 0.5', 15000);
  check('weak flick falls back closed', true);
}

/* 2 ── ignition rules */
check('strike with lid closed does nothing', await L('LIGHTER.strike(3)') === false);
await page.waitForTimeout(400);
check('state still OUT after closed strike', await L('LIGHTER.state') === 'OUT');
await settleLid(true);
await lightIt();
check('fast strike with lid open ignites', true);

/* 3 ── chimney swipes: slow smothers, fast only flickers (wick straight) */
await swipeAcrossMouth(300);            // slow (threshold = 1.5*vmin = 585 px/s)
await page.waitForTimeout(300);
check('slow chimney swipe smothers -> OUT', await L('LIGHTER.state') === 'OUT');
check('smother counted', await L('LIGHTER.sim.counts.smothers') >= 1);
await lightIt();
await swipeAcrossMouth(1900);           // fast
await page.waitForTimeout(250);
check('fast chimney swipe survives (windproof)', await L('LIGHTER.state') === 'LIT');
check('fast swipe kicked turbulence', await L('LIGHTER.sim.flame.turb') > 0.01,
  `turb=${await L('LIGHTER.sim.flame.turb')}`);

/* 4 ── bent wick: steal -> EMBER; jerk relights; unattended ember dies */
await L('LIGHTER.bendWick(1)');
check('bendWick(1) puts tip below rim', await L('LIGHTER.wickBent()') === true);
await waitL('LIGHTER.state === "LIT"');
await swipeAcrossMouth(800);
await waitL('LIGHTER.state === "EMBER"');
check('swipe with bent wick -> EMBER', true);
await page.screenshot({ path: 'shot-ember.png' });
await L('LIGHTER.jerk()');
await waitL('LIGHTER.state === "LIT"');
check('jerk relights ember -> LIT', true);
check('relight counted', await L('LIGHTER.sim.counts.relights') >= 1);
await page.screenshot({ path: 'shot-lit-bent.png' });
// ember decay (shorten life for the test)
await L('LIGHTER.CFG.EMBER_LIFE = 1.2');
await swipeAcrossMouth(800);
await waitL('LIGHTER.state === "EMBER"');
await waitL('LIGHTER.state === "OUT"', 15000);
check('unattended ember dies out', true);
await L('LIGHTER.CFG.EMBER_LIFE = 12');

/* flick fallback relights the ember */
await lightIt();
await swipeAcrossMouth(800);
await waitL('LIGHTER.state === "EMBER"');
// fast flick on empty space (retry under SwiftShader frame stalls)
for (let tries = 0; tries < 4; tries++) {
  if (await L('LIGHTER.state') === 'LIT') break;
  await page.evaluate(() => window.__swipe(40, 700, 170, 540, 95, 21));
  await page.waitForTimeout(400);
}
check('flick gesture relights ember', await L('LIGHTER.state') === 'LIT');
await page.evaluate(() => { LIGHTER.cam.yaw = 0.32; LIGHTER.cam.pitch = 0.06; LIGHTER.cam.yawVel = 0; LIGHTER.cam.pitchVel = 0; });

/* upward scoop on the lighter relights the ember */
await lightIt();
await swipeAcrossMouth(800);
await waitL('LIGHTER.state === "EMBER"');
{
  const bc = await L('LIGHTER.anchor("baseCenter")');
  const camBefore = await L('({y: LIGHTER.cam.yaw, p: LIGHTER.cam.pitch})');
  for (let tries = 0; tries < 4; tries++) {
    if (await L('LIGHTER.state') === 'LIT') break;
    await page.evaluate(([p]) => window.__swipe(p.x, p.y + 40, p.x - 4, p.y - 160, 120, 23), [bc]);
    await page.waitForTimeout(400);
  }
  check('upward scoop on the case relights ember', await L('LIGHTER.state') === 'LIT');
  const camAfter = await L('({y: LIGHTER.cam.yaw, p: LIGHTER.cam.pitch})');
  check('scoop swipe does not move the camera',
    Math.abs(camAfter.y - camBefore.y) < 0.02 && Math.abs(camAfter.p - camBefore.p) < 0.02,
    `dyaw=${(camAfter.y - camBefore.y).toFixed(3)} dpitch=${(camAfter.p - camBefore.p).toFixed(3)}`);
}

/* tapping the lighter relights the ember */
await lightIt();
await swipeAcrossMouth(800);
await waitL('LIGHTER.state === "EMBER"');
{
  const bc = await L('LIGHTER.anchor("baseCenter")');
  await page.evaluate(async ([p]) => {
    window.__pt('pointerdown', 24, p.x, p.y);
    await window.__sleep(70);
    window.__pt('pointerup', 24, p.x, p.y);
  }, [bc]);
  await waitL('LIGHTER.state === "LIT"');
  check('tapping the lighter relights ember', true);
}
await page.evaluate(() => { LIGHTER.cam.yaw = 0.32; LIGHTER.cam.pitch = 0.06; LIGHTER.cam.yawVel = 0; LIGHTER.cam.pitchVel = 0; });

/* straighten wick again via API */
await L('LIGHTER.straighten()');
await waitL('!LIGHTER.wickBent()');
check('wick straightens', true);
await settleLid(false);
check('closing lid kills LIT (en passant)', await L('LIGHTER.state') === 'OUT');

/* 5 ── squeeze-pop vs pinch-zoom */
{
  const lt = await L('LIGHTER.anchor("lidTop")');
  const bb = await L('LIGHTER.anchor("baseBottom")');
  await page.evaluate(async ([lt, bb]) => {
    window.__pt('pointerdown', 31, lt.x, lt.y);
    await window.__sleep(40);
    window.__pt('pointerdown', 32, bb.x, bb.y);
    for (let i = 1; i <= 14; i++) {
      await window.__sleep(30);
      window.__pt('pointermove', 31, lt.x, lt.y + i * 5);
      window.__pt('pointermove', 32, bb.x, bb.y - i * 5);
    }
    await window.__sleep(60);
    window.__pt('pointerup', 31, lt.x, lt.y + 70);
    window.__pt('pointerup', 32, bb.x, bb.y - 70);
  }, [lt, bb]);
  await waitL('LIGHTER.lidTheta > LIGHTER.CFG.LID_OPEN - 0.1');
  check('squeeze-pop fired', await L('LIGHTER.sim.counts.pops') >= 1);
  check('squeeze-pop bursts the lid open', true);
}
{ // pinch on empty space = zoom only
  const pops = await L('LIGHTER.sim.counts.pops');
  await settleLid(false);
  await page.evaluate(async () => {
    window.__pt('pointerdown', 41, 40, 300);
    await window.__sleep(40);
    window.__pt('pointerdown', 42, 40, 420);
    for (let i = 1; i <= 10; i++) {
      await window.__sleep(25);
      window.__pt('pointermove', 41, 40, 300 - i * 8);
      window.__pt('pointermove', 42, 40, 420 + i * 8);
    }
    window.__pt('pointerup', 41, 40, 220);
    window.__pt('pointerup', 42, 40, 500);
  });
  await page.waitForTimeout(300);
  const zoom = await L('LIGHTER.cam.zoom');
  check('empty-space pinch zooms camera', Math.abs(zoom - 1) > 0.03, `zoom=${zoom}`);
  check('empty-space pinch does not squeeze', await L('LIGHTER.sim.counts.pops') === pops);
  check('empty-space pinch does not open lid', await L('LIGHTER.lidTheta') < 0.1,
    `theta=${await L('LIGHTER.lidTheta')}`);
  await L('LIGHTER.cam.zoom = 1');
}

/* 6 ── shake while lit snuffs */
await settleLid(true);
await lightIt();
await L('LIGHTER.shake()');
check('sustained shake snuffs -> OUT', await L('LIGHTER.state') === 'OUT');

/* 7 ── closing the lid from any state kills flame + ember */
await lightIt();
await settleLid(false);
check('closing lid kills LIT', await L('LIGHTER.state') === 'OUT');
await settleLid(true);
await L('LIGHTER.bendWick(1)');
await lightIt();
await swipeAcrossMouth(800);
await waitL('LIGHTER.state === "EMBER"');
await settleLid(false);
check('closing lid kills EMBER', await L('LIGHTER.state') === 'OUT');
await L('LIGHTER.straighten()');

/* pointer-driven interactions: lid drag flick, wheel swipe, wick drag, double-tap */
{ // drag-flick the lid open from closed via the pointer pipeline
  const lc = await L('LIGHTER.anchor("lidTop")');
  const OPEN = await L('LIGHTER.CFG.LID_OPEN');
  let th = 0;
  for (let tries = 0; tries < 3 && th < OPEN - 0.1; tries++) {   // synthetic timing can starve move events
    await page.evaluate(([p]) => window.__swipe(p.x, p.y - 6, p.x, p.y - 230, 100, 51), [lc]);
    await page.waitForTimeout(1200);
    th = await L('LIGHTER.lidTheta');
  }
  check('pointer drag-flick opens lid', th > OPEN - 0.1, `theta=${th.toFixed(2)}`);
  if (th < OPEN - 0.1) await settleLid(true);
}
{ // slow wheel spin: no spark; fast wheel swipe: sparks + ignition
  const sparks0 = await L('LIGHTER.sim.counts.sparks');
  const wh = await L('LIGHTER.anchor("wheel")');
  await page.evaluate(([p]) => window.__swipe(p.x, p.y - 25, p.x, p.y + 45, 700, 61), [wh]); // ~100 px/s
  await page.waitForTimeout(300);
  check('slow wheel spin does not spark', await L('LIGHTER.sim.counts.sparks') === sparks0);
  check('slow wheel spin does not ignite', await L('LIGHTER.state') === 'OUT');
  await page.evaluate(([p]) => window.__swipe(p.x, p.y - 28, p.x, p.y + 72, 80, 62), [wh]);  // ~1400 px/s
  await waitL('LIGHTER.state === "LIT"');
  check('fast wheel swipe sparks and ignites', await L('LIGHTER.sim.counts.sparks') > sparks0);
  await page.screenshot({ path: 'shot-lit.png' });
}
{ // wick drag bends plastically
  const y0 = await L('LIGHTER.wickTipLocalY()');
  const tip = await L('LIGHTER.anchor("tip")');
  await page.evaluate(([p]) => window.__swipe(p.x, p.y, p.x - 70, p.y + 90, 450, 71), [tip]);
  await page.waitForTimeout(200);
  const y1 = await L('LIGHTER.wickTipLocalY()');
  check('dragging the wick tip bends it down', y1 < y0 - 0.2, `y ${y0.toFixed(2)} -> ${y1.toFixed(2)}`);
  await page.waitForTimeout(600);
  const y2 = await L('LIGHTER.wickTipLocalY()');
  check('bend is plastic (no spring-back)', Math.abs(y2 - y1) < 0.06, `y1=${y1.toFixed(2)} y2=${y2.toFixed(2)}`);
  await L('LIGHTER.straighten()');
  await waitL('!LIGHTER.wickBent()');
}
{ // double-tap = auto open + strike
  await settleLid(false);
  await page.evaluate(async () => {
    window.__pt('pointerdown', 81, 60, 650); window.__pt('pointerup', 81, 60, 650);
    await window.__sleep(120);
    window.__pt('pointerdown', 82, 62, 652); window.__pt('pointerup', 82, 62, 652);
  });
  await waitL('LIGHTER.state === "LIT"', 15000);
  check('double-tap auto opens + strikes', true);
  await settleLid(false);
}

/* finger through the flame bends it */
await settleLid(true);
await lightIt();
await page.waitForTimeout(400);
{
  const tip = await L('LIGHTER.anchor("tip")');
  await L('LIGHTER.sim.flame.maxBend = 0');
  await page.evaluate(([p]) => window.__swipe(p.x - 90, p.y - 40, p.x + 90, p.y - 40, 260, 26), [tip]);
  await page.waitForTimeout(150);
  const bend = await L('LIGHTER.sim.flame.maxBend');
  check('finger through the flame bends it', bend > 0.08, `peak bend=${bend.toFixed(2)}`);
  await page.evaluate(() => { LIGHTER.cam.yaw = 0.32; LIGHTER.cam.pitch = 0.06; LIGHTER.cam.yawVel = 0; LIGHTER.cam.pitchVel = 0; });
}
await settleLid(false);

/* discovered tricks persist across sessions */
await page.evaluate(() => localStorage.setItem('lighter.disc', JSON.stringify({ lit: true, pop: true })));
await page.reload();
await page.waitForFunction(() => window.__booted && window.LIGHTER && window.LIGHTER.frames > 5, null, { timeout: 30000 });
check('discovered tricks persist across reload',
  await L('LIGHTER.sim.disc.lit === true && LIGHTER.sim.disc.pop === true'));

/* 8 ── no console errors */
check('no console errors', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 6)));

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) console.log('failures:', failures.join(' | '));
await browser.close();
process.exit(fail ? 1 : 0);
