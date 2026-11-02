const {testPhoto}=require('./photo-support.cjs');
const {reveal}=require('./workspace-support.cjs');
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const baseURL=process.env.HMI_TEST_URL||'http://127.0.0.1:5050';
(async()=>{
  const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const ready=()=>page.waitForFunction(()=>document.querySelector('#mainCanvas')?.dataset.previewStatus==='ready');
  const upload=async file=>{await page.locator('#image-input').setInputFiles(testPhoto(file));await page.locator('.file-info strong').filter({hasText:path.basename(testPhoto(file))}).waitFor();await ready();};
  const input=async (key,value,change=true)=>page.locator('#'+key).evaluate((el,{value,change})=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));if(change)el.dispatchEvent(new Event('change',{bubbles:true}));},{value,change});
  const pixels=()=>page.locator('#mainCanvas').evaluate(c=>c.toDataURL());
  try{
    await page.goto(baseURL);await upload('night.jpg');
    assert.equal(await page.locator('#mainCanvas').getAttribute('data-preview-mode'),'worker');
    const original=await pixels(),stage=await page.locator('.image-stage').boundingBox();
    await input('whites',70,false);
    await page.waitForFunction(()=>document.querySelector('#mainCanvas').dataset.previewQuality==='640');
    const interactive=await page.locator('.image-stage').boundingBox();assert.equal(interactive.width,stage.width);assert.equal(interactive.height,stage.height);
    await input('whites',-40);await ready();assert.equal(await page.locator('#mainCanvas').getAttribute('data-preview-quality'),'1200');
    const final=await pixels();
    assert.notEqual(final,original);
    await page.getByRole('button',{name:'撤销',exact:true}).click();await ready();assert.equal(await pixels(),original);
    // Pending frames must not overwrite undo or a replacement photo.
    await input('whites',90,false);await page.getByRole('button',{name:'重置',exact:true}).click();await ready();assert.equal(await pixels(),original);
    await input('vibrance',80,false);await upload('alpine.jpg');assert.equal(await page.locator('#vibrance-value').inputValue(),'0');
    const replacement=await pixels();await page.waitForTimeout(200);assert.equal(await pixels(),replacement);
    const context=await browser.newContext();
    // Disable background rendering to exercise the compatibility path without altering product code.
    await context.addInitScript(()=>{window.Worker=undefined;});const fallback=await context.newPage();fallback.on('pageerror',e=>errors.push(e.message));
    await fallback.goto(baseURL);await fallback.locator('#image-input').setInputFiles(testPhoto('alpine'));
    await fallback.waitForFunction(()=>document.querySelector('#mainCanvas')?.dataset.previewStatus==='ready');
    assert.equal(await fallback.locator('#mainCanvas').getAttribute('data-preview-mode'),'compatible');
    const parity=await fallback.evaluate(async expected=>{const image=new Image();image.src=expected;await image.decode();const actual=document.querySelector('#mainCanvas'),c=document.createElement('canvas');c.width=image.width;c.height=image.height;c.getContext('2d').drawImage(image,0,0);const a=actual.getContext('2d').getImageData(0,0,actual.width,actual.height).data,b=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let max=0,changed=0;for(let i=0;i<a.length;i++){max=Math.max(max,Math.abs(a[i]-b[i]));if(a[i]!==b[i])changed++;}return{size:[actual.width,actual.height,c.width,c.height],max,changed};},replacement);assert.equal(parity.max,0,JSON.stringify(parity));
    await reveal(fallback,'#whites-value');await fallback.locator('#whites-value').fill('30');await fallback.locator('#whites-value').press('Enter');
    await fallback.waitForFunction(()=>document.querySelector('#mainCanvas').dataset.previewStatus==='ready');
    assert.notEqual(await fallback.locator('#mainCanvas').evaluate(c=>c.toDataURL()),replacement);
    await context.close();assert.deepEqual(errors,[]);
    console.log('Preview worker, stable drag geometry, final quality, stale undo/replacement frames and compatibility fallback passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
