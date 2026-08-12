'use strict';

const $ = (s) => document.querySelector(s);
const scene = $('#scene');
const lighterEl = $('#lighter');
const caseEl = $('.case');
const lidEl = $('#lid');
const wheelEl = $('#wheel');
const wickEl = $('#wick');
const hintEl = $('#hint');
const canvas = $('#fx');
const ctx2d = canvas.getContext('2d');

/* lid mechanics: 0 = closed, LID_OPEN = fully open; the spring cam pushes the
   lid toward whichever side of LID_SNAP it is on, so it never rests half-open */
const LID_OPEN = 102;
const LID_SNAP = 46;
const LID_TORQUE = 0.009;   // deg/ms^2
const LID_DAMP = 0.0045;    // per ms

const state = {
  lid: { angle: 0, vel: 0, dragging: false },
  lit: false,
  flame: { v: 0, bend: 0, bendV: 0, wind: 0, stress: 0, lick: 0, born: 0 },
  rock: { a: 0, v: 0 },
  tilt: 0,
  failedStrikes: 0,
  wheelShift: 0,
  wheelVel: 0,
  ember: null,
  lastOut: -1e9,
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const openS = () => clamp(state.lid.angle / LID_OPEN, 0, 1);
const isOpen = () => state.lid.angle > LID_OPEN * 0.8;

let sparks = [];
let smoke = [];
let embers = [];
let W = 0;
let H = 0;

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

/* ---------------------------------------------------------------- sound */

const Sound = (() => {
  let ac = null;
  let master = null;
  let flame = null;
  const bufs = {};

  function unlock() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0.9;
      master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
  }

  function ready() {
    unlock();
    return !!ac;
  }

  function noiseBuffer(kind) {
    if (bufs[kind]) return bufs[kind];
    const len = Math.floor(ac.sampleRate * 1.2);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    if (kind === 'white') {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } else {
      let b = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b = (b + 0.02 * w) / 1.02;
        d[i] = b * 3.5;
      }
    }
    bufs[kind] = buf;
    return buf;
  }

  function burst({ kind = 'white', dur = 0.1, type = 'bandpass', freq = 2000, q = 1, gain = 0.2, when = 0, sweep = 0 }) {
    const t0 = ac.currentTime + when;
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer(kind);
    src.loop = true;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t0 + dur);
    const gn = ac.createGain();
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(gn);
    gn.connect(master);
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.05);
  }

  function ping(freq, dur, gain, when = 0) {
    const t0 = ac.currentTime + when;
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const gn = ac.createGain();
    gn.gain.setValueAtTime(gain, t0);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(gn);
    gn.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  return {
    unlock,
    /* the bright "cling" of the lid swinging open; k scales with impact */
    open(k = 1) {
      if (!ready()) return;
      burst({ dur: 0.02, type: 'highpass', freq: 2500, gain: 0.3 * k });
      ping(2280, 0.16, 0.16 * k);
      ping(3390, 0.12, 0.1 * k);
      ping(5490, 0.07, 0.05 * k);
      ping(920, 0.04, 0.08 * k);
    },
    /* the duller "clack" of it snapping shut */
    close(k = 1) {
      if (!ready()) return;
      burst({ dur: 0.045, type: 'lowpass', freq: 750, gain: 0.55 * k });
      ping(1180, 0.08, 0.14 * k);
      ping(1770, 0.05, 0.07 * k);
      ping(150, 0.07, 0.25 * k);
    },
    /* faint hinge friction while the lid is dragged slowly */
    creak(i) {
      if (!ready()) return;
      burst({ dur: 0.018, type: 'bandpass', freq: 620 + Math.random() * 320, q: 2.2, gain: 0.02 + 0.05 * i });
    },
    tick() {
      if (!ready()) return;
      burst({ dur: 0.012, type: 'highpass', freq: 3800, gain: 0.1 });
    },
    scratch(i) {
      if (!ready()) return;
      burst({ dur: 0.05 + 0.07 * i, type: 'bandpass', freq: 2600, q: 0.7, gain: 0.1 + 0.3 * i });
      for (let k = 0; k < 3; k++) {
        burst({ dur: 0.008, type: 'highpass', freq: 4200, gain: 0.12 + 0.1 * i, when: 0.012 * k + Math.random() * 0.01 });
      }
    },
    whoof() {
      if (!ready()) return;
      burst({ kind: 'brown', dur: 0.3, type: 'lowpass', freq: 1400, sweep: 320, gain: 0.8 });
    },
    puff() {
      if (!ready()) return;
      burst({ kind: 'brown', dur: 0.16, type: 'lowpass', freq: 1100, gain: 0.55 });
    },
    flameOn() {
      if (!ready() || flame) return;
      const src = ac.createBufferSource();
      src.buffer = noiseBuffer('brown');
      src.loop = true;
      const f = ac.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 520;
      const gn = ac.createGain();
      gn.gain.setValueAtTime(0.0001, ac.currentTime);
      gn.gain.exponentialRampToValueAtTime(0.16, ac.currentTime + 0.4);
      const lfo = ac.createOscillator();
      lfo.frequency.value = 7.3;
      const lfoG = ac.createGain();
      lfoG.gain.value = 0.05;
      const lfo2 = ac.createOscillator();
      lfo2.frequency.value = 0.9;
      const lfo2G = ac.createGain();
      lfo2G.gain.value = 0.06;
      lfo.connect(lfoG);
      lfoG.connect(gn.gain);
      lfo2.connect(lfo2G);
      lfo2G.connect(gn.gain);
      src.connect(f);
      f.connect(gn);
      gn.connect(master);
      src.start(0, Math.random());
      lfo.start();
      lfo2.start();
      flame = { src, lfo, lfo2, gn };
    },
    flameOff() {
      if (!flame) return;
      const { src, lfo, lfo2, gn } = flame;
      flame = null;
      const t0 = ac.currentTime;
      gn.gain.cancelScheduledValues(t0);
      gn.gain.setValueAtTime(Math.max(0.0001, gn.gain.value), t0);
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
      setTimeout(() => {
        try { src.stop(); lfo.stop(); lfo2.stop(); } catch (e) { /* already stopped */ }
      }, 250);
    },
  };
})();

function buzz(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch (e) { /* not supported */ }
}

/* ------------------------------------------------------------- geometry */

function flameAnchor() {
  const r = wickEl.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height * 0.25 };
}

function wheelAnchor() {
  const r = wheelEl.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height * 0.12 };
}

/* screen position of the lid hinge (bottom-right of the lid at rest) */
function hingePoint() {
  const r = caseEl.getBoundingClientRect();
  return { x: r.right, y: r.top };
}

function inflate(r, m) {
  return { left: r.left - m, right: r.right + m, top: r.top - m, bottom: r.bottom + m };
}

function within(x, y, r) {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function zoneAt(x, y) {
  if (isOpen() && within(x, y, inflate(wheelEl.getBoundingClientRect(), 18))) return 'wheel';
  if (within(x, y, inflate(lidEl.getBoundingClientRect(), 6))) return 'lid';
  if (within(x, y, inflate(lighterEl.getBoundingClientRect(), 10))) return 'body';
  return 'scene';
}

/* ---------------------------------------------------------------- hints */

let hintDone = false;
function setHint(stage) {
  if (hintDone) return;
  const msgs = ['flick up to open', 'spin the wheel down', 'close the lid to snuff it'];
  if (stage === 2) {
    hintEl.textContent = msgs[2];
    hintEl.style.opacity = '1';
    setTimeout(() => {
      hintEl.style.opacity = '0';
      hintDone = true;
    }, 3200);
  } else {
    hintEl.textContent = msgs[stage] || '';
    hintEl.style.opacity = msgs[stage] ? '1' : '0';
  }
}

/* ------------------------------------------------------------ wake lock */

let wakeLock = null;
async function acquireWakeLock() {
  try {
    if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { /* denied or unsupported */ }
}
function releaseWakeLock() {
  try {
    if (wakeLock) wakeLock.release();
  } catch (e) { /* already released */ }
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.lit) acquireWakeLock();
});

/* ----------------------------------------------------------------- tilt */

let tiltAsked = false;
function requestTiltPermission() {
  const D = window.DeviceOrientationEvent;
  if (!D || tiltAsked) return;
  if (typeof D.requestPermission === 'function') {
    tiltAsked = true;
    D.requestPermission().catch(() => {});
  }
}
window.addEventListener('deviceorientation', (e) => {
  if (e.gamma == null) return;
  state.tilt = clamp(e.gamma / 45, -1, 1);
});

/* -------------------------------------------------------------- actions */

/* impulses, not animations: the cam spring does the rest */
function flickOpen(strength = 1) {
  if (state.lid.dragging) return;
  state.lid.vel = Math.max(state.lid.vel, 1.0 + 0.4 * clamp(strength, 0, 2));
}

function flickClosed(strength = 1) {
  if (state.lid.dragging) return;
  state.lid.vel = Math.min(state.lid.vel, -(1.05 + 0.4 * clamp(strength, 0, 2)));
}

function lidImpact(open, v) {
  const i = clamp((v - 0.15) / 1.2, 0, 1);
  if (i > 0.02) {
    if (open) Sound.open(0.35 + 0.65 * i);
    else Sound.close(0.35 + 0.65 * i);
    buzz(Math.round(4 + 12 * i));
  }
  state.rock.v += (open ? -1 : 1) * Math.min(0.03, v * 0.02);
  if (open) setHint(1);
  else if (!state.lit && !hintDone) setHint(0);
}

function ignite() {
  if (state.lit || !isOpen()) return;
  state.lit = true;
  state.failedStrikes = 0;
  state.flame.born = performance.now();
  state.flame.stress = 0;
  state.ember = null;
  wickEl.classList.add('charred');
  Sound.whoof();
  Sound.flameOn();
  buzz([8, 30, 12]);
  setHint(2);
  acquireWakeLock();
}

function extinguish(reason) {
  if (!state.lit) return;
  state.lit = false;
  state.lastOut = performance.now();
  const a = flameAnchor();
  state.ember = { x: a.x, y: a.y, t0: state.lastOut };
  Sound.flameOff();
  releaseWakeLock();
  if (reason === 'blow') {
    state.flame.v = Math.min(state.flame.v, 0.15);
    spawnSmoke(a.x, a.y, 14, 1);
    Sound.puff();
  } else {
    /* snuffed under the lid: the smoke stays inside, except a little that
       seeps out of the seam once the lid is down */
    state.flame.v = Math.min(state.flame.v, 0.3);
    setTimeout(() => {
      const c = caseEl.getBoundingClientRect();
      spawnSmoke(c.left + c.width * 0.1, c.top - 2, 3, 0.85, -0.008);
      spawnSmoke(c.right - c.width * 0.1, c.top - 2, 3, 0.85, 0.008);
      spawnSmoke(c.left + c.width * 0.5, c.top - 1, 2, 0.6);
    }, 260);
  }
}

function strike(speed) {
  spawnSparks(wheelAnchor(), flameAnchor(), speed);
  Sound.scratch(clamp(speed / 2.2, 0, 1));
  buzz(9);
  if (isOpen() && !state.lit) {
    let p = 0.3 + speed * 0.28;
    /* a still-warm wick catches more easily */
    if (performance.now() - state.lastOut < 1600) p += 0.25;
    const willLight = state.failedStrikes >= 2 || Math.random() < Math.min(0.94, p);
    if (willLight) setTimeout(ignite, 40 + Math.random() * 50);
    else state.failedStrikes++;
  }
}

/* ------------------------------------------------------------- gestures */

let g = null;

scene.addEventListener('pointerdown', (e) => {
  if (g) return;
  Sound.unlock();
  const now = performance.now();
  g = {
    id: e.pointerId,
    x0: e.clientX, y0: e.clientY, t0: now,
    x: e.clientX, y: e.clientY, t: now,
    zone: zoneAt(e.clientX, e.clientY),
    moved: false, struck: false, tickAcc: 0, wheelDist: 0,
    lidVel: 0, lidPhi0: 0, lidAngle0: 0, creakAcc: 0, lastCreak: 0,
  };
  try { scene.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
});

scene.addEventListener('pointermove', (e) => {
  if (!g || e.pointerId !== g.id) return;
  const now = performance.now();
  const dx = e.clientX - g.x;
  const dy = e.clientY - g.y;
  const dt = Math.max(1, now - g.t);
  if (Math.abs(e.clientX - g.x0) + Math.abs(e.clientY - g.y0) > 8) g.moved = true;

  if (g.zone === 'wheel') {
    state.wheelShift += dy;
    state.wheelVel = clamp(state.wheelVel * 0.7 + (dy / dt) * 0.3, -1.2, 1.2);
    wheelEl.style.setProperty('--shift', state.wheelShift.toFixed(1) + 'px');
    g.tickAcc += Math.abs(dy);
    if (g.tickAcc > 15) {
      g.tickAcc = 0;
      Sound.tick();
      buzz(4);
    }
    g.wheelDist += Math.abs(dy);
    const speed = Math.abs(dy) / dt;
    if (!g.struck && g.wheelDist > 18 && speed > 0.55) {
      g.struck = true;
      strike(speed);
    }
  } else if (g.zone === 'lid' && g.moved) {
    /* the lid tracks the finger around the hinge, in real time */
    const h = hingePoint();
    const phi = Math.atan2(e.clientY - h.y, e.clientX - h.x) * 180 / Math.PI;
    if (!state.lid.dragging) {
      state.lid.dragging = true;
      g.lidPhi0 = phi;
      g.lidAngle0 = state.lid.angle;
      g.lidVel = 0;
    }
    let dphi = phi - g.lidPhi0;
    while (dphi > 180) dphi -= 360;
    while (dphi < -180) dphi += 360;
    let a = g.lidAngle0 + dphi;
    /* rubbery resistance past the stops */
    if (a < 0) a = a * 0.25;
    if (a > LID_OPEN) a = LID_OPEN + (a - LID_OPEN) * 0.25;
    const da = a - state.lid.angle;
    g.lidVel = clamp(g.lidVel * 0.65 + (da / dt) * 0.35, -3, 3);
    state.lid.angle = a;
    /* hinge friction on a slow drag */
    g.creakAcc += Math.abs(da);
    if (g.creakAcc > 7 && now - g.lastCreak > 70 && Math.abs(g.lidVel) < 0.5) {
      g.creakAcc = 0;
      g.lastCreak = now;
      Sound.creak(clamp(Math.abs(g.lidVel) * 2, 0, 1));
    }
  } else if (state.lit) {
    /* moving air: the flame is windproof, so it gutters and fights first */
    const f = flameAnchor();
    const mx = (e.clientX + g.x) / 2;
    const my = (e.clientY + g.y) / 2;
    const d = Math.hypot(mx - f.x, my - f.y);
    const speed = Math.hypot(dx, dy) / dt;
    const fall = Math.max(0, 1 - d / 130);
    if (fall > 0 && speed > 0.45) {
      state.flame.wind = clamp(state.flame.wind + (dx / dt) * 2.5 * fall, -90, 90);
      state.flame.stress += speed * fall * 0.28;
      if (state.flame.stress > 3.4) extinguish('blow');
    }
  }

  g.x = e.clientX;
  g.y = e.clientY;
  g.t = now;
});

function endGesture(e) {
  if (!g || e.pointerId !== g.id) return;
  const dy = g.y - g.y0;
  const dx = g.x - g.x0;
  const dur = Math.max(1, g.t - g.t0);

  if (state.lid.dragging) {
    state.lid.dragging = false;
    state.lid.vel = g.lidVel;
    if (state.lid.angle > LID_SNAP) requestTiltPermission();
  } else if (!g.moved) {
    if (g.zone === 'lid' || (g.zone === 'body' && state.lid.angle < 5)) {
      if (state.lid.angle < 5) {
        flickOpen(1);
        requestTiltPermission();
      } else if (state.lid.angle > LID_OPEN - 5) {
        flickClosed(1);
      }
    } else if (g.zone === 'wheel' && !g.struck) {
      Sound.tick();
    }
  } else if (g.zone === 'wheel') {
    /* a hard flick keeps sparking as the wheel spins free */
    if (!g.struck && Math.abs(state.wheelVel) > 0.5) {
      g.struck = true;
      strike(Math.abs(state.wheelVel));
    }
  } else {
    const speed = Math.abs(dy) / dur;
    if (dy < -40 && Math.abs(dy) > Math.abs(dx)) {
      flickOpen(clamp(speed * 1.3, 0.4, 2));
      requestTiltPermission();
    } else if (dy > 40 && Math.abs(dy) > Math.abs(dx)) {
      flickClosed(clamp(speed * 1.3, 0.4, 2));
    }
  }
  g = null;
}
scene.addEventListener('pointerup', endGesture);
scene.addEventListener('pointercancel', () => {
  if (g && state.lid.dragging) {
    state.lid.dragging = false;
    state.lid.vel = 0;
  }
  g = null;
});
scene.addEventListener('contextmenu', (e) => e.preventDefault());

/* -------------------------------------------------------------- physics */

/* cheap 1-D noise: a few detuned sines */
function n1(t) {
  return Math.sin(t * 1.3) * 0.55 + Math.sin(t * 2.9 + 1.7) * 0.3 + Math.sin(t * 6.1 + 4.2) * 0.15;
}

function updateLid(dt) {
  const L = state.lid;
  if (L.dragging) {
    if (state.lit && L.angle < 35) extinguish('snuff');
    return;
  }
  if (L.vel === 0 && (L.angle <= 0 || L.angle >= LID_OPEN)) return;

  if (L.angle > 0 && L.angle < LID_OPEN) {
    const dir = L.angle < LID_SNAP ? -1 : 1;
    L.vel += dir * LID_TORQUE * dt;
    L.vel -= L.vel * LID_DAMP * dt;
  }
  L.angle += L.vel * dt;

  if (state.lit && L.angle < 35 && L.vel < 0) extinguish('snuff');

  if (L.angle <= 0) {
    L.angle = 0;
    if (L.vel < -0.05) {
      lidImpact(false, -L.vel);
      L.vel *= -0.14;
      if (Math.abs(L.vel) < 0.08) L.vel = 0;
    } else {
      L.vel = 0;
    }
  } else if (L.angle >= LID_OPEN) {
    L.angle = LID_OPEN;
    if (L.vel > 0.05) {
      lidImpact(true, L.vel);
      L.vel *= -0.12;
      if (Math.abs(L.vel) < 0.08) L.vel = 0;
    } else {
      L.vel = 0;
    }
  }
}

/* the whole lighter rocks a touch when the lid slams */
function updateRock(dt) {
  const r = state.rock;
  if (Math.abs(r.a) < 0.001 && Math.abs(r.v) < 0.0001) {
    r.a = 0;
    r.v = 0;
    return;
  }
  r.v += (-0.0003 * r.a - 0.01 * r.v) * dt;
  r.a = clamp(r.a + r.v * dt, -3.5, 3.5);
}

function updateFlame(dt) {
  const f = state.flame;
  f.wind *= Math.pow(0.995, dt);
  f.stress *= Math.pow(0.996, dt);
  f.lick = Math.max(0, f.lick - dt * 0.0015);
  if (state.lit && Math.random() < dt * 0.0004) f.lick = 1;

  /* wind makes it gutter before it ever goes out */
  const target = state.lit ? 1 - Math.min(0.45, f.stress * 0.12) : 0;
  const rate = state.lit ? 0.006 : 0.012;
  f.v += (target - f.v) * Math.min(1, rate * dt);

  const bt = clamp(-state.tilt * 0.9 + clamp(f.wind * 0.02, -1.2, 1.2), -1.5, 1.5);
  f.bendV += ((bt - f.bend) * 0.004 - f.bendV * 0.02) * dt;
  f.bend = clamp(f.bend + f.bendV * dt, -1.6, 1.6);
}

function updateWheelSpin(dt, t) {
  if (g && g.zone === 'wheel') return;
  if (Math.abs(state.wheelVel) < 0.02) {
    state.wheelVel = 0;
    return;
  }
  const d = state.wheelVel * dt;
  state.wheelShift += d;
  wheelEl.style.setProperty('--shift', state.wheelShift.toFixed(1) + 'px');
  state.wheelVel *= Math.pow(0.992, dt);
  spinAcc += Math.abs(d);
  if (spinAcc > 18 && t - lastSpinTick > 45) {
    spinAcc = 0;
    lastSpinTick = t;
    Sound.tick();
  }
}

function spawnSparks(from, toward, speed) {
  sparks.push({ flash: true, x: from.x, y: from.y, life: 0, ttl: 90 });
  const n = 6 + Math.floor(Math.min(14, speed * 8));
  const ang0 = Math.atan2(toward.y - 26 - from.y, toward.x - from.x);
  for (let i = 0; i < n; i++) {
    const ang = ang0 + (Math.random() - 0.5) * 1.1;
    const v = (0.12 + Math.random() * 0.3) * Math.min(2.4, 0.8 + speed);
    sparks.push({
      x: from.x, y: from.y,
      vx: Math.cos(ang) * v,
      vy: Math.sin(ang) * v - 0.05,
      life: 0,
      ttl: 140 + Math.random() * 260,
    });
  }
}

function spawnSmoke(x, y, n, dim, vxBias = 0) {
  for (let i = 0; i < n; i++) {
    smoke.push({
      x: x + (Math.random() - 0.5) * 6,
      y: y + (Math.random() - 0.5) * 4,
      vx: (Math.random() - 0.5) * 0.02 + vxBias,
      vy: -(0.02 + Math.random() * 0.05) * (dim < 1 ? 0.7 : 1),
      r: (3 + Math.random() * 5) * (dim < 1 ? 0.7 : 1),
      life: 0,
      ttl: 1200 + Math.random() * 1400,
      ph: Math.random() * 6.28,
      dim,
    });
  }
}

/* ------------------------------------------------------------ rendering */

function updateDrawSparks(dt) {
  if (!sparks.length) return;
  ctx2d.save();
  ctx2d.globalCompositeOperation = 'lighter';
  ctx2d.lineCap = 'round';
  ctx2d.lineWidth = 1.6;
  sparks = sparks.filter((s) => {
    s.life += dt;
    if (s.life > s.ttl) return false;
    const pf = s.life / s.ttl;
    if (s.flash) {
      const r = 8 + 26 * pf;
      const fg = ctx2d.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      fg.addColorStop(0, `rgba(255,230,170,${(1 - pf) * 0.55})`);
      fg.addColorStop(1, 'rgba(255,150,40,0)');
      ctx2d.fillStyle = fg;
      ctx2d.beginPath();
      ctx2d.arc(s.x, s.y, r, 0, 7);
      ctx2d.fill();
      return true;
    }
    s.vy += 0.0016 * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    ctx2d.strokeStyle = `rgba(255,${Math.round(200 - 130 * pf)},${Math.round(90 - 80 * pf)},${(1 - pf) * 0.9})`;
    ctx2d.beginPath();
    ctx2d.moveTo(s.x, s.y);
    ctx2d.lineTo(s.x - s.vx * 16, s.y - s.vy * 16);
    ctx2d.stroke();
    return true;
  });
  ctx2d.restore();
}

function updateDrawEmbers(dt) {
  if (!embers.length) return;
  ctx2d.save();
  ctx2d.globalCompositeOperation = 'lighter';
  embers = embers.filter((e) => {
    e.life += dt;
    if (e.life > e.ttl) return false;
    const p = e.life / e.ttl;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    const r = Math.max(0.5, e.r * (1 - p * 0.6));
    const gr = ctx2d.createRadialGradient(e.x, e.y, 0, e.x, e.y, r * 2.2);
    gr.addColorStop(0, `rgba(255,225,140,${(1 - p) * 0.8})`);
    gr.addColorStop(0.5, `rgba(255,140,30,${(1 - p) * 0.4})`);
    gr.addColorStop(1, 'rgba(255,120,20,0)');
    ctx2d.fillStyle = gr;
    ctx2d.beginPath();
    ctx2d.arc(e.x, e.y, r * 2.2, 0, 7);
    ctx2d.fill();
    return true;
  });
  ctx2d.restore();
}

function updateDrawSmoke(dt, t) {
  if (!smoke.length) return;
  smoke = smoke.filter((s) => {
    s.life += dt;
    if (s.life > s.ttl) return false;
    const p = s.life / s.ttl;
    s.x += (s.vx + Math.sin(t * 0.0022 + s.ph) * 0.012) * dt;
    s.y += s.vy * dt;
    const r = s.r + p * 26 * (s.dim < 1 ? 0.6 : 1);
    const a = Math.sin(Math.PI * Math.min(1, p)) * 0.16 * s.dim;
    ctx2d.fillStyle = `rgba(185,190,200,${a})`;
    ctx2d.beginPath();
    ctx2d.arc(s.x, s.y, r, 0, 7);
    ctx2d.fill();
    return true;
  });
}

/* the dying-out glow on the wick just after the flame goes */
function drawWickEmber(t) {
  const em = state.ember;
  if (!em) return;
  const age = t - em.t0;
  if (age > 1500) {
    state.ember = null;
    return;
  }
  if (openS() < 0.45) return; // hidden under the lid
  const a = Math.pow(1 - age / 1500, 1.5) * (0.55 + 0.15 * n1(t * 0.02));
  ctx2d.save();
  ctx2d.globalCompositeOperation = 'lighter';
  const gr = ctx2d.createRadialGradient(em.x, em.y, 0, em.x, em.y, 7);
  gr.addColorStop(0, `rgba(255,120,30,${a})`);
  gr.addColorStop(0.4, `rgba(230,70,15,${a * 0.5})`);
  gr.addColorStop(1, 'rgba(200,60,10,0)');
  ctx2d.fillStyle = gr;
  ctx2d.beginPath();
  ctx2d.arc(em.x, em.y, 7, 0, 7);
  ctx2d.fill();
  ctx2d.restore();
}

function paintFlame(a, v, t, bend, hgt, wdt) {
  ctx2d.globalCompositeOperation = 'lighter';

  /* bloom */
  const gy = a.y - hgt * 0.45;
  const gr = ctx2d.createRadialGradient(a.x, gy, 0, a.x, gy, Math.max(1, hgt * 2.2));
  gr.addColorStop(0, `rgba(255,150,40,${0.26 * v})`);
  gr.addColorStop(1, 'rgba(255,150,40,0)');
  ctx2d.fillStyle = gr;
  ctx2d.beginPath();
  ctx2d.arc(a.x, gy, Math.max(1, hgt * 2.2), 0, 7);
  ctx2d.fill();

  /* teardrop body: nested layers, each shaded base-to-tip so edges melt together */
  const layers = [
    { s: 1.0, rgb: '255,100,5', a0: 0.1, a1: 0.5, halo: true },
    { s: 0.78, rgb: '255,160,25', a0: 0.2, a1: 0.7, halo: false },
    { s: 0.55, rgb: '255,210,80', a0: 0.35, a1: 0.85, halo: false },
    { s: 0.34, rgb: '255,248,215', a0: 0.5, a1: 0.95, halo: false },
  ];
  for (const L of layers) {
    const h = hgt * L.s;
    const w = wdt * L.s;
    const tx = a.x + bend * h * 0.5 + n1(t * 0.01 + L.s * 13) * w * 0.12;
    const grad = ctx2d.createLinearGradient(a.x, a.y, tx, a.y - h);
    grad.addColorStop(0, `rgba(${L.rgb},${L.a0 * v})`);
    grad.addColorStop(0.4, `rgba(${L.rgb},${L.a1 * v})`);
    grad.addColorStop(0.85, `rgba(${L.rgb},${L.a1 * 0.6 * v})`);
    grad.addColorStop(1, `rgba(${L.rgb},0)`);
    ctx2d.save();
    if (L.halo) {
      ctx2d.shadowColor = `rgba(255,110,10,${0.55 * v})`;
      ctx2d.shadowBlur = w * 0.5;
    }
    ctx2d.beginPath();
    ctx2d.moveTo(a.x - w / 2, a.y);
    ctx2d.bezierCurveTo(a.x - w * 0.62, a.y - h * 0.35, tx - w * 0.28, a.y - h * 0.78, tx, a.y - h);
    ctx2d.bezierCurveTo(tx + w * 0.28, a.y - h * 0.78, a.x + w * 0.62, a.y - h * 0.35, a.x + w / 2, a.y);
    ctx2d.closePath();
    ctx2d.fillStyle = grad;
    ctx2d.fill();
    ctx2d.restore();
  }

  /* blue root */
  const bg = ctx2d.createRadialGradient(a.x, a.y - wdt * 0.08, 0, a.x, a.y - wdt * 0.08, wdt * 0.55);
  bg.addColorStop(0, `rgba(140,170,255,${0.4 * v})`);
  bg.addColorStop(0.6, `rgba(80,120,255,${0.25 * v})`);
  bg.addColorStop(1, 'rgba(80,120,255,0)');
  ctx2d.fillStyle = bg;
  ctx2d.beginPath();
  ctx2d.ellipse(a.x, a.y - wdt * 0.08, wdt * 0.5, wdt * 0.58, 0, 0, 7);
  ctx2d.fill();
}

function drawFlame(t, dt) {
  const f = state.flame;
  if (f.v < 0.02) return 0;
  const a = flameAnchor();
  const lighterRect = lighterEl.getBoundingClientRect();
  const base = Math.max(10, lighterRect.width * 0.095);
  const age = t - f.born;
  const flare = state.lit && age < 450 ? 1 + 0.5 * Math.exp(-age / 180) : 1;
  const turb = 1 + f.stress * 0.4;
  const flick = 1 + (0.1 * n1(t * 0.006) + 0.05 * n1(t * 0.023 + 9)) * turb;
  const v = Math.min(1.3, f.v * flare);
  const hgt = base * 3.3 * v * flick * (1 + 0.25 * f.lick);
  const wdt = base * (0.9 + 0.2 * n1(t * 0.004 + 3)) * Math.min(1, v * 1.5);
  const bend = f.bend + 0.16 * turb * n1(t * 0.0035 + 7);

  /* life at the tip: the odd ember drifting up, smoke when the flame is torn */
  const tip = { x: a.x + bend * hgt * 0.5, y: a.y - hgt };
  if (state.lit && Math.random() < dt * 0.0008 * v) {
    embers.push({
      x: tip.x, y: tip.y + 6,
      vx: (Math.random() - 0.5) * 0.02,
      vy: -(0.05 + Math.random() * 0.05),
      r: wdt * (0.1 + Math.random() * 0.08),
      life: 0,
      ttl: 280 + Math.random() * 260,
    });
  }
  if (state.lit && (Math.abs(f.bend) > 1.0 || f.stress > 1.4) && Math.random() < dt * 0.004) {
    spawnSmoke(tip.x, tip.y, 1, 0.5);
  }

  ctx2d.save();
  paintFlame(a, v, t, bend, hgt, wdt);
  ctx2d.restore();

  /* faint mirrored glimmer on the floor beneath the lighter */
  const floorY = lighterRect.bottom + 4;
  ctx2d.save();
  ctx2d.globalAlpha = 0.13;
  ctx2d.translate(0, floorY);
  ctx2d.scale(1, -0.7);
  ctx2d.translate(0, -floorY);
  paintFlame(a, v, t, -bend, hgt, wdt);
  ctx2d.restore();

  return v * flick;
}

let last = performance.now();
let spinAcc = 0;
let lastSpinTick = 0;

function frame(t) {
  const dt = Math.min(50, t - last);
  last = t;

  updateLid(dt);
  updateRock(dt);
  updateFlame(dt);
  updateWheelSpin(dt, t);

  lidEl.style.transform = `rotate(${state.lid.angle.toFixed(2)}deg)`;
  const root = document.documentElement.style;
  root.setProperty('--open-s', openS().toFixed(3));
  root.setProperty('--rock', state.rock.a.toFixed(2) + 'deg');

  ctx2d.clearRect(0, 0, W, H);
  updateDrawSparks(dt);
  const gi = drawFlame(t, dt);
  updateDrawEmbers(dt);
  drawWickEmber(t);
  updateDrawSmoke(dt, t);

  root.setProperty('--gi', (clamp(gi, 0, 1) * 0.9).toFixed(3));
  if (gi > 0) {
    const a = flameAnchor();
    root.setProperty('--gx', a.x.toFixed(0) + 'px');
    root.setProperty('--gy', a.y.toFixed(0) + 'px');
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

setHint(0);

/* handle for debugging / automated checks */
window.__lighter = { flickOpen, flickClosed, ignite, extinguish, strike, state };

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
