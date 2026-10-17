// Public, licensed product samples only; no user images or external AI calls.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {start}=require('./isolated-browser-support.cjs');
(async()=>{
 const folder=path.resolve('test-results/welcome-collection/photographic');await fs.mkdir(folder,{recursive:true});const server=await start(),browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],switches=[];page.on('pageerror',e=>errors.push(e.message));
 const ready=()=>page.waitForFunction(()=>document.querySelector('#mainCanvas')?.dataset.previewStatus==='ready',null,{timeout:60000});
 try{
  await page.goto(server.url);await page.locator('.hero-edited').waitFor({state:'visible'});
  const root=path.resolve('风景调色协作平台/frontend/assets/welcome'),names=['alpine-lake.jpg','mountain-light.jpg','coastal-sunset.jpg'];await page.locator('#image-input').setInputFiles(names.map(n=>path.join(root,n)));await ready();await page.locator('#composition-group>summary').click();
  for(const name of [...names.slice(1),names[0]]){const start=performance.now();await page.getByRole('tab',{name:'切换到 '+name,exact:true}).click();await page.getByText(name,{exact:true}).first().waitFor();await ready();switches.push({photo:name,elapsedMs:Math.round(performance.now()-start)});await page.getByRole('button',{name:'相框预览',exact:true}).click();await page.getByRole('button',{name:'暖木纹框',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.frame-dialog .primary').disabled);await page.screenshot({path:path.join(folder,name+'.png')});await page.getByRole('button',{name:'返回编辑',exact:true}).click();}
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'相框预览',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.frame-dialog .primary').disabled);await page.screenshot({path:path.join(folder,'frame-mobile.png')});await page.getByRole('button',{name:'返回编辑',exact:true}).click();await page.screenshot({path:path.join(folder,'strip-mobile.png')});assert.deepEqual(errors,[]);await fs.writeFile(path.join(folder,'report.json'),JSON.stringify({switches,errors,note:'Three public sample photos, one local Chromium run; includes automation overhead and is not a memory or P95 measurement.'},null,2));console.log(JSON.stringify({switches,errors},null,2));
 }finally{await browser.close();await server.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
