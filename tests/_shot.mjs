import { chromium } from 'playwright';
const browser = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
const page = await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true});
page.on('pageerror',e=>console.log('PAGEERR',e.message));
await page.goto('http://localhost:8741/index.html');
await page.waitForFunction(()=>window.__booted && window.LIGHTER && window.LIGHTER.frames>10,null,{timeout:60000});
const L = s => page.evaluate(s);
const dir='/tmp/claude-0/-home-user-LighterSim/cf51c021-eccd-5a3d-afe4-844decbebd1f/scratchpad/';
await L('LIGHTER.Actions.svcOut()');
await page.waitForTimeout(4500);
console.log('svc after out', JSON.stringify(await L('LIGHTER.sim.svc')));
await page.screenshot({path:dir+'a_padshut.png'});
await L('LIGHTER.sim.svc.padT = 1');
await page.waitForTimeout(4000);
console.log('svc padopen', JSON.stringify(await L('({pad:LIGHTER.sim.svc.pad, pose:LIGHTER.sim.svc.pose})')));
await page.screenshot({path:dir+'b_padopen.png'});
// where is the packing on screen?
console.log('anchor svcPacking', JSON.stringify(await L('LIGHTER.anchor("svcPacking")')));
await browser.close();
