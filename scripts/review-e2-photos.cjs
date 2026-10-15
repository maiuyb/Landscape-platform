const {reveal}=require('../tests/workspace-support.cjs');
const {chromium}=require('playwright');const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');
const photos=require('../tests/photo-fixtures.json'),baseURL=process.env.HMI_TEST_URL||'http://127.0.0.1:5050',folder=path.resolve(__dirname,'../test-results/e2');
const escape=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
(async()=>{
  await fs.mkdir(folder,{recursive:true});const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}}),report=[];
  try{
    await page.goto(baseURL);
    for(const photo of photos){
      const file=path.resolve(__dirname,'../test-results/e1/photos',photo.file),buffer=await fs.readFile(file);
      const result=await page.evaluate(async base64=>{
        const image=new Image();image.src='data:image/jpeg;base64,'+base64;await image.decode();
        const raw=EditorCore.render(image,EditorCore.createState(),{maxSide:224,color:false});
        const data=raw.getContext('2d').getImageData(0,0,raw.width,raw.height).data;
        const neutral=EditorCore.createState(),hsl=EditorCore.createState(),curves=EditorCore.createState(),exposure=EditorCore.createState(),balance=EditorCore.createState();
        hsl.hsl.green.saturation=-20;hsl.hsl.blue.luminance=-15;hsl.hsl.orange.hue=8;
        curves.curves.master=[[0,0],[.25,.18],[.7,.78],[1,1]];
        exposure.adjustments.exposure=EditorCore.tools.autoExposure(data);
        let wbNote='';try{balance.whiteBalance={gains:EditorCore.tools.autoWhiteBalance(data),mode:'auto'};}catch(e){wbNote=e.message;}
        const combined=EditorCore.clone(hsl);combined.curves=curves.curves;combined.adjustments.exposure=exposure.adjustments.exposure;
        const variants=[['原图',neutral],['HSL 微调',hsl],['曲线微调',curves],['自动曝光',exposure],['自动白平衡',balance],['HSL + 曲线 + 曝光',combined]].map(([label,state])=>{
          const c=EditorCore.render(image,state,{maxSide:0}),pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
          return{label,recipe:EditorCore.toRecipe(state),png:c.toDataURL().split(',')[1],histogram:EditorCore.tools.histogram(pixels)};
        });
        return{width:image.naturalWidth,height:image.naturalHeight,wbNote,variants};
      },buffer.toString('base64'));
      const images=[];for(const[index,variant]of result.variants.entries()){const name=photo.file.replace('.jpg',`-${index}.png`);await fs.writeFile(path.join(folder,name),Buffer.from(variant.png,'base64'));delete variant.png;images.push(name);}
      assert.ok(result.variants.every(v=>v.histogram.count>0));report.push({...photo,...result,images});
      if(photo.file==='alpine.jpg'){
        await page.locator('#image-input').setInputFiles(file);await page.getByRole('status').filter({hasText:'已载入'}).waitFor();
        await page.getByLabel('导入配方',{exact:true}).setInputFiles({name:'e2-look.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(result.variants.at(-1).recipe))});
        await page.getByRole('button',{name:'应用到照片',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#mainCanvas').dataset.previewStatus==='ready');
        await page.locator('#color-group > summary').click();await reveal(page,'#hsl-group');
        await page.locator('.tool-group').first().evaluate(el=>{el.open=false;});await page.locator('.panel-scroll').evaluate(el=>{el.scrollTop=0;});
        await page.screenshot({path:path.join(folder,'workspace-hsl.png')});
        await page.locator('#color-group').evaluate(el=>{el.open=false;});await reveal(page,'#curves-group');await page.locator('.panel-scroll').evaluate(el=>{el.scrollTop=0;});
        await page.screenshot({path:path.join(folder,'workspace-curves.png')});
        await page.getByText('构图与方向',{exact:true}).click();await page.getByRole('button',{name:'裁剪照片',exact:true}).click();
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:path.join(folder,'workspace-crop.png')});
      }
    }
    await fs.writeFile(path.join(folder,'photos.json'),JSON.stringify(report,null,2));
    const body=report.map(p=>`<section><h2>${escape(p.title)}</h2><p>${escape(p.author)} · <a href="${p.licenseUrl}">${escape(p.license)}</a> · <a href="${p.source}">来源</a> · ${p.width} × ${p.height}</p><p>变体由本项目处理，图片沿用所列许可，仅用于本地检查。${escape(p.wbNote)}</p><div class="grid">${p.variants.map((v,i)=>`<figure><img src="${p.images[i]}" alt="${escape(v.label)}"><figcaption>${escape(v.label)}<details><summary>参数</summary><pre>${escape(JSON.stringify(v.recipe,null,2))}</pre></details></figcaption></figure>`).join('')}</div></section>`).join('');
    await fs.writeFile(path.join(folder,'review.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>E2 真实照片检查</title><style>body{background:#10141c;color:#e5e9f0;font:15px/1.7 system-ui;margin:30px}a{color:#a0c9ab}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}figure{margin:0}img{width:100%}figcaption,p{color:#b4becc}pre{white-space:pre-wrap}section{margin:50px 0}@media(max-width:700px){.grid{grid-template-columns:1fr}}</style><h1>E2 真实照片检查</h1><p>HSL、曲线与自动校正的独立变体；自动校正为可撤销估计，不代表所有场景的唯一答案。</p>${body}</html>`);
    await page.goto('file:///'+path.join(folder,'review.html').replaceAll('\\','/'));await page.screenshot({path:path.join(folder,'contact-sheet.png'),fullPage:true});
    console.log(JSON.stringify(report.map(p=>({file:p.file,width:p.width,height:p.height,wbNote:p.wbNote,exposure:p.variants[3].recipe.steps.find(s=>s.type==='exposure').params.value})),null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
