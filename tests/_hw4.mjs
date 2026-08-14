import { chromium } from 'playwright';
const browser = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
const S=['flame out, lid open — pull the insert up by the chimney','fold the wick low, then light it and swipe','swipe across the flame now — it hides as an ember','service it: pull the insert up by the chimney','tilt, jolt or shake the phone — the flame feels it'];
for (const [n,w,h] of [['se',320,568],['ip',390,844]]) {
  const p = await browser.newPage({viewport:{width:w,height:h},deviceScaleFactor:2,hasTouch:true});
  await p.goto('http://localhost:8741/index.html');
  await p.waitForFunction(()=>window.__booted,null,{timeout:60000});
  const r = await p.evaluate(list=>{const el=document.getElementById('hint');el.classList.remove('wrap');el.classList.add('show');return list.map(s=>{el.textContent=s;return {s,sw:el.scrollWidth,cw:el.clientWidth};});},S);
  console.log('==='+n+' '+w);
  for(const x of r) console.log((x.sw>x.cw+1?'CLIPPED ':'   ok   ')+x.sw+'/'+x.cw+'  '+x.s);
  await p.close();
}
await browser.close();
