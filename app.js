'use strict';

const $ = (s) => document.querySelector(s);
const scene = $('#scene');
const lighterEl = $('#lighter');
const lidEl = $('#lid');
const wheelEl = $('#wheel');
const wickEl = $('#wick');
const hintEl = $('#hint');
const canvas = $('#fx');
const ctx2d = canvas.getContext('2d');

const state = {
  open: false,
  lit: false,
  flame: { v: 0, bend: 0, bendV: 0, wind: 0, born: 0 },
  tilt: 0,
  failedStrikes: 0,
  wheelShift: 0,
};

let sparks = [];
let smoke = [];
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
    /* the bright "cling" of the lid flipping open */
    open() {
      if (!ready()) return;
      burst({ dur: 0.02, type: 'highpass', freq: 2500, gain: 0.3 });
      ping(2280, 0.16, 0.16);
      ping(3390, 0.12, 0.1);
      ping(5490, 0.07, 0.05);
      ping(920, 0.04, 0.08);
    },
    /* the duller "clunk" of it snapping shut */
    close() {
      if (!ready()) return;
      burst({ dur: 0.045, type: 'lowpass', freq: 750, gain: 0.55 });
      ping(1180, 0.08, 0.14);
      ping(1770, 0.05, 0.07);
      ping(150, 0.07, 0.25);
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

function inflate(r, m) {
  return { left: r.left - m, right: r.right + m, top: r.top - m, bottom: r.bottom + m };
}

function within(x, y, r) {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function zoneAt(x, y) {
  if (state.open && within(x, y, inflate(wheelEl.getBoundingClientRect(), 18))) return 'wheel';
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
  state.tilt = Math.max(-1, Math.min(1, e.gamma / 45));
});

/* -------------------------------------------------------------- actions */

function openLid() {
  if (state.open) return;
  state.open = true;
  lighterEl.classList.add('open');
  Sound.open();
  buzz(12);
  setHint(1);
  requestTiltPermission();
}

function closeLid() {
  if (!state.open) return;
  state.open = false;
  lighterEl.classList.remove('open');
  Sound.close();
  buzz(16);
  if (state.lit) extinguish('snuff');
  else setHint(0);
}

function ignite() {
  if (state.lit || !state.open) return;
  state.lit = true;
  state.failedStrikes = 0;
  state.flame.born = performance.now();
  Sound.whoof();
  Sound.flameOn();
  buzz([8, 30, 12]);
  setHint(2);
  acquireWakeLock();
}

function extinguish(reason) {
  if (!state.lit) return;
  state.lit = false;
  if (reason === 'blow') state.flame.v = Math.min(state.flame.v, 0.15);
  spawnSmoke(flameAnchor(), reason === 'blow' ? 1.4 : 1);
  Sound.flameOff();
  if (reason === 'blow') Sound.puff();
  releaseWakeLock();
}

function strike(speed) {
  spawnSparks(wheelAnchor(), flameAnchor(), speed);
  Sound.scratch(Math.min(1, speed / 2.2));
  buzz(9);
  if (state.open && !state.lit) {
    const p = Math.min(0.92, 0.3 + speed * 0.28);
    const willLight = state.failedStrikes >= 2 || Math.random() < p;
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
    moved: false, struck: false, wheelDist: 0, tickAcc: 0,
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
  } else if (state.lit) {
    /* a fast swipe near the flame is a gust of wind */
    const f = flameAnchor();
    const mx = (e.clientX + g.x) / 2;
    const my = (e.clientY + g.y) / 2;
    const d = Math.hypot(mx - f.x, my - f.y);
    const speed = Math.hypot(dx, dy) / dt;
    if (d < 110 && speed > 0.5) {
      state.flame.wind = Math.max(-60, Math.min(60, state.flame.wind + (dx / dt) * 3));
      if (speed > 1.5 && d < 80) extinguish('blow');
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
  if (!g.moved) {
    if (g.zone === 'lid' || (!state.open && g.zone === 'body')) {
      state.open ? closeLid() : openLid();
    } else if (g.zone === 'wheel' && !g.struck) {
      Sound.tick();
    }
  } else if (g.zone !== 'wheel') {
    if (dy < -40 && Math.abs(dy) > Math.abs(dx)) openLid();
    else if (dy > 40 && Math.abs(dy) > Math.abs(dx)) closeLid();
  }
  g = null;
}
scene.addEventListener('pointerup', endGesture);
scene.addEventListener('pointercancel', () => { g = null; });
scene.addEventListener('contextmenu', (e) => e.preventDefault());

/* -------------------------------------------------------------- physics */

/* cheap 1-D noise: a few detuned sines */
function n1(t) {
  return Math.sin(t * 1.3) * 0.55 + Math.sin(t * 2.9 + 1.7) * 0.3 + Math.sin(t * 6.1 + 4.2) * 0.15;
}

function updateFlame(dt) {
  const f = state.flame;
  const target = state.lit ? 1 : 0;
  const rate = state.lit ? 0.006 : 0.012;
  f.v += (target - f.v) * Math.min(1, rate * dt);
  f.wind *= Math.pow(0.995, dt);
  const bt = Math.max(-1.4, Math.min(1.4, -state.tilt * 0.9 + Math.max(-1.2, Math.min(1.2, f.wind * 0.02))));
  f.bendV += ((bt - f.bend) * 0.004 - f.bendV * 0.02) * dt;
  f.bend = Math.max(-1.6, Math.min(1.6, f.bend + f.bendV * dt));
}

function spawnSparks(from, toward, speed) {
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

function spawnSmoke(at, k) {
  const n = Math.round(10 * k);
  for (let i = 0; i < n; i++) {
    smoke.push({
      x: at.x + (Math.random() - 0.5) * 6,
      y: at.y + (Math.random() - 0.5) * 4,
      vx: (Math.random() - 0.5) * 0.02,
      vy: -(0.02 + Math.random() * 0.05),
      r: 3 + Math.random() * 5,
      life: 0,
      ttl: 1200 + Math.random() * 1400,
      ph: Math.random() * 6.28,
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
    s.vy += 0.0016 * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    const p = s.life / s.ttl;
    ctx2d.strokeStyle = `rgba(255,${Math.round(200 - 130 * p)},${Math.round(90 - 80 * p)},${(1 - p) * 0.9})`;
    ctx2d.beginPath();
    ctx2d.moveTo(s.x, s.y);
    ctx2d.lineTo(s.x - s.vx * 16, s.y - s.vy * 16);
    ctx2d.stroke();
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
    const r = s.r + p * 26;
    const a = Math.sin(Math.PI * Math.min(1, p)) * 0.16;
    ctx2d.fillStyle = `rgba(185,190,200,${a})`;
    ctx2d.beginPath();
    ctx2d.arc(s.x, s.y, r, 0, 7);
    ctx2d.fill();
    return true;
  });
}

function drawFlame(t) {
  const f = state.flame;
  if (f.v < 0.02) return 0;
  const a = flameAnchor();
  const base = Math.max(10, lighterEl.getBoundingClientRect().width * 0.085);
  const age = t - f.born;
  const flare = state.lit && age < 450 ? 1 + 0.5 * Math.exp(-age / 180) : 1;
  const flick = 1 + 0.1 * n1(t * 0.006) + 0.05 * n1(t * 0.023 + 9);
  const v = Math.min(1.3, f.v * flare);
  const hgt = base * 3.1 * v * flick;
  const wdt = base * (0.9 + 0.2 * n1(t * 0.004 + 3)) * Math.min(1, v * 1.5);
  const bend = f.bend + 0.16 * n1(t * 0.0035 + 7);

  ctx2d.save();
  ctx2d.globalCompositeOperation = 'lighter';

  /* bloom */
  const gy = a.y - hgt * 0.45;
  const gr = ctx2d.createRadialGradient(a.x, gy, 0, a.x, gy, Math.max(1, hgt * 2.2));
  gr.addColorStop(0, `rgba(255,150,40,${0.28 * v})`);
  gr.addColorStop(1, 'rgba(255,150,40,0)');
  ctx2d.fillStyle = gr;
  ctx2d.beginPath();
  ctx2d.arc(a.x, gy, Math.max(1, hgt * 2.2), 0, 7);
  ctx2d.fill();

  /* teardrop body, three nested layers */
  const layers = [
    { s: 1.0, c: `rgba(255,110,10,${0.5 * v})` },
    { s: 0.7, c: `rgba(255,190,50,${0.75 * v})` },
    { s: 0.42, c: `rgba(255,245,205,${0.9 * v})` },
  ];
  for (const L of layers) {
    const h = hgt * L.s;
    const w = wdt * L.s;
    const tx = a.x + bend * h * 0.5 + n1(t * 0.01 + L.s * 13) * w * 0.12;
    ctx2d.beginPath();
    ctx2d.moveTo(a.x - w / 2, a.y);
    ctx2d.bezierCurveTo(a.x - w * 0.62, a.y - h * 0.35, tx - w * 0.28, a.y - h * 0.78, tx, a.y - h);
    ctx2d.bezierCurveTo(tx + w * 0.28, a.y - h * 0.78, a.x + w * 0.62, a.y - h * 0.35, a.x + w / 2, a.y);
    ctx2d.closePath();
    ctx2d.fillStyle = L.c;
    ctx2d.fill();
  }

  /* blue root */
  ctx2d.fillStyle = `rgba(90,130,255,${0.3 * v})`;
  ctx2d.beginPath();
  ctx2d.ellipse(a.x, a.y - wdt * 0.1, wdt * 0.42, wdt * 0.5, 0, 0, 7);
  ctx2d.fill();

  ctx2d.restore();
  return v * flick;
}

let last = performance.now();
function frame(t) {
  const dt = Math.min(50, t - last);
  last = t;
  updateFlame(dt);
  ctx2d.clearRect(0, 0, W, H);
  updateDrawSparks(dt);
  const gi = drawFlame(t);
  updateDrawSmoke(dt, t);
  const root = document.documentElement.style;
  root.setProperty('--gi', (Math.max(0, Math.min(1, gi)) * 0.9).toFixed(3));
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
window.__lighter = { openLid, closeLid, ignite, extinguish, strike, state };

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
