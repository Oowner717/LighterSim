import { chromium } from 'playwright';
const dir='/tmp/claude-0/-home-user-LighterSim/cf51c021-eccd-5a3d-afe4-844decbebd1f/scratchpad/';
const browser = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
const TEXTS=['all serviced — tap the case, or ✓ done, to slide it home','circle a finger on the screw (or tap it) to seat the spring back down'];
for (const [n,w,h] of [['se',320,568],['ip',390,844]]) {
  const p = await browser.newPage({viewport:{width:w,height:h},deviceScaleFactor:2,hasTouch:true});
  await p.goto('http://localhost:8741/index.html');
  await p.waitForFunction(()=>window.__booted && LIGHTER.frames>5,null,{timeout:60000});
  await p.evaluate(()=>{LIGHTER.openLid();});
  await p.waitForFunction(()=>LIGHTER.lidOpen(),null,{timeout:9000});
  await p.evaluate(()=>LIGHTER.svcOut());
  await p.waitForTimeout(1500);
  const r = await p.evaluate((texts)=>{
    document.getElementById('svcDone').style.bottom='calc(104px + env(safe-area-inset-bottom, 0px))';
    const el=document.getElementById('hint'), d=document.getElementById('svcDone');
    return texts.map(t=>{el.textContent=t;el.classList.add('wrap','show');
      const hr=el.getBoundingClientRect(),dr=d.getBoundingClientRect();
      return {lines:Math.round(hr.height/20),hintTop:Math.round(hr.top),doneBottom:Math.round(dr.bottom),doneTop:Math.round(dr.top),overlap:hr.top<dr.bottom};});
  },TEXTS);
  console.log('=== '+n+' '+w, JSON.stringify(r));
  await p.evaluate(()=>{const el=document.getElementById('hint');el.textContent='circle a finger on the screw (or tap it) to seat the spring back down';});
  await p.screenshot({path:dir+'svcfix_'+n+'.png'});
  await p.close();
}
await browser.close();
