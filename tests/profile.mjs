/* Where is the frame time going? Measures real frames-per-second by toggling one
   subsystem at a time, with the march step count PINNED so the adaptive loop
   cannot silently hide a cost by dropping samples. Run from tests/. */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 300, height: 620 }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:8741/index.html');
await page.waitForFunction('window.__booted', null, { timeout: 30000 });
const L = e => page.evaluate(e);

await L('(LIGHTER.CFG.FLINT_LIFE = 1e9, LIGHTER.CFG.FUEL_BURN_S = 1e9, LIGHTER.CFG.FPS_VOL_OFF = 0, 0)');
await L('(LIGHTER.CFG.FLAME_STEPS = 22, LIGHTER.CFG.FLAME_STEPS_MIN = 22, LIGHTER.openLid(), 0)');
await page.waitForFunction('LIGHTER.lidTheta > LIGHTER.CFG.LID_OPEN - 0.05', null, { timeout: 15000 });
await page.waitForFunction(() => {
  if (window.LIGHTER.state === 'LIT') return true;
  window.LIGHTER.strike(3);
  return false;
}, null, { timeout: 20000, polling: 400 });
await L('(LIGHTER.cam.yaw = 0.45, LIGHTER.cam.pitch = 0.35, LIGHTER.cam.yawVel = 0, LIGHTER.cam.pitchVel = 0, 0)');

async function ms(label, setup, restore) {
  if (setup) await L(setup);
  await page.waitForTimeout(1600);
  const a = await L('LIGHTER.frames'), t0 = Date.now();
  await page.waitForTimeout(5000);
  const fps = (await L('LIGHTER.frames') - a) / ((Date.now() - t0) / 1000);
  if (restore) await L(restore);
  const v = 1000 / fps;
  console.log(`${label.padEnd(30)} ${fps.toFixed(1).padStart(5)} fps   ${v.toFixed(1).padStart(6)} ms/frame`);
  return v;
}

const base = await ms('baseline (effect flame)', 'LIGHTER.setFlameCol("vortex")');
const plain = await ms('plain flame (no fx branch)', 'LIGHTER.setFlameCol("classic")');
const noVol = await ms('volume off (sprites)', '(LIGHTER.CFG.FLAME_VOL = false, 0)', '(LIGHTER.CFG.FLAME_VOL = true, 0)');
const noBloom = await ms('bloom off', '(LIGHTER.setBloom(false), 0)', '(LIGHTER.setBloom(true), 0)');
const noLights = await ms('key+fill lights off',
  '(LIGHTER.scene.children.filter(o=>o.isDirectionalLight).forEach(l=>l.intensity=0), 0)',
  `(LIGHTER.scene.children.filter(o=>o.isDirectionalLight).forEach((l,i)=>l.intensity=i?LIGHTER.CFG.FILL_LIGHT:LIGHTER.CFG.KEY_LIGHT), 0)`);

const noPre = await ms('occluder prepass off', '(LIGHTER.setPrepass(false), 0)', '(LIGHTER.setPrepass(true), 0)');

console.log('\n--- attributable cost, ms/frame ---');
console.log(`half-res occluder prepass    ${(plain - noPre).toFixed(1)}`);
console.log(`the raymarched volume        ${(plain - noVol).toFixed(1)}`);
console.log(`effect branches (vortex)     ${(base - plain).toFixed(1)}`);
console.log(`bloom pass                   ${(plain - noBloom).toFixed(1)}`);
console.log(`key + fill lights            ${(plain - noLights).toFixed(1)}`);
await browser.close();
