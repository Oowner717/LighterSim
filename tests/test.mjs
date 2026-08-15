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

// pin the wear systems out of the way so every legacy check stays deterministic;
// the fuel/flint sections below unpin (and re-pin) around themselves
const pinCfg = () => page.evaluate(() => {
  LIGHTER.CFG.FLINT_LIFE = 1e9;
  LIGHTER.CFG.FUEL_BURN_S = 1e9;
  // SwiftShader runs at a few fps, so the volumetric flame's own low-fps
  // fallback would trip and the volume path would never be exercised here
  LIGHTER.CFG.FPS_VOL_OFF = 0;
});
await pinCfg();
check('motion sensors idle at boot', await page.evaluate(() => LIGHTER.motionAttached) === false);
{ // the frame-rate readout, so a stutter on a real device is something you can read
  const txt = await page.evaluate(() => document.getElementById('fps').textContent);
  check('the fps readout is on screen',
    await page.evaluate(() => document.getElementById('fps').getBoundingClientRect().width > 0));
  check('the fps readout shows a rate', /^\d+ fps/.test(txt), `text=${JSON.stringify(txt)}`);
}

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
await waitL('LIGHTER.lidTheta < 0.1 || LIGHTER.lidTheta > LIGHTER.CFG.LID_OPEN - 0.1', 15000);
check('lid never rests mid-arc', true);
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
{ // the flame is a raymarched volume, with the sprite stack kept as a fallback
  check('the flame renders as a volume', await L('LIGHTER.volActive') === true);
  await L('(LIGHTER.CFG.FLAME_VOL = false, 0)');
  // condition-waits, not sleeps: one frame is ~330ms under SwiftShader
  await waitL('LIGHTER.volActive === false', 8000);
  check('it falls back to sprites when the volume is off',
    await L('LIGHTER.scene.children.filter(o => o.isSprite && o.visible).length') > 0);
  await L('(LIGHTER.CFG.FLAME_VOL = true, 0)');
  await waitL('LIGHTER.volActive === true', 8000);
  check('and back to the volume again', true);
  // The column has to stand ON the windshield, not down inside it. Rooted too low
  // and the depth prepass eats the part worth seeing -- it reported as "the flame
  // is buried in the chimney"; rooted too high and it visibly floats off the wick.
  {
    const s = await L('LIGHTER.flameSpine');
    check('the flame is rooted at the rim, not sunk into the chimney',
      s.ay > s.rim && s.ay - s.rim < 0.35, `base is rim+${(s.ay - s.rim).toFixed(2)}`);
    check('the flame stands clear of the chimney',
      s.cy - s.rim > 1.2, `tip is rim+${(s.cy - s.rim).toFixed(2)}`);
  }
  // regression: the volume was only ever hidden inside the LIT branch, so it
  // stayed on screen after the flame went out, and its depth prepass kept running
  await settleLid(false);
  await waitL('LIGHTER.state === "OUT"');
  await waitL('LIGHTER.volActive === false', 8000);
  check('the volume goes away when the flame does',
    await L('(() => { let v = false; LIGHTER.scene.traverse(o => { if (o.material && o.material.isShaderMaterial && o.visible) v = true; }); return v; })()') === false);
  await settleLid(true);
  await lightIt();
}
{ // the camera can go right over the top and underneath
  check('the camera is free through a full arc', await L('LIGHTER.CFG.PITCH_MAX') > 1.4);
  await L('(LIGHTER.cam.pitch = 9, LIGHTER.cam.pitchVel = 0, 0)');
  await page.waitForTimeout(300);
  const hi = await L('LIGHTER.cam.pitch');
  await L('(LIGHTER.cam.pitch = -9, LIGHTER.cam.pitchVel = 0, 0)');
  await page.waitForTimeout(300);
  const lo = await L('LIGHTER.cam.pitch');
  check('pitch clamps just shy of straight up and down',
    Math.abs(hi) > 1.4 && Math.abs(lo) > 1.4 && hi > 0 && lo < 0, `hi=${hi} lo=${lo}`);
  await L('(LIGHTER.cam.pitch = 0.06, LIGHTER.cam.pitchVel = 0, 0)');
}

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
{ // a curved thumb stroke around the hinge closes the lid fully
  const SHUT = 'LIGHTER.lidTheta < 0.05 && Math.abs(LIGHTER.sim.lid.omega) < 0.5';
  let shut = false;
  for (let tries = 0; tries < 3 && !shut; tries++) {   // synthetic timing can starve move events
    if (tries) {
      if (await L(SHUT)) { shut = true; break; }       // the stroke worked, the wait was just slow
      await settleLid(true);                           // a retry needs the lid open again
    }
    const hp = await L('LIGHTER.lidPivot()');
    const g0 = await L('LIGHTER.lidPoint()');       // lid corner, open
    const g1 = await L('LIGHTER.lidPoint(0)');      // lid corner, closed
    const a0 = Math.atan2(g0.y - hp.y, g0.x - hp.x);
    let a1 = Math.atan2(g1.y - hp.y, g1.x - hp.x);
    a1 += 2 * Math.PI * Math.round((a0 - a1) / (2 * Math.PI));
    const r = Math.hypot(g0.x - hp.x, g0.y - hp.y);
    await page.evaluate(async ([hp, a0, a1, r, id]) => {
      const steps = 26;
      const px = a => hp.x + r * Math.cos(a), py = a => hp.y + r * Math.sin(a);
      window.__pt('pointerdown', id, px(a0), py(a0));
      for (let i = 1; i <= steps; i++) {
        await window.__sleep(22);
        const a = a0 + (a1 - a0) * (i / steps) * 1.06;   // sweep a hair past closed
        window.__pt('pointermove', id, px(a), py(a));
      }
      await window.__sleep(60);
      const aEnd = a0 + (a1 - a0) * 1.06;
      window.__pt('pointerup', id, px(aEnd), py(aEnd));
    }, [hp, a0, a1, r, 57 + tries]);
    shut = await waitL(SHUT, 5000).then(() => true, () => false);
  }
  check('curved arc stroke closes the lid fully', shut);
}
{ // a straight drag passing across the hinge pivot must not teleport the lid
  const lc = await L('LIGHTER.anchor("lidTop")');
  const hp = await L('LIGHTER.lidPivot()');
  const ex = hp.x + (hp.x - lc.x) * 1.2, ey = hp.y + (hp.y - lc.y) * 1.2;
  const maxTh = await page.evaluate(async ([lc, ex, ey]) => {
    const id = 58, steps = 24;
    let m = 0;
    window.__pt('pointerdown', id, lc.x, lc.y);
    for (let i = 1; i <= steps; i++) {
      await window.__sleep(20);
      window.__pt('pointermove', id, lc.x + (ex - lc.x) * (i / steps), lc.y + (ey - lc.y) * (i / steps));
      m = Math.max(m, LIGHTER.lidTheta);
    }
    window.__pt('pointerup', id, ex, ey);
    return m;
  }, [lc, ex, ey]);
  await page.waitForTimeout(1200);
  check('drag across the hinge pivot never snaps the lid', maxTh < 0.5 && await L('LIGHTER.lidTheta') < 0.1,
    `maxTheta=${maxTh.toFixed(2)} settled=${(await L('LIGHTER.lidTheta')).toFixed(2)}`);
  await settleLid(true);
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
{ // the wick only bends cold, and only along its guided arc
  // still LIT from the wheel swipe above: a live flame locks the wick
  const yLit = await L('LIGHTER.wickTipLocalY()');
  const tip = await L('LIGHTER.anchor("tip")');
  await page.evaluate(([p]) => window.__swipe(p.x, p.y, p.x - 40, p.y + 140, 450, 70), [tip]);
  await page.waitForTimeout(250);
  check('a burning wick refuses to bend',
    Math.abs(await L('LIGHTER.wickTipLocalY()') - yLit) < 0.02);
  // the drag may land as a smother instead; relight so the poke below is locked
  await lightIt();
  // a poke at the locked wick explains itself instead of doing nothing
  await page.evaluate(async ([p]) => {
    window.__pt('pointerdown', 69, p.x, p.y);
    await window.__sleep(60);
    window.__pt('pointerup', 69, p.x, p.y);
  }, [tip]);
  await page.waitForTimeout(200);
  check('the locked wick says why',
    await L('/wick only bends cold/.test(document.getElementById("hint").textContent)'));
  { // regression: the ember's pilot glow sits ON the tip and the hint says to
    // tap it — the cold-only gate must not swallow that tap
    await L('LIGHTER.bendWick(1)');
    await lightIt();
    await swipeAcrossMouth(800);
    await waitL('LIGHTER.state === "EMBER"');
    const emberTip = await L('LIGHTER.anchor("tip")');
    await page.evaluate(async ([p]) => {
      window.__pt('pointerdown', 68, p.x, p.y);
      await window.__sleep(70);
      window.__pt('pointerup', 68, p.x, p.y);
    }, [emberTip]);
    await waitL('LIGHTER.state === "LIT"', 8000);
    check('tapping the hidden ember on the wick still relights it', true);
    await L('LIGHTER.straighten()');
    await waitL('!LIGHTER.wickBent()');
  }

  // put it out, and the same drag now works
  await settleLid(false);
  await waitL('LIGHTER.state === "OUT"');
  await settleLid(true);
  const y0 = await L('LIGHTER.wickTipLocalY()');
  const tip2 = await L('LIGHTER.anchor("tip")');
  await page.evaluate(([p]) => window.__swipe(p.x, p.y, p.x - 40, p.y + 140, 450, 71), [tip2]);
  await page.waitForTimeout(200);
  const y1 = await L('LIGHTER.wickTipLocalY()');
  check('a cold wick bends when dragged down', y1 < y0 - 0.2, `y ${y0.toFixed(2)} -> ${y1.toFixed(2)}`);
  // guided, not free-form: re-posing from the arc parameter alone reproduces
  // the exact pose the drag left, so the drag never left the rail
  const k = await L('LIGHTER.wickK');
  await L(`(LIGHTER.bendWick(${k}), 0)`);
  const yArc = await L('LIGHTER.wickTipLocalY()');
  check('the bend stayed on its guided arc', Math.abs(yArc - y1) < 0.01,
    `k=${k.toFixed(3)} y ${y1.toFixed(3)} vs ${yArc.toFixed(3)}`);
  await page.waitForTimeout(600);
  const y2 = await L('LIGHTER.wickTipLocalY()');
  check('bend is plastic (no spring-back)', Math.abs(y2 - y1) < 0.06, `y1=${y1.toFixed(2)} y2=${y2.toFixed(2)}`);
  await L('LIGHTER.straighten()');
  await waitL('!LIGHTER.wickBent()');
  { // the bend handle: a ball on a thread, clear of the lighter, dragged either way
    await L('LIGHTER.straighten()');
    await waitL('!LIGHTER.wickBent()');
    const ball = await L('LIGHTER.anchor("bendHandle")');
    const tip0 = await L('LIGHTER.anchor("tip")');
    check('the bend handle sits clear of the wick',
      tip0.y - ball.y > 60, `gap ${(tip0.y - ball.y).toFixed(0)}px`);
    check('the handle is what you grab there',
      await L(`LIGHTER.classifyAt(${ball.x}, ${ball.y})`) === 'bend');
    const sides = [];
    for (const [id, dx] of [[91, 95], [92, -95]]) {
      await L('LIGHTER.straighten()');
      await waitL('!LIGHTER.wickBent()');
      const p = await L('LIGHTER.anchor("bendHandle")');
      await page.evaluate(([p, dx, id]) => window.__swipe(p.x, p.y, p.x + dx, p.y + 25, 400, id),
        [p, dx, id]);
      await page.waitForTimeout(200);
      sides.push(await L('LIGHTER.wickK'));
    }
    check('dragging the ball right folds the wick one way, left folds it the other',
      sides[0] > 0.3 && sides[1] < -0.3, `k right=${sides[0].toFixed(2)} left=${sides[1].toFixed(2)}`);
    check('both folds tuck the tip below the rim', await L('LIGHTER.wickBent()') === true);
    // and it only exists while bending is legal
    await L('LIGHTER.straighten()');
    await waitL('!LIGHTER.wickBent()');
    await lightIt();
    await waitL('LIGHTER.bendHandleShown === false', 8000);
    check('the handle is gone while the flame is lit', true);
    await settleLid(false);
    await waitL('LIGHTER.state === "OUT"');
    await settleLid(true);
    await waitL('LIGHTER.bendHandleShown === true', 8000);
    check('the handle comes back once the flame is out', true);
  }
  { // the idle demo advertises the handle by rocking the wick — and must yield
    // the instant anything else poses it, or a deliberate bend gets stomped
    await L('LIGHTER.straighten()');
    await waitL('!LIGHTER.wickBent()');
    await L('(LIGHTER.sim.disc.bend = false, 0)');
    await waitL('Math.abs(LIGHTER.wickK) > 0.05', 10000);
    check('the idle handle rocks the wick to show what it does', true);
    const ks = [];
    for (let i = 0; i < 6; i++) { ks.push(await L('LIGHTER.wickK')); await page.waitForTimeout(180); }
    check('the demo sway stays gentle and never counts as bent',
      Math.max(...ks.map(Math.abs)) < 0.26 && await L('LIGHTER.wickBent()') === false,
      `peak ${Math.max(...ks.map(Math.abs)).toFixed(2)}`);
    await L('LIGHTER.bendWick(1)');
    await page.waitForTimeout(900);
    check('the demo never overrides a deliberate bend',
      await L('LIGHTER.wickK') === 1 && await L('LIGHTER.wickBent()') === true,
      `k=${await L('LIGHTER.wickK')}`);
    await L('(LIGHTER.sim.disc.bend = true, LIGHTER.straighten(), 0)');
    await waitL('!LIGHTER.wickBent()');
  }
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
  // The flame now leans on its own from turbulent buoyancy, so a fixed
  // threshold would pass without any swipe at all. Measure how far it wanders
  // untouched over the same window first, and require the swipe to beat it.
  // Wait for the wander rather than sampling a fixed window: the drift is
  // driven by noise over SIM time, and a starved runner advances that so slowly
  // the flame can honestly sit near-still for a few hundred ms.
  await L('LIGHTER.sim.flame.maxBend = 0');
  let drifted = true;
  try { await waitL('LIGHTER.sim.flame.maxBend > 0.004', 8000); }
  catch (e) { drifted = false; }
  check('the flame wanders on its own (turbulent buoyancy)', drifted,
    `peak=${(await L('LIGHTER.sim.flame.maxBend')).toFixed(4)}`);
  // the swipe is judged against drift over a window its own size, not that one
  await L('LIGHTER.sim.flame.maxBend = 0');
  await page.waitForTimeout(410);
  const ambient = await L('LIGHTER.sim.flame.maxBend');
  // retried: a starved event loop can deliver too few moves through the flame
  const floor = Math.max(0.08, ambient * 2);
  let bend = 0;
  for (let tries = 0; tries < 4 && bend <= floor; tries++) {
    const tip = await L('LIGHTER.anchor("tip")');
    await L('LIGHTER.sim.flame.maxBend = 0');
    await page.evaluate(([p, id]) => window.__swipe(p.x - 90, p.y - 40, p.x + 90, p.y - 40, 260, id),
      [tip, 26 + tries]);
    await page.waitForTimeout(150);
    bend = await L('LIGHTER.sim.flame.maxBend');
  }
  check('finger through the flame bends it well past its own drift', bend > floor,
    `peak bend=${bend.toFixed(3)} vs floor ${floor.toFixed(3)}`);
  await page.evaluate(() => { LIGHTER.cam.yaw = 0.32; LIGHTER.cam.pitch = 0.06; LIGHTER.cam.yawVel = 0; LIGHTER.cam.pitchVel = 0; });
}
await settleLid(false);

/* 9 ── fuel: burns while lit, dies dry, sparks never catch on an empty tank */
await settleLid(true);
await L('(LIGHTER.CFG.FUEL_BURN_S = 6, LIGHTER.sim.fuel = 1, 0)');
await lightIt();
check('motion sensors attach while LIT', await L('LIGHTER.motionAttached') === true);
await page.waitForTimeout(600);
{
  const f1 = await L('LIGHTER.fuel');
  check('fuel burns down while LIT', f1 < 0.995, `fuel=${f1}`);
}
await L('LIGHTER.sim.fuel = 0.12');           // fast-forward to nearly dry
await waitL('document.getElementById("hint").textContent.includes("starving")', 15000);
check('low fuel explains itself (sputter toast)', true);
await waitL('LIGHTER.state === "OUT"', 20000);
check('tank runs dry -> OUT (cause "dry")', await L('LIGHTER.sim.flame.lastCause') === 'dry');
{ // dry tank: the wheel still sparks, but nothing catches
  const sp0 = await L('LIGHTER.sim.counts.sparks');
  await page.waitForFunction(s0 => {
    const LG = window.LIGHTER;
    if (LG.sim.counts.sparks > s0) return true;
    LG.strike(3);
    return false;
  }, sp0, { timeout: 15000, polling: 500 });
  await page.waitForTimeout(800);
  check('dry tank sparks but never catches', await L('LIGHTER.state') === 'OUT');
}
await L('LIGHTER.sim.fuel = 0.5');
await page.waitForTimeout(600);
check('fuel is stable while OUT', await L('LIGHTER.fuel') === 0.5);
await L('(LIGHTER.sim.fuel = 0.05, LIGHTER.CFG.FUEL_BURN_S = 1e9, 0)');

/* 10 ── refill: press-and-hold the closed base bottom */
await settleLid(false);
await waitL('!LIGHTER.motionAttached', 20000);
check('motion sensors sleep again after the flame dies', true);
{
  const refills0 = await L('LIGHTER.sim.counts.refills');
  const bb = await L('LIGHTER.anchor("baseBottom")');
  // hold until the refill actually lands: sim time crawls under SwiftShader
  // (dt is clamped per frame), so a fixed wall-clock sleep can undershoot
  await page.evaluate(([p]) => window.__pt('pointerdown', 91, p.x, p.y), [bb]);
  await waitL('LIGHTER.fuel === 1', 25000);
  await page.evaluate(([p]) => window.__pt('pointerup', 91, p.x, p.y), [bb]);
  check('refill hold fills the tank', true);
  check('refill counted + discovered',
    await L('LIGHTER.sim.counts.refills') > refills0 && await L('LIGHTER.sim.disc.refuel') === true);
}

/* 11 ── worn flint: guaranteed dud under pinned odds */
await settleLid(true);
await L(`(LIGHTER.CFG.FLINT_LIFE = 0, LIGHTER.CFG.FLINT_FADE = 1,
  LIGHTER.CFG.FLINT_DUD_MAX = 1, LIGHTER.CFG.FLINT_DUD_RUN = 99, LIGHTER.sim.flint = 5, 0)`);
{
  const duds0 = await L('LIGHTER.sim.counts.duds');
  await page.waitForFunction(d0 => {
    const LG = window.LIGHTER;
    if (LG.sim.counts.duds > d0) return true;
    LG.strike(3);
    return false;
  }, duds0, { timeout: 15000, polling: 500 });
  await page.waitForTimeout(700);
  check('worn flint duds instead of sparking', true);
  check('a dud never ignites', await L('LIGHTER.state') === 'OUT');
  check('a dud explains itself (flint toast)',
    await L('document.getElementById("hint").textContent.includes("flint")'));
}
await L('(LIGHTER.CFG.FLINT_LIFE = 1e9, LIGHTER.sim.flintDudRun = 0, 0)');
await L('LIGHTER.refill()');                   // fresh flint + full tank

/* 12 ── a short hold on the base is a no-op */
await settleLid(false);
{
  const before = await L('({f: LIGHTER.fuel, r: LIGHTER.sim.counts.refills, fin: LIGHTER.finish})');
  const bb = await L('LIGHTER.anchor("baseBottom")');
  await page.evaluate(async ([p]) => {
    window.__pt('pointerdown', 92, p.x, p.y);
    await window.__sleep(400);
    window.__pt('pointerup', 92, p.x, p.y);
  }, [bb]);
  const after = await L('({f: LIGHTER.fuel, r: LIGHTER.sim.counts.refills, fin: LIGHTER.finish})');
  check('short hold on the base is a no-op',
    before.f === after.f && before.r === after.r && before.fin === after.fin);
}

/* 13 ── finishes: the API cycle walks the whole list and lands back on chrome */
{
  const hex0 = await L('LIGHTER.mats.chrome.color.getHexString()');
  const n = await L('LIGHTER.FINISH_ORDER.length');
  await L('LIGHTER.cycleFinish()');
  check('cycleFinish changes the case material',
    await L('LIGHTER.mats.chrome.color.getHexString()') !== hex0 && await L('LIGHTER.finish') === 'matte');
  // every finish, not a hard-coded four: the list grew and the old count silently
  // stopped meaning "all of them"
  const seen = new Set([await L('LIGHTER.finish')]);
  for (let i = 1; i < n; i++) { await L('LIGHTER.cycleFinish()'); seen.add(await L('LIGHTER.finish')); }
  check('a full cycle visits every finish and returns to chrome',
    seen.size === n && await L('LIGHTER.finish') === 'chrome'
    && await L('LIGHTER.mats.chrome.color.getHexString()') === hex0, `saw ${seen.size}/${n}`);
}

/* 14 ── the appearance sheet: case, flame and backdrop in one place */
{
  await page.click('#styleBtn');
  check('the one style button opens the appearance sheet', await L('LIGHTER.styleOpen') === true);
  // one grid per set, and every option in each set is reachable — with fourteen
  // finishes, an off-by-one in the grid build hides options with no other symptom
  const counts = await page.evaluate(() => ({
    c: document.querySelectorAll('#swCase .sw').length,
    f: document.querySelectorAll('#swFlame .sw').length,
    b: document.querySelectorAll('#swBack .sw').length,
  }));
  const want = await page.evaluate(() => ({
    c: LIGHTER.FINISH_ORDER.length, f: LIGHTER.FLAME_ORDER.length, b: LIGHTER.BACKDROP_ORDER.length,
  }));
  // What matters is that the grid shows EVERY option, not that there are N of
  // them: a hard-coded count goes stale the moment the lists are curated, and
  // then fails for a reason unrelated to what it is guarding. The floor is only
  // there to catch a list collapsing to nothing.
  check('every case is on the sheet', counts.c === want.c && want.c >= 8, `${counts.c}/${want.c}`);
  check('every flame is on the sheet', counts.f === want.f && want.f >= 8, `${counts.f}/${want.f}`);
  check('every backdrop is on the sheet', counts.b === want.b && want.b >= 8, `${counts.b}/${want.b}`);

  const pick = (sec, name) => page.click(`#${sec} .sw:has(span:text-is("${name}"))`);
  await pick('swCase', 'crimson');                       // a design, not a plain metal
  check('picking a case applies it',
    await L('LIGHTER.finish') === 'crimson' && await L('LIGHTER.sim.disc.finish') === true);
  check('a design hangs a normal map on the case',
    await L('!!LIGHTER.mats.chrome.normalMap') === true);
  check('the picked swatch is the marked one',
    await L('document.querySelector("#swCase .sw.on span").textContent') === 'crimson');

  await pick('swBack', 'ember');
  check('picking a backdrop applies it', await L('LIGHTER.backdrop') === 'ember');
  check('the backdrop is a live texture', await L('!!LIGHTER.scene.background') === true);

  await pick('swFlame', 'sunset');                       // a two-hue combination
  check('picking a flame applies it', await L('LIGHTER.flameCol') === 'sunset');
  // Read the scheme, not the live uniforms: those are only written while LIT, so
  // a stale pair would pass or fail on render state rather than on the data.
  // Every scheme now has distinct body and tip colours -- that IS the heat
  // gradient -- so what separates a combination is that they differ in HUE, not
  // merely in value. Comparing the numbers alone stopped meaning anything.
  const hue = ([r, g, b]) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
    if (c < 1e-6) return 0;
    const h = mx === r ? ((g - b) / c + 6) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4;
    return h * 60;
  };
  const spread = async n => {
    const t = JSON.parse(await L(`JSON.stringify(LIGHTER.flameTint(${JSON.stringify(n)}))`));
    const d = Math.abs(hue(t.vol) - hue(t.vol2));
    return Math.min(d, 360 - d);
  };
  for (const n of ['sunset', 'aurora', 'peacock']) {
    const d = await spread(n);
    check(`${n} burns two hues`, d > 40, `${d.toFixed(0)} degrees apart`);
  }
  for (const n of ['classic', 'blue', 'emerald']) {
    const d = await spread(n);
    check(`${n} burns one hue`, d < 30, `${d.toFixed(0)} degrees apart`);
  }
  // The effect schemes change how the flame is BUILT, not just its hue. The
  // contract that matters is that a scheme without effects leaves every effect
  // uniform at zero -- otherwise adding an effect quietly alters the ten plain
  // flames, which is the kind of regression nothing else here would catch.
  const fxUniforms = ['uSpark', 'uShell', 'uPulse', 'uSwirl', 'uToon', 'uCore', 'uPrism'];
  const readFx = async () => L(`(() => { const u = LIGHTER.mats.flameVol.uniforms;
    return ${JSON.stringify(fxUniforms)}.map(k => {
      const v = u[k].value; return v.toArray ? Math.max(...v.toArray().map(Math.abs)) : Math.abs(v); }); })()`);
  // These uniforms are only written while the volume is actually rendering, so
  // the flame has to be LIT for any of it to mean anything. It used to tolerate
  // not lighting (`.catch(() => {})`), which made the zero-check pass on a
  // material nobody had touched -- vacuously true, whatever the code did.
  await L('(LIGHTER.closeStyle && LIGHTER.closeStyle(), 0)').catch(() => {});
  await page.evaluate(() => document.getElementById('styleClose')?.click());
  await page.waitForTimeout(300);
  await settleLid(true);
  await L('LIGHTER.setFlameCol("classic")');
  await lightIt();
  await waitL('LIGHTER.volActive === true', 10000);
  await page.waitForTimeout(400);
  check('a plain flame leaves every effect uniform at zero',
    (await readFx()).every(v => v === 0), JSON.stringify(await readFx()));
  // mats.flameVol used to be a boot snapshot of the plain program while the
  // render loop swapped the mesh between two materials, so this read a material
  // nothing ever writes -- the zero-check above could not have failed.
  await L('LIGHTER.setFlameCol("cinder")');
  await page.waitForTimeout(600);
  check('the debug flame handle follows the program swap',
    (await readFx()).some(v => v > 0), JSON.stringify(await readFx()));
  await L('LIGHTER.setFlameCol("classic")');
  await page.waitForTimeout(600);
  check('and swaps back to a plain program with the effects off',
    (await readFx()).every(v => v === 0), JSON.stringify(await readFx()));
  for (const [name, key] of [['cinder', 'spark'], ['vortex', 'swirl'], ['strata', 'toon'],
                             ['torch', 'core'], ['sodium', 'shell'], ['wisp', 'pulse'],
                             ['prism', 'prism']]) {
    const fx = await L(`JSON.stringify(LIGHTER.flameFx(${JSON.stringify(name)}))`);
    check(`${name} carries its effect`, fx && JSON.parse(fx) && JSON.parse(fx)[key] !== undefined, fx);
  }
  // The volume renders along its proxy box's local +Y, so that axis has to track
  // the flame's direction. The basis was built left-handed -- determinant -1 --
  // and setFromRotationMatrix silently returns a non-unit quaternion for a
  // reflection, so the box stayed upright while the flame leaned: measured up to
  // 180 deg out, and compose() shrank the box on top of that. It looked correct
  // at rest, which is exactly why it survived. Check it BENT, not upright.
  await L('LIGHTER.setFlameCol("classic")');
  await waitL('LIGHTER.volActive === true', 10000);
  check('the flame box tracks the flame at rest',
    await L('LIGHTER.flameBoxErrDeg') < 1,
    `${(await L('LIGHTER.flameBoxErrDeg')).toFixed(1)} deg`);
  let worstBox = 0;
  for (const [bx, bz] of [[0.9, 0], [-0.9, 0], [0, 0.9], [0.6, -0.7], [0, -1.2]]) {
    await L(`(LIGHTER.sim.flame.bend.set(${bx}, 0, ${bz}), 0)`);
    await page.waitForTimeout(160);
    worstBox = Math.max(worstBox, await L('LIGHTER.flameBoxErrDeg'));
  }
  await L('(LIGHTER.sim.flame.bend.set(0, 0, 0), 0)');
  await page.waitForTimeout(200);
  check('and keeps tracking it once it leans', worstBox < 1,
    `worst ${worstBox.toFixed(1)} deg off across five lean directions`);

  // put the flame out and hand the sheet back open, which is how this section
  // found things -- the uniform checks above had to close it and light up
  await settleLid(false);
  await waitL('LIGHTER.state === "OUT"', 10000);
  await page.click('#styleBtn');
  await page.waitForTimeout(400);

  await L('(LIGHTER.setFinish("chrome"), LIGHTER.setFlameCol("classic"), LIGHTER.setBackdrop("midnight"), 0)');
  check('a plain metal drops the normal map again',
    await L('!!LIGHTER.mats.chrome.normalMap') === false);
  await page.click('#styleClose');
  check('the sheet closes', await L('LIGHTER.styleOpen') === false);

  // Three equivalent ways out. The grab handle promises the third, and a handle
  // that does not do what it looks like it does is worse than no handle at all.
  const dragSheet = async (dy, steps = 14, stepMs = 16) => {
    const box = await page.locator('#styleGrab').boundingBox();
    await page.evaluate(async ([x, y0, dy, steps, stepMs]) => {
      const panel = document.getElementById('stylePanel');
      const mk = (t, cy, el) => (el || panel).dispatchEvent(new PointerEvent(t, {
        pointerId: 77, clientX: x, clientY: cy, pointerType: 'touch',
        bubbles: true, cancelable: true, isPrimary: true,
      }));
      mk('pointerdown', y0, document.getElementById('styleGrab'));
      for (let i = 1; i <= steps; i++) {
        await new Promise(r => setTimeout(r, stepMs));
        mk('pointermove', y0 + dy * (i / steps));
      }
      mk('pointerup', y0 + dy);
    }, [box.x + box.width / 2, box.y + box.height / 2, dy, steps, stepMs]);
    await page.waitForTimeout(420);
  };
  const reopen = async () => { await page.click('#styleBtn'); await page.waitForTimeout(420); };

  await reopen();
  await page.mouse.click(195, 56);          // the scrim, well clear of the panel
  check('tapping outside closes the sheet', await L('LIGHTER.styleOpen') === false);

  await reopen();
  await dragSheet(210);
  check('sliding the sheet down closes it', await L('LIGHTER.styleOpen') === false);

  await reopen();
  await dragSheet(150, 4, 8);               // short but fast
  check('a quick flick closes it too', await L('LIGHTER.styleOpen') === false,
    'distance alone would ignore this');

  await reopen();
  await dragSheet(38);                      // not far enough to mean it
  check('a small drag springs back instead', await L('LIGHTER.styleOpen') === true);

  // A press that slides sideways off the sheet and releases over the scrim used
  // to leave dragId set forever: capture is only taken once the drag goes live,
  // so the release never reached a panel-bound listener, and every later
  // pointerdown bailed out. The handle died for the rest of the session --
  // reopening did not clear it either.
  await page.evaluate(() => {
    const panel = document.getElementById('stylePanel'), grab = document.getElementById('styleGrab');
    const b = grab.getBoundingClientRect();
    const mk = (t, x, y, el) => (el || window).dispatchEvent(new PointerEvent(t, {
      pointerId: 91, clientX: x, clientY: y, pointerType: 'touch',
      bubbles: true, cancelable: true, isPrimary: true }));
    mk('pointerdown', b.x + b.width / 2, b.y + b.height / 2, grab);
    mk('pointermove', 4, b.y + b.height / 2 + 2, panel);   // sideways, under the 6px threshold
    mk('pointerup', 4, b.y + b.height / 2 + 2);            // released off the panel
  });
  await page.waitForTimeout(120);
  await dragSheet(210);
  check('a drag released off the sheet does not jam the handle',
    await L('LIGHTER.styleOpen') === false, 'handle stopped responding');

  // The wheel handler exempted the guide but not this sheet, which came later:
  // the wheel both zoomed the camera behind an open modal and, because the same
  // preventDefault cancelled the native scroll, made the swatch list unreachable
  // with a mouse.
  await reopen();
  const z0 = await L('LIGHTER.cam.zoom');
  await page.mouse.move(170, 500);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(200);
  check('the appearance sheet blocks wheel zoom the way the guide does',
    await L('LIGHTER.cam.zoom') === z0, `zoom ${z0} -> ${await L('LIGHTER.cam.zoom')}`);
  await page.click('#styleClose');
  await page.waitForTimeout(300);

  // The design belongs to the case shell. The insert -- chimney, tank, flint
  // tube, screw -- is a separate part you could swap between cases, so it keeps
  // its own metal whatever the case is wearing.
  {
    const read = () => L('({ c: LIGHTER.mats.chrome.color.getHexString(),' +
      ' ins: LIGHTER.mats.insertMetal.color.getHexString(),' +
      ' insMap: !!LIGHTER.mats.insertMetal.map,' +
      ' hwMap: !!LIGHTER.mats.chromeDark.map })');
    await L('LIGHTER.setFinish("chrome")');
    const a = await read();
    await L('LIGHTER.setFinish("sunburst")');   // a design, not just a colour
    const b = await read();
    await L('LIGHTER.setFinish("patina")');     // and one that carries an albedo map
    const c = await read();
    check('the case itself changes with the finish', a.c !== b.c || b.c !== c.c);
    check('the insert keeps its own colour', a.ins === b.ins && b.ins === c.ins,
      `${a.ins} / ${b.ins} / ${c.ins}`);
    check('no design map ever reaches the insert',
      a.insMap === false && b.insMap === false && c.insMap === false);
    // Eight finishes carry their colour in an albedo MAP and set dark.color
  // near-white as that map's multiplier. The fittings cannot wear the map, so
  // using that white as a flat colour turned the hinge knuckles into bright
  // white nubs down the seam of a verdigris or a tortoiseshell case.
  {
    const bad = [];
    for (const n of ['patina', 'rust', 'tortoise', 'marble', 'camo', 'fireblue', 'meteorite', 'livery']) {
      await L(`LIGHTER.setFinish(${JSON.stringify(n)})`);
      const hex = await L('LIGHTER.mats.chromeDark.color.getHexString()');
      const [r, g, bl] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
      if (Math.min(r, g, bl) > 0xc8) bad.push(`${n}:${hex}`);
    }
    check('map-driven finishes give the fittings a real colour, not a white multiplier',
      bad.length === 0, bad.join(' '));
  }
  // matChromeDark had roughnessMap pinned on at construction and applyFinish
  // never reassigned it, so every finish's dark.map was dead data and the
  // fittings wore brushed grain on all 24 -- including matte, which asks for none.
  {
    await L('LIGHTER.setFinish("matte")');
    const off = await L('!!LIGHTER.mats.chromeDark.roughnessMap');
    await L('LIGHTER.setFinish("chrome")');
    const on = await L('!!LIGHTER.mats.chromeDark.roughnessMap');
    check('the fittings honour each finish\'s grain flag', off === false && on === true,
      `matte=${off} chrome=${on}`);
  }
  await L('LIGHTER.setFinish("chrome")');

  check('no design map reaches the hinge and cam either',
      a.hwMap === false && b.hwMap === false && c.hwMap === false);
    await L('LIGHTER.setFinish("chrome")');
  }

  // The case is TWO geometries -- a solid box while the insert is seated, an
  // extruded shell once it lifts out -- and ExtrudeGeometry maps its side walls
  // off world position, so the design landed at ~4x scale and jumped the moment
  // you pulled the insert. Every surface that can wear a design has to agree on
  // one UV convention or the swap is visible.
  {
    const uv = await L(`(() => {
      const bad = [];
      LIGHTER.scene.traverse(o => {
        if (!o.isMesh || o.material !== LIGHTER.mats.chrome) return;
        const a = o.geometry.attributes.uv;
        if (!a) { bad.push(o.geometry.type + ':no-uv'); return; }
        let lo = 1e9, hi = -1e9;
        for (let i = 0; i < a.count; i++) {
          lo = Math.min(lo, a.getX(i), a.getY(i));
          hi = Math.max(hi, a.getX(i), a.getY(i));
        }
        if (lo < -0.01 || hi > 1.01) bad.push(o.geometry.type + ':' + lo.toFixed(2) + '..' + hi.toFixed(2));
      });
      return bad;
    })()`);
    check('every case surface uses the same 0..1 UV convention', uv.length === 0, uv.join(', '));
  }

  // On metal a facet boundary is a hard specular step, so a faceted rounded edge
  // paints a bright outline round the whole silhouette. boxProjectUV used to open
  // with computeVertexNormals(); RoundedBoxGeometry is NON-indexed and ships
  // hand-built smooth fillet normals, and computeVertexNormals on non-indexed
  // geometry writes one flat normal per triangle -- so routing the case body,
  // plinth, lid body and cap through it faceted every one of them (measured 100%
  // of triangles flat). A flat-shaded triangle is one whose three vertices share
  // a normal, which is what this counts.
  {
    const shading = await L(`(() => {
      const out = [];
      LIGHTER.scene.traverse(o => {
        if (!o.isMesh || o.material !== LIGHTER.mats.chrome) return;
        const g = o.geometry, n = g.attributes.normal, pos = g.attributes.position;
        if (!n) { out.push({ t: g.type, flatPct: 100 }); return; }
        let tris = 0, flat = 0;
        for (let i = 0; i + 2 < pos.count; i += 3) {
          tris++;
          if ([1, 2].every(k => Math.abs(n.getX(i) - n.getX(i + k)) < 1e-6
              && Math.abs(n.getY(i) - n.getY(i + k)) < 1e-6
              && Math.abs(n.getZ(i) - n.getZ(i + k)) < 1e-6)) flat++;
        }
        out.push({ t: g.type, flatPct: 100 * flat / tris });
      });
      return out;
    })()`);
    // the rings keep genuinely flat rim and wall faces, so they sit near 50;
    // a fully faceted piece is 100, which is the regression
    const bad = shading.filter(r => r.flatPct > 75)
      .map(r => `${r.t}:${r.flatPct.toFixed(0)}%`);
    check('the case keeps its smooth fillet normals, so edges are not faceted',
      shading.length >= 6 && bad.length === 0, `${bad.join(' ')} (of ${shading.length})`);
  }

  // Range is not scale. This check used to be a byte-for-byte copy of the one
  // above -- it asserted 0..1 again under a name that promised something else,
  // and so it passed happily while the 0.40-tall plinth crushed a whole tile
  // into the bottom of the case at 13.7x the frequency of the piece beside it,
  // and the lid's cap did the same at 2.7x. A short piece with a legitimate
  // 0..1 v is exactly the bug. Measure the SCALE: world units of height per
  // unit of v, on the broad faces where the design actually reads. Every piece
  // of the case must agree on BASE_H and every piece of the lid on LID_H.
  {
    const scale = await L(`(() => {
      const rows = [];
      LIGHTER.scene.updateMatrixWorld(true);
      LIGHTER.scene.traverse(o => {
        if (!o.isMesh || o.material !== LIGHTER.mats.chrome) return;
        const g = o.geometry, pos = g.attributes.position, uv = g.attributes.uv;
        if (!uv) { rows.push({ t: g.type, err: 'no-uv' }); return; }
        if (!g.attributes.normal) g.computeVertexNormals();
        const nor = g.attributes.normal, e = o.matrixWorld.elements;
        let yLo = 1e9, yHi = -1e9, vLo = 1e9, vHi = -1e9, n = 0;
        for (let i = 0; i < pos.count; i++) {
          const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
          if (!(nz > nx && nz > ny)) continue;                  // broad faces only
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
          const vv = uv.getY(i);
          if (wy < yLo) yLo = wy; if (wy > yHi) yHi = wy;
          if (vv < vLo) vLo = vv; if (vv > vHi) vHi = vv;
          n++;
        }
        if (!n || vHi - vLo < 1e-4) return;
        rows.push({ t: g.type, y: yLo, upv: (yHi - yLo) / (vHi - vLo) });
      });
      return rows;
    })()`);
    const BASE_H = await L('LIGHTER.CFG.BASE_H'), LID_H = await L('LIGHTER.CFG.LID_H');
    // the lid sits above the case, so its pieces are the ones starting high up
    const bad = scale.filter(r => {
      if (r.err) return true;
      const want = r.y > BASE_H - 0.5 ? LID_H : BASE_H;
      return Math.abs(r.upv - want) > 0.02 * want;
    }).map(r => `${r.t}@${(r.y || 0).toFixed(2)}:${r.err || r.upv.toFixed(2)}`);
    check('every case surface maps the design at the same scale',
      scale.length >= 6 && bad.length === 0, `${bad.join(' ')} (of ${scale.length})`);
  }

  // the retired press-and-hold gesture must no longer swap anything
  const bc = await L('LIGHTER.anchor("baseCenter")');
  await page.evaluate(async ([p]) => {
    window.__pt('pointerdown', 93, p.x, p.y);
    await window.__sleep(1600);
    window.__pt('pointerup', 93, p.x, p.y);
  }, [bc]);
  check('holding the case no longer swaps finish', await L('LIGHTER.finish') === 'chrome');
}

/* 15 ── uiScale is capped on tablet-sized viewports */
await page.setViewportSize({ width: 1024, height: 1366 });
await page.waitForTimeout(300);
check('uiScale is capped on tablets', Math.abs(await L('LIGHTER.uiScale()') - 1.6) < 1e-6,
  `uiScale=${await L('LIGHTER.uiScale()')}`);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);

/* 16 ── the guide: opens, explains the real thing, gauges track the sim */
await L('LIGHTER.sim.fuel = 0.37');
await page.click('#infoBtn');
await waitL('LIGHTER.guideOpen');
check('info button opens the guide', true);
check('guide explains functions + maintenance', await L(
  `document.getElementById("guideBody").textContent.includes("capillary")
   && document.getElementById("guideBody").textContent.includes("spring screw")
   && document.getElementById("guideBody").textContent.includes("pliers")`));
check('no brand names anywhere user-visible', await L(
  `!document.body.innerText.includes("Zippo") && !document.title.includes("Zippo")
   && !document.getElementById("infoBtn").getAttribute("aria-label").includes("Zippo")
   && !document.getElementById("guide").getAttribute("aria-label").includes("Zippo")`));
// The copy claimed four finishes and four flames, and a second button "below"
// the swatch, long after both were collapsed into one sheet holding 24 and 17.
// Counts come from the live lists now, so the paragraph cannot drift again.
{
  const nFin = await L('LIGHTER.finishCount'), nFlame = await L('LIGHTER.flameCount');
  const nBack = await L('LIGHTER.backdropCount');
  const shown = await L(`[document.getElementById('guideNFin').textContent,
    document.getElementById('guideNFlame').textContent,
    document.getElementById('guideNBack').textContent].join(',')`);
  check('the guide quotes the real number of finishes, flames and backdrops',
    shown === `${nFin},${nFlame},${nBack}` && nFin > 4 && nFlame > 4,
    `shows ${shown}, actually ${nFin},${nFlame},${nBack}`);
  const how = await L(`document.querySelector('#guide .how').textContent`);
  check('and no longer describes a second button below the swatch',
    !/below it/i.test(how) && !/those four/i.test(how), how.slice(0, 120));
}
check('affiliation disclaimer present', await L(
  'document.getElementById("guideLegal").textContent.includes("Not affiliated")'));
check('fuel gauge tracks the tank', await L('document.getElementById("gFuel").style.width') === '37%');
check('main-screen fuel bar tracks the tank', await L('document.getElementById("hFuel").style.width') === '37%');
check('main-screen flint bar is full after refill', await L('document.getElementById("hFlint").style.width') === '100%');
check('focus moves into the dialog', await L('document.activeElement && document.activeElement.id') === 'guideClose');
{ // canvas, wheel and keyboard input are all dead while the sheet is up
  const yaw0 = await L('LIGHTER.cam.yaw');
  await page.evaluate(() => window.__swipe(200, 400, 120, 400, 150, 55));
  await page.waitForTimeout(250);
  check('guide blocks canvas gestures', Math.abs(await L('LIGHTER.cam.yaw') - yaw0) < 1e-6);
  const z0 = await L('LIGHTER.cam.zoom');
  await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, cancelable: true })));
  await page.keyboard.press(' ');   // would flip the lid open if the gate leaked
  await page.waitForTimeout(250);
  check('guide blocks wheel zoom + sim keys',
    await L('LIGHTER.cam.zoom') === z0 && await L('LIGHTER.lidTheta') < 0.05
    && await L('LIGHTER.state') === 'OUT');
}
// Space on the focused close button legitimately activates it — normalize, then
// test each dismissal path from a cleanly opened sheet
await L('(LIGHTER.closeGuide(), 0)');
await page.click('#infoBtn');
await waitL('LIGHTER.guideOpen');
await page.keyboard.press('Escape');
check('Escape closes the guide', await L('LIGHTER.guideOpen') === false);
await page.click('#infoBtn');
await waitL('LIGHTER.guideOpen');
await page.click('#guideClose');
check('close button closes the guide', await L('LIGHTER.guideOpen') === false);

/* 17 ── debug fast-forwards + flame colours */
await L('LIGHTER.refill()');
await page.click('#ffFuel');
check('debug button fast-forwards fuel', Math.abs(await L('LIGHTER.fuel') - 0.75) < 0.01,
  `fuel=${await L('LIGHTER.fuel')}`);
await page.click('#ffFuel');
await page.click('#ffFuel');
await page.click('#ffFuel');
check('four fuel taps drain the tank dry', await L('LIGHTER.fuel') === 0);
{
  const flint0 = await L('LIGHTER.flint');
  await page.click('#ffFlint');
  check('debug button fast-forwards flint wear', await L('LIGHTER.flint') === flint0 + 20);
}
await L('LIGHTER.refill()');
{
  await page.click('#styleBtn');
  check('the style button reopens the sheet', await L('LIGHTER.styleOpen') === true);
  // one control, but it still reports BOTH selections: case on the left half,
  // flame on the right. Collapsing two buttons into one must not cost that.
  check('the button face shows the case and the flame',
    await L('!!document.getElementById("finishSwatch") && !!document.getElementById("flameSwatch")')
    && await L('document.getElementById("flameBtn") === null'));
  await page.click('#swFlame .sw:has(span:text-is("blue"))');
  check('picking blue lights it blue',
    await L('LIGHTER.flameCol') === 'blue' && await L('LIGHTER.flameLightHex') === '5f9dff');
  await page.click('#swFlame .sw:has(span:text-is("classic"))');
  check('picking classic puts it back',
    await L('LIGHTER.flameCol') === 'classic' && await L('LIGHTER.flameLightHex') === 'ff9a3c');
  await page.click('#styleClose');
}

/* 18 ── the service ritual: pull, refuel, re-flint, reassemble */
await settleLid(true);
await L('(LIGHTER.sim.fuel = 0.2, LIGHTER.sim.flint = 70, 0)');
{ // pull the insert out by the chimney
  const m = await L('LIGHTER.anchor("mouth")');
  await page.evaluate(async ([m]) => {
    window.__pt('pointerdown', 71, m.x, m.y);
    for (let i = 1; i <= 30; i++) {
      await window.__sleep(18);
      window.__pt('pointermove', 71, m.x, m.y - i * 10);
    }
    window.__pt('pointerup', 71, m.x, m.y - 300);
  }, [m]);
  await waitL('LIGHTER.svcState === "out"', 15000);
  check('pulling the chimney frees the insert', true);
  await waitL('LIGHTER.sim.svc.pose > 0.9', 15000);
  await waitL('document.getElementById("hint").textContent.includes("felt pad")', 8000);
  check('service instructions take over the pill', true);
  check('done button offered', await L('document.getElementById("svcDone").classList.contains("show")'));
  { // the done button used to paint over the multi-line service instruction, and
    // the pill used to ellipsise its own text away — both on every phone width
    const box = await L(`(() => {
      const h = document.getElementById('hint'), d = document.getElementById('svcDone');
      const a = h.getBoundingClientRect(), b = d.getBoundingClientRect();
      return { overlap: Math.max(0, b.bottom - a.top), clipped: h.scrollWidth > h.clientWidth + 1,
        onscreen: a.bottom <= window.innerHeight && b.top >= 0 };
    })()`);
    check('the done button never covers the service instruction', box.overlap === 0,
      `overlap ${box.overlap}px`);
    check('the instruction is never cut off', box.clipped === false);
    check('both stay on screen', box.onscreen);
  }
  check('striking is locked mid-service', await L('LIGHTER.strike(3)') === false);
}
{ // tap the felt pad open; the fluid can arrives
  const p = await L('LIGHTER.anchor("svcPadEdge")');
  await page.evaluate(async ([p]) => {
    window.__pt('pointerdown', 72, p.x, p.y);
    await window.__sleep(60);
    window.__pt('pointerup', 72, p.x, p.y);
  }, [p]);
  await waitL('LIGHTER.sim.svc.pad > 0.8 && LIGHTER.sim.svc.can > 0.6', 15000);
  check('felt pad peels open and the can slides in', true);
}
{ // hold on the cotton until full
  await page.evaluate(() => { const p = LIGHTER.anchor('svcPacking'); window.__pt('pointerdown', 73, p.x, p.y); });
  await waitL('LIGHTER.fuel >= 1', 30000);
  await page.evaluate(() => { const p = LIGHTER.anchor('svcPacking'); window.__pt('pointerup', 73, p.x, p.y); });
  check('holding on the cotton fills the tank', true);
  // fold the pad shut again
  const p = await L('LIGHTER.anchor("svcPadEdge")');
  await page.evaluate(async ([p]) => {
    window.__pt('pointerdown', 74, p.x, p.y);
    await window.__sleep(60);
    window.__pt('pointerup', 74, p.x, p.y);
  }, [p]);
  await waitL('LIGHTER.sim.svc.pad < 0.2', 15000);
}
{ // flint: tap the screw out, tip the stub, drop the fresh flint, screw back
  const tap = async (name, id) => {
    const p = await L(`LIGHTER.anchor("${name}")`);
    await page.evaluate(async ([p, id]) => {
      window.__pt('pointerdown', id, p.x, p.y);
      await window.__sleep(60);
      window.__pt('pointerup', id, p.x, p.y);
    }, [p, id]);
  };
  // A tap only counts under CFG.TAP_MS (280ms). On a loaded CI box the 60ms
  // sleep between down and up can stretch past that, so the tap silently
  // becomes a long press and nothing happens. Re-tap until the step lands —
  // guarded by an up-front check so a retry can never undo a tap that worked.
  const tapUntil = async (name, id, expr, tries = 5) => {
    for (let i = 0; i < tries; i++) {
      if (await L(expr)) return true;
      await tap(name, id + i * 10);
      try { await waitL(expr, 6000); return true; } catch (e) { /* stalled: tap again */ }
    }
    return await L(expr);
  };
  check('tapping the screw backs it out (spring pops free)',
    await tapUntil('svcScrew', 75, 'LIGHTER.sim.svc.screwOut'));
  check('tapping the tube tips out the worn flint',
    await tapUntil('svcTube', 76, 'LIGHTER.sim.svc.stub === false && LIGHTER.sim.svc.stubHop === 0'));
  const f = await L('LIGHTER.anchor("svcFlint")');
  const t = await L('LIGHTER.anchor("svcTube")');
  await page.evaluate(async ([f, t]) => {
    window.__pt('pointerdown', 77, f.x, f.y);
    for (let i = 1; i <= 14; i++) {
      await window.__sleep(24);
      window.__pt('pointermove', 77, f.x + (t.x - f.x) * (i / 14), f.y + (t.y - f.y) * (i / 14));
    }
    window.__pt('pointerup', 77, t.x, t.y);
  }, [f, t]);
  await waitL('LIGHTER.sim.svc.flintNew === true', 15000);
  check('dragging the fresh flint drops it in the tube', true);
  const seated = await tapUntil('svcScrew', 78,
    '!LIGHTER.sim.svc.screwOut && LIGHTER.sim.svc.screw >= 1');
  check('screwing back down renews the flint', seated && await L('LIGHTER.flint') === 0);
}
{ // done: slides home, everything back to normal
  await page.click('#svcDone');
  await waitL('LIGHTER.svcState === "seated" && LIGHTER.sim.svc.pose < 0.02', 15000);
  check('done seats the insert', true);
  await lightIt();
  check('the serviced lighter lights again', await L('LIGHTER.state') === 'LIT');
  await settleLid(false);
}
{ // review hardening: unseated safety gates
  await settleLid(true);
  await L('(LIGHTER.sim.svc.y = 1.0, 0)');
  check('striking is blocked mid-pull', await L('LIGHTER.strike(3)') === false);
  await L('(LIGHTER.sim.svc.y = 0, 0)');
  await L('LIGHTER.bendWick(1)');
  const tip = await L('LIGHTER.anchor("tip")');
  await page.evaluate(([p]) => window.__swipe(p.x, p.y, p.x + 4, p.y - 220, 260, 79), [tip]);
  await page.waitForTimeout(400);
  check('a bent-wick taut-pull never rips the insert out',
    await L('LIGHTER.svcState') === 'seated' && await L('LIGHTER.sim.svc.y') === 0);
  await L('LIGHTER.straighten()');
  await waitL('!LIGHTER.wickBent()');
}
{ // sealing an empty tube is honest: no flint, no sparks, and it says so
  await settleLid(true);
  await L('LIGHTER.svcOut()');
  await waitL('LIGHTER.sim.svc.pose > 0.9', 15000);
  await L('(LIGHTER.sim.svc.screwOut = true, LIGHTER.sim.svc.stub = false, 0)');
  await L('LIGHTER.svcSeat()');
  await waitL('LIGHTER.svcState === "seated"', 15000);
  check('sealing an empty tube marks the flint missing', await L('LIGHTER.sim.flintMissing') === true);
  const sp0 = await L('LIGHTER.sim.counts.sparks');
  await page.waitForTimeout(700);
  const r = await L('LIGHTER.strike(3)');
  check('an empty tube never sparks', r === false && await L('LIGHTER.sim.counts.sparks') === sp0);
  await waitL('document.getElementById("hint").textContent.includes("empty")', 10000);
  check('the empty tube explains itself', true);
  // pulling it again shows the tube honestly empty, and the lid stays put
  await L('LIGHTER.svcOut()');
  await waitL('LIGHTER.sim.svc.pose > 0.9', 15000);
  check('an emptied tube pulls out visibly empty', await L('LIGHTER.sim.svc.stub') === false);
  // You hold an insert alongside its case to fuel it, not cocked out at an
  // angle to it. This pinned a real regression: the pose used to settle 68 deg
  // off parallel, which read as the insert being wrenched sideways.
  await waitL('LIGHTER.sim.svc.pose > 0.999', 15000);   // the flip is still easing at 0.9
  const tilt = await L('LIGHTER.svcTiltDeg');
  check(`the pulled insert is held near parallel to the case (${tilt.toFixed(1)} deg)`, tilt < 15);
  await L('LIGHTER.closeLid()');
  await page.waitForTimeout(600);
  check('the lid waits while the insert is out', await L('LIGHTER.lidTheta') > 1.0);
  await L('LIGHTER.svcSeat()');
  await waitL('LIGHTER.svcState === "seated"', 15000);
  await L('LIGHTER.refill()');
  check('quick refill still fits a flint too', await L('LIGHTER.sim.flintMissing') === false);
  await settleLid(false);
}

/* discovered tricks persist across sessions */
await L('LIGHTER.sim.fuel = 0.42');
await L('LIGHTER.setFinish("brass")');
await L('LIGHTER.setFlameCol("emerald")');
await page.evaluate(() => localStorage.setItem('lighter.disc', JSON.stringify({ lit: true, pop: true })));
await page.reload();
await page.waitForFunction(() => window.__booted && window.LIGHTER && window.LIGHTER.frames > 5, null, { timeout: 30000 });
await pinCfg();
check('discovered tricks persist across reload',
  await L('LIGHTER.sim.disc.lit === true && LIGHTER.sim.disc.pop === true'));
check('fuel level persists across reload', Math.abs(await L('LIGHTER.fuel') - 0.42) < 0.02,
  `fuel=${await L('LIGHTER.fuel')}`);
check('finish persists across reload',
  await L('LIGHTER.finish') === 'brass' && await L('LIGHTER.mats.chrome.color.getHexString()') === 'd6a84f'
  && await L('document.getElementById("finishSwatch").style.backgroundColor') === 'rgb(214, 168, 79)');
check('flame colour persists across reload',
  await L('LIGHTER.flameCol') === 'emerald' && await L('LIGHTER.flameLightHex') === '57e084');

/* 8 ── no console errors */
check('no console errors', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 6)));

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) console.log('failures:', failures.join(' | '));
await browser.close();
process.exit(fail ? 1 : 0);
