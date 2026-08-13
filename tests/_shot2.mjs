import { chromium } from 'playwright';
const browser = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
const page = await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:4,hasTouch:true});
page.on('pageerror',e=>console.log('PAGEERR',e.message));
await page.goto('http://localhost:8741/index.html');
await page.waitForFunction(()=>window.__booted && window.LIGHTER && window.LIGHTER.frames>10,null,{timeout:60000});
const L = s => page.evaluate(s);
const dir='/tmp/claude-0/-home-user-LighterSim/cf51c021-eccd-5a3d-afe4-844decbebd1f/scratchpad/';
await L('LIGHTER.Actions.svcOut()');
await page.waitForTimeout(4500);
await L('LIGHTER.sim.svc.padT = 1');
await page.waitForTimeout(3000);
const a = await L('LIGHTER.anchor("svcPacking")');
console.log('anchor', JSON.stringify(a), 'pad', await L('LIGHTER.sim.svc.pad'));
await page.screenshot({path:dir+'c_zoom_open.png', clip:{x:a.x-70,y:a.y-40,width:140,height:80}});
// pad half open
await L('LIGHTER.sim.svc.padT = 0.5; LIGHTER.sim.svc.pad = 0.5');
await page.waitForTimeout(60);
await page.screenshot({path:dir+'d_zoom_half.png', clip:{x:a.x-70,y:a.y-40,width:140,height:80}});
// pad shut
await L('LIGHTER.sim.svc.padT = 0');
await page.waitForTimeout(2000);
await page.screenshot({path:dir+'e_zoom_shut.png', clip:{x:a.x-70,y:a.y-40,width:140,height:80}});
await browser.close();
