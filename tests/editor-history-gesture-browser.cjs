/* Isolated storage and generated image; no cloud calls or user materials. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {start}=require('./isolated-browser-support.cjs');
(async()=>{
 const server=await start(),browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true}),errors=[],checks=[];
  page.on('pageerror',e=>errors.push(e.message));
  const btn=name=>page.getByRole('button',{name,exact:true}),tab=name=>page.getByRole('tab',{name,exact:true});
  const ready=async()=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.waitForFunction(()=>document.querySelector('#mainCanvas')?.dataset.previewStatus==='ready');};
  const pixels=async()=>require('node:crypto').createHash('sha256').update(await page.locator('#mainCanvas').evaluate(c=>c.toDataURL())).digest('hex');
  const reveal=async id=>{await page.locator('#'+id).evaluate(e=>{for(let p=e;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;});await page.locator('#'+id).scrollIntoViewIfNeeded();};
  const value=async(id,v)=>{await reveal(id);await page.locator('#'+id).evaluate((e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},v);await ready();};
  async function drag(id,from,to,early=false){
   await reveal(id);const slider=page.locator('#'+id),box=await slider.boundingBox(),limits=await slider.evaluate(e=>[Number(e.min),Number(e.max)]);
   const x=v=>box.x+8+(box.width-16)*(v-limits[0])/(limits[1]-limits[0]),y=box.y+box.height/2;
   await page.mouse.move(x(from),y);await page.mouse.down();await page.mouse.move(x((from+to)/2),y,{steps:6});
   if(early)await slider.evaluate(e=>{e.dispatchEvent(new Event('change',{bubbles:true}));e.dispatchEvent(new FocusEvent('blur'));e.dispatchEvent(new PointerEvent('lostpointercapture',{pointerId:1,buttons:1}));});
   await page.mouse.move(x(to),y,{steps:8});await page.mouse.up();await ready();return Number(await slider.inputValue());
  }
  await page.goto(server.url);
  const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=480;c.height=320;const x=c.getContext('2d'),g=x.createLinearGradient(0,0,480,320);g.addColorStop(0,'#205885');g.addColorStop(1,'#c7a944');x.fillStyle=g;x.fillRect(0,0,480,320);return c.toDataURL();});
  await page.locator('#image-input').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(data.split(',')[1],'base64')});await ready();
  const original=await pixels();
  for(const [id,from,to]of [['contrast',0,70],['exposure',0,.7],['sharpen',0,70],['effect-clarity',0,70]]){
   const final=await drag(id,from,to,true);assert.ok(Math.abs(final-to)<2);await btn('撤销').click();await ready();assert.equal(Number(await page.locator('#'+id).inputValue()),from,id+' must undo the whole gesture');await btn('重做').click();await ready();assert.equal(Number(await page.locator('#'+id).inputValue()),final);await btn('撤销').click();await ready();
  }
  checks.push('real pointer drags plus early change/blur/lost-capture notifications stay one undo step for light, exposure, detail and effects');
  const first=await drag('contrast',0,30),second=await drag('contrast',first,70);await btn('撤销').click();await ready();assert.equal(Number(await page.locator('#contrast').inputValue()),first);await btn('撤销').click();await ready();assert.equal(await page.locator('#contrast').inputValue(),'0');assert.ok(second>first);
  await page.locator('#contrast').focus();await page.keyboard.press('ArrowRight');await ready();assert.equal(await page.locator('#contrast').inputValue(),'1');await page.keyboard.press('Control+z');await ready();assert.equal(await page.locator('#contrast').inputValue(),'0');
  await page.locator('#contrast-value').fill('22');await page.keyboard.press('Tab');await ready();await btn('撤销').click();await ready();assert.equal(await page.locator('#contrast').inputValue(),'0');
  checks.push('separate drags remain separate undo steps; keyboard and numeric input still commit independently');
  await tab('预设').click();await btn('晴空通透').click();await page.mouse.move(400,100);await ready();assert.equal(await page.locator('dialog[open]').count(),0);await btn('晴空通透').click();await page.mouse.move(400,100);await ready();assert.equal(await page.locator('[data-preset-id="clear-day"]').getAttribute('aria-pressed'),'false');
  checks.push('unedited photo applies directly; clicking selected preset removes it without confirmation');
  await tab('编辑').click();await value('exposure',.5);await value('contrast',21);const edited=await pixels();await tab('预设').click();await btn('晴空通透').click();
  const dialog=page.getByRole('dialog',{name:'应用预设前确认'});await dialog.waitFor();await ready();assert.equal(await pixels(),edited);await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await ready();assert.equal(await pixels(),edited);assert.equal(await page.locator('#contrast').inputValue(),'21');
  await btn('晴空通透').click();await dialog.waitFor();await dialog.getByRole('button',{name:'取消',exact:true}).click();await ready();assert.equal(await pixels(),edited);
  await btn('晴空通透').click();await dialog.waitFor();await dialog.getByRole('button',{name:'应用预设',exact:true}).click();await page.mouse.move(400,100);await ready();assert.equal(await page.locator('#exposure').inputValue(),'0.5');assert.notEqual(await pixels(),edited);await btn('撤销').click();await ready();assert.equal(await pixels(),edited);
  checks.push('edited photo prompts; Escape/cancel preserve pixels and history; confirming preserves exposure and applies one undoable preset');
  await btn('晴空通透').click();await dialog.waitFor();await dialog.getByRole('button',{name:'应用预设',exact:true}).click();await page.mouse.move(400,100);await ready();const amount=await drag('preset-strength',100,30,true);await btn('撤销').click();await ready();assert.equal(await page.locator('#preset-strength').inputValue(),'100');await btn('重做').click();await ready();assert.equal(Number(await page.locator('#preset-strength').inputValue()),amount);
  await btn('蓝调夜色').click();await dialog.waitFor();await dialog.getByRole('button',{name:'取消',exact:true}).click();await ready();assert.equal(await page.locator('#preset-strength').inputValue(),String(amount));
  await page.locator('#legacy-presets').evaluate(e=>e.open=true);await btn('胶片').click();await dialog.waitFor();await dialog.getByRole('button',{name:'应用预设',exact:true}).click();await page.mouse.move(400,100);await ready();assert.equal(await page.locator('#filter-strength').inputValue(),'100');await btn('撤销').click();await ready();assert.equal(Number(await page.locator('#preset-strength').inputValue()),amount);
  checks.push('preset strength has gesture history too; switching native/classic presets requires confirmation and remains undoable');
  await tab('编辑').click();await btn('重置').click();await ready();await tab('预设').click();await btn('晴空通透').click();await page.mouse.move(400,100);await ready();assert.equal(await page.locator('dialog[open]').count(),0);
  await page.setViewportSize({width:390,height:844});await btn('蓝调夜色').click();await dialog.waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await fs.mkdir('test-results/history-gesture',{recursive:true});await page.screenshot({path:'test-results/history-gesture/mobile-confirm.png',fullPage:true});await page.keyboard.press('Escape');
  checks.push('reset photo skips confirmation again; confirmation fits 390px viewport');
  assert.deepEqual(errors,[]);await fs.writeFile('test-results/history-gesture/report.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));
 }finally{await browser.close();await server.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
