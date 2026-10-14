const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const photos = require('./photo-fixtures.json');
const baseURL = process.env.HMI_TEST_URL || 'http://127.0.0.1:5050';
const folder = path.resolve(__dirname, '../test-results/e1');
const escape = text => text.replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));

(async () => {
  await fs.mkdir(folder, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage(), errors = [], report = { photos: [], checks: [], browser: browser.version(), baseURL };
  page.on('pageerror', error => errors.push(error.message));
  const flush = async () => { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await page.waitForFunction(() => { const canvas = document.querySelector('#mainCanvas'); return !canvas || canvas.dataset.previewStatus === 'ready'; }); };
  const button = name => page.getByRole('button', { name, exact: true });
  const pixels = () => page.locator('#mainCanvas').evaluate(canvas => canvas.toDataURL());
  const upload = async photo => {
    await page.locator('#image-input').setInputFiles(path.join(folder, 'photos', photo.file));
    await page.getByRole('status').filter({ hasText: '已载入' }).waitFor(); await flush();
  };
  const number = async (key,value) => { await page.locator(`#${key}-value`).fill(String(value)); await page.locator(`#${key}-value`).press('Enter'); await flush(); };
  try {
    await page.goto(baseURL); await upload(photos[0]);
    assert.equal(await page.locator('.tool-group').first().getAttribute('open') !== null, true);
    assert.equal(await page.locator('#color-group').getAttribute('open'), null);
    const original = await pixels();
    await number('whites',25); assert.equal(await page.locator('#whites').inputValue(),'25');
    assert.notEqual(await pixels(),original);
    await button('撤销').click(); await flush(); assert.equal(await pixels(),original); assert.equal(await button('撤销').isEnabled(),false);
    await number('exposure',0.75); assert.equal(await page.locator('#exposure-value').inputValue(),'0.75');
    const exposed = await pixels();
    await number('exposure',99); assert.equal(await pixels(),exposed); assert.equal(await page.locator('#exposure-value').inputValue(),'0.75');
    await number('whites',1.5); assert.equal(await page.locator('#whites-value').inputValue(),'0');
    await number('whites',''); assert.equal(await page.locator('#whites-value').inputValue(),'0');
    await button('撤销').click(); await flush(); assert.equal(await pixels(),original);
    report.checks.push('numeric input commits once; EV precision, invalid/out-of-range/fractional/empty inputs preserve the document');

    await page.locator('#color-group > summary').click();
    await number('vibrance',35); await number('blacks',20);
    const mixed = await pixels();
    await button('复位光线').click(); await flush();
    assert.equal(await page.locator('#blacks-value').inputValue(),'0'); assert.equal(await page.locator('#vibrance-value').inputValue(),'35');
    await button('撤销').click(); await flush(); assert.equal(await pixels(),mixed);
    await button('复位颜色').click(); await flush();
    assert.equal(await page.locator('#blacks-value').inputValue(),'20'); assert.equal(await page.locator('#vibrance-value').inputValue(),'0');
    await button('撤销').click(); await flush(); assert.equal(await pixels(),mixed);
    report.checks.push('group resets isolate light/color and undo restores all values and pixels; toggling groups adds no history');

    await button('重置').click(); await flush();
    const legacy = {version:1,steps:[{type:'exposure',params:{value:37}},{type:'highlights',params:{value:41}},{type:'shadows',params:{value:22}}]};
    await page.getByLabel('导入配方',{exact:true}).setInputFiles({name:'legacy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});
    await page.getByRole('status').filter({hasText:'已兼容旧配方'}).waitFor();
    await button('取消预览').click(); await flush(); assert.equal(await pixels(),original);
    await page.getByLabel('导入配方',{exact:true}).setInputFiles({name:'legacy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});
    await button('应用到照片').click(); await flush();
    assert.equal(await page.locator('#exposure-value').inputValue(),'0.74');
    assert.equal(await page.locator('#highlights-value').inputValue(),'-41');
    const legacyPixels = await pixels();
    let downloading = page.waitForEvent('download'); await button('下载配方').click();
    const recipeFile = await (await downloading).path(); const recipe = JSON.parse(await fs.readFile(recipeFile,'utf8'));
    assert.equal(recipe.version,3); assert.deepEqual(recipe.rendering.legacyTone,{highlights:true,shadows:true});
    await button('重置').click();
    await page.getByLabel('导入配方',{exact:true}).setInputFiles(recipeFile); await button('应用到照片').click(); await flush(); assert.equal(await pixels(),legacyPixels);
    await number('highlights',-40); await page.getByRole('status').filter({hasText:'新版平滑调整'}).waitFor();
    await button('撤销').click(); await flush(); assert.equal(await pixels(),legacyPixels);
    const badRecipe = {version:99,steps:[]};
    await page.getByLabel('导入配方',{exact:true}).setInputFiles({name:'future.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(badRecipe))});
    await page.getByRole('alert').filter({hasText:'版本'}).waitFor(); assert.equal(await pixels(),legacyPixels);
    await page.getByLabel('导入配方',{exact:true}).setInputFiles(recipeFile); await flush();
    assert.equal(await page.getByRole('alert').count(),0);
    await button('取消预览').click();await flush();assert.equal(await pixels(),legacyPixels);
    report.checks.push('v1 exposure/highlight migration, preview cancellation, v2 compatibility export/import, manual upgrade/undo and future-version rejection');

    for(const photo of photos) {
      await upload(photo);
      const buffer=await fs.readFile(path.join(folder,'photos',photo.file));
      const result=await page.evaluate(async ({base64}) => {
        const image=new Image(); image.src='data:image/jpeg;base64,'+base64; await image.decode();
        const reference=document.createElement('canvas');reference.width=image.naturalWidth;reference.height=image.naturalHeight;
        reference.getContext('2d').drawImage(image,0,0);const source=reference.getContext('2d').getImageData(0,0,reference.width,reference.height).data;
        const cases=[['原图',{}],['白色 −50',{whites:-50}],['黑色 +50',{blacks:50}],['自然饱和度 +60',{vibrance:60}],['饱和度 +60',{saturation:60}],['综合微调',{exposure:0.1,highlights:-20,shadows:15,whites:-15,blacks:-10,temperature:3,vibrance:25}]];
        const outputs=cases.map(([label,adjustments])=>{
          const state=EditorCore.createState();Object.assign(state.adjustments,adjustments);
          const canvas=EditorCore.render(image,state,{maxSide:0});const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
          let changed=0,alphaChanges=0,luma=0,chroma=0;
          for(let i=0;i<data.length;i+=4){
            if(data[i]!==source[i]||data[i+1]!==source[i+1]||data[i+2]!==source[i+2])changed++;
            if(data[i+3]!==source[i+3])alphaChanges++;
            luma+=0.299*data[i]+0.587*data[i+1]+0.114*data[i+2];chroma+=Math.max(data[i],data[i+1],data[i+2])-Math.min(data[i],data[i+1],data[i+2]);
          }
          return {label,adjustments,png:canvas.toDataURL().split(',')[1],changed,alphaChanges,meanLuma:luma/(data.length/4),meanChroma:chroma/(data.length/4)};
        });
        const state=EditorCore.createState();Object.assign(state.adjustments,cases.at(-1)[1]);
        const times=[];EditorCore.render(image,state);
        for(let i=0;i<5;i++){const start=performance.now();EditorCore.render(image,state);times.push(performance.now()-start);}
        return {width:image.naturalWidth,height:image.naturalHeight,outputs,previewTimesMs:times};
      },{base64:buffer.toString('base64')});
      assert.equal(result.outputs[0].changed,0);assert.ok(result.outputs.slice(1).every(out=>out.changed>0&&out.alphaChanges===0));
      assert.ok(result.outputs[1].meanLuma<result.outputs[0].meanLuma);
      assert.ok(result.outputs[2].meanLuma>result.outputs[0].meanLuma);
      assert.ok(result.outputs[3].meanChroma>result.outputs[0].meanChroma);
      const images=[];
      for(const [index,out] of result.outputs.entries()) {
        const filename=photo.file.replace('.jpg',`-${index}.png`); await fs.writeFile(path.join(folder,filename),Buffer.from(out.png,'base64'));
        delete out.png;images.push(filename);
      }
      report.photos.push({...photo,...result,images});
      for(const [key,value] of Object.entries(result.outputs.at(-1).adjustments)) await number(key,value);
      if(photo.file==='alpine.jpg') {
        await page.locator('.parameter-panel').evaluate(panel => {panel.scrollTop=0;});
        await page.screenshot({path:path.join(folder,'workspace.png')});
      }
      await button('导出照片').click();await page.locator('dialog select').first().selectOption('png');
      downloading=page.waitForEvent('download');await button('下载照片').click();
      const png=await fs.readFile(await (await downloading).path());
      assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],[result.width,result.height]);
      const matches=await page.evaluate(async ({actual,expected})=>{
        const pixels=async data=>{const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);return c.getContext('2d').getImageData(0,0,c.width,c.height).data;};
        const a=await pixels(actual),b=await pixels(expected);return a.length===b.length&&a.every((v,i)=>v===b[i]);
      },{actual:png.toString('base64'),expected:(await fs.readFile(path.join(folder,images.at(-1)))).toString('base64')});
      assert.equal(matches,true);
    }
    report.checks.push(`${photos.length} real photos: neutral identity, independent endpoint/chroma effects, alpha preservation, full-size PNG pixel equality and preview timings`);
    const mobile=await context.newPage();await mobile.setViewportSize({width:375,height:812});await mobile.goto(baseURL);
    await mobile.locator('#image-input').setInputFiles(path.join(folder,'photos','night.jpg'));await mobile.getByRole('status').filter({hasText:'已载入'}).waitFor();
    await mobile.locator('#color-group > summary').click();await mobile.locator('#vibrance-value').fill('30');await mobile.locator('#vibrance-value').press('Enter');
    assert.equal(await mobile.locator('#vibrance').inputValue(),'30');
    assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await mobile.screenshot({path:path.join(folder,'mobile.png'),fullPage:true});await mobile.close();
    report.checks.push('375px layout: expanded color controls, numeric entry, no horizontal overflow');
    assert.deepEqual(errors,[]);report.errors=errors;
    await fs.writeFile(path.join(folder,'report.json'),JSON.stringify(report,null,2));
    const sections=report.photos.map(photo=>`<section><h2>${escape(photo.title)}</h2><p>${escape(photo.author)} · <a href="${photo.licenseUrl}">${photo.license}</a> · <a href="${photo.source}">来源</a> · ${photo.width} × ${photo.height} 缩略图</p><p>以下变体由本项目调色生成，图片沿用所标注许可；未作为产品素材。</p><div class="grid">${photo.outputs.map((out,i)=>`<figure><img src="${photo.images[i]}" alt="${escape(out.label)}"><figcaption>${escape(out.label)} · ${escape(JSON.stringify(out.adjustments))}</figcaption></figure>`).join('')}</div></section>`).join('');
    await fs.writeFile(path.join(folder,'review.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>E1 真实照片效果检查</title><style>body{background:#10141c;color:#e5e9f0;font:15px/1.7 system-ui;margin:30px}a{color:#a0c9ab}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}figure{margin:0}img{width:100%}figcaption,p{color:#b4becc}section{margin:50px 0}@media(max-width:700px){.grid{grid-template-columns:1fr}}</style><h1>E1 真实照片效果检查</h1><p>2026-10-14 · 本地 Chromium ${report.browser} · 功能与输出验证，审美仍可调整。</p>${sections}</html>`);
    await page.goto('file:///'+path.join(folder,'review.html').replaceAll('\\','/'));await page.screenshot({path:path.join(folder,'contact-sheet.png'),fullPage:true});
    console.log(JSON.stringify({checks:report.checks,photos:report.photos.map(p=>({file:p.file,size:[p.width,p.height],previewTimesMs:p.previewTimesMs})),errors},null,2));
  }catch(error){await page.screenshot({path:path.join(folder,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
  finally{await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
