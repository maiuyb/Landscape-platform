const {reveal}=require('./workspace-support.cjs');
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const baseURL = process.env.HMI_TEST_URL || 'http://127.0.0.1:5050';
const phase = process.env.HMI_PERF_PHASE || 'current';
const results = path.resolve(__dirname, '../test-results/interaction');
(async () => {
  await fs.mkdir(results,{recursive:true});
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const session = await page.context().newCDPSession(page);
  try {
    await page.goto(baseURL);
    await page.locator('#image-input').setInputFiles(path.resolve(__dirname,process.env.HMI_PERF_E3==='1'?'../test-results/e3/native/night.jpg':'../test-results/e1/photos/night.jpg'));
    await page.getByRole('status').filter({hasText:'已载入'}).waitFor();
    await page.evaluate(async () => {
      for(const [key,value] of Object.entries({whites:20,blacks:10,highlights:-20,shadows:20,temperature:10,tint:3,saturation:20,vibrance:60})) {
        const input=document.querySelector('#'+key);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
      }
      await new Promise(resolve=>setTimeout(resolve,500));
    });
    if(process.env.HMI_PERF_E2==='1'){
      const recipe={version:3,steps:[{type:'hsl',params:{band:'blue',hue:20,saturation:-15,luminance:10}},{type:'curve',params:{channel:'master',points:[[0,0],[.25,.18],[.7,.78],[1,1]]}},{type:'white-balance',params:{gains:[1.05,1,.95],mode:'custom'}}]};
      await page.getByLabel('导入配方',{exact:true}).setInputFiles({name:'e2-perf.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(recipe))});
      await page.getByRole('button',{name:'应用到照片',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('#mainCanvas').dataset.previewStatus==='ready');
      await page.locator('.parameter-panel').evaluate(panel=>{panel.scrollTop=0;});
    }
    if(process.env.HMI_PERF_E3==='1'){
      const recipe={version:4,steps:[{type:'detail',params:{sharpen:55,radius:1.5,protection:40,luminance:50,color:60}}]};
      await page.getByLabel('导入配方',{exact:true}).setInputFiles({name:'e3-perf.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(recipe))});
      await page.getByRole('button',{name:'应用到照片',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#mainCanvas').dataset.previewStatus==='ready');
      await page.getByRole('button',{name:'100% 细节查看',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#detailCanvas')?.dataset.previewStatus==='ready');
      await page.locator('.parameter-panel').evaluate(panel=>{panel.scrollTop=0;});
    }
    if(process.env.HMI_PERF_E4==='1'){
      const recipe=await page.evaluate(()=>{const s=EditorCore.createState();s.effects.clarity=40;s.effects.dehaze=30;s.effects.calibration.blue.hue=-25;s.effects.vignette.amount=-35;const m=EditorCore.masks.create('linear','test-gradient');m.start=[.5,.7];m.end=[.5,.1];m.adjustments.exposure=-.4;m.adjustments.clarity=20;m.adjustments.dehaze=15;s.masks=[m];return EditorCore.toRecipe(s);});
      // Import just the new tools so the existing E1/E2/E3 parameters remain enabled.
      recipe.steps=recipe.steps.filter(s=>['effects','masks'].includes(s.type));
      await page.getByLabel('导入配方',{exact:true}).setInputFiles({name:'e4-perf.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(recipe))});await page.getByRole('button',{name:'应用到照片',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#mainCanvas').dataset.previewStatus==='ready');await page.locator('.parameter-panel').evaluate(p=>p.scrollTop=0);
    }
    await reveal(page,'#whites');
    const dragKey=process.env.HMI_PERF_PRESETS==='1'?'preset-strength':'whites';
    if(dragKey==='preset-strength'){
      await page.getByRole('tab',{name:'预设',exact:true}).click();await page.getByRole('button',{name:'蓝调夜色',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('#mainCanvas').dataset.previewStatus==='ready');
      try{await page.waitForFunction(()=>[...document.querySelectorAll('.preset-card canvas')].filter(c=>!c.closest('details:not([open])')&&c.getClientRects().length).every(c=>c.dataset.thumbnailStatus==='ready'));}
      catch(error){console.log(await page.locator('.preset-card canvas').evaluateAll(items=>items.map(c=>({name:c.closest('button').getAttribute('aria-label'),status:c.dataset.thumbnailStatus,visible:!!c.getClientRects().length}))));throw error;}
    }
    await page.locator('#'+dragKey).scrollIntoViewIfNeeded();
    await session.send('Emulation.setCPUThrottlingRate',{rate:4});
    await page.evaluate(dragKey=>{
      window.dragMetrics={gaps:[],inputDelays:[],numberPaintDelays:[],longTasks:[]};
      const m=window.dragMetrics;let previous=performance.now();
      m.timer=setInterval(()=>{const now=performance.now();m.gaps.push(now-previous);previous=now;},16);
      m.observer=new PerformanceObserver(list=>m.longTasks.push(...list.getEntries().map(e=>e.duration)));m.observer.observe({type:'longtask',buffered:false});
      document.querySelector('#'+dragKey).addEventListener('input',event=>{
        const start=performance.now();m.inputDelays.push(start-event.timeStamp);
        requestAnimationFrame(()=>m.numberPaintDelays.push(performance.now()-start));
      });
    },dragKey);
    const box=await page.locator('#'+dragKey).boundingBox();
    await page.mouse.move(box.x+box.width*.6,box.y+box.height/2);await page.mouse.down();
    const start=Date.now();
    for(let i=0;i<40;i++) {
      await page.mouse.move(box.x+box.width*(.15+.7*(i%20)/19),box.y+box.height/2);
      await new Promise(resolve=>setTimeout(resolve,16));
    }
    await page.mouse.up();
    await page.waitForFunction(()=>!document.querySelector('#mainCanvas').dataset.previewStatus || document.querySelector('#mainCanvas').dataset.previewStatus==='ready');
    const metrics=await page.evaluate(dragKey=>{
      const m=window.dragMetrics;clearInterval(m.timer);m.observer.disconnect();
      const summary=values=>{const a=values.slice().sort((a,b)=>a-b);return {count:a.length,median:a[Math.floor(a.length*.5)]||0,p95:a[Math.floor(a.length*.95)]||0,max:a.at(-1)||0};};
      return {heartbeat:summary(m.gaps),inputDispatch:summary(m.inputDelays),inputToAnimationFrame:summary(m.numberPaintDelays),longTasks:summary(m.longTasks),value:document.querySelector('#'+dragKey).value,quality:document.querySelector('#mainCanvas').dataset.previewQuality||'sync',renderMode:document.querySelector('#mainCanvas').dataset.previewMode||'sync'};
    },dragKey);
    metrics.control=dragKey;metrics.phase=phase;metrics.e2Enabled=process.env.HMI_PERF_E2==='1';metrics.e3Enabled=process.env.HMI_PERF_E3==='1';metrics.e4Enabled=process.env.HMI_PERF_E4==='1';metrics.totalGestureMs=Date.now()-start;metrics.cpuSlowdown=4;metrics.browser=browser.version();
    assert.ok(metrics.inputDispatch.count>=30,`only ${metrics.inputDispatch.count} actual slider inputs recorded`);
    if(metrics.renderMode==='worker') assert.equal(metrics.quality,'1200');
    await fs.writeFile(path.join(results,`${phase}.json`),JSON.stringify(metrics,null,2));console.log(JSON.stringify(metrics,null,2));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
