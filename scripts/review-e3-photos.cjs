const {chromium}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const folder=path.resolve(__dirname,'../test-results/e3'),photos=require('../tests/photo-fixtures.json'),url=process.env.HMI_TEST_URL||'http://127.0.0.1:5050';
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
(async()=>{
  await fs.mkdir(folder,{recursive:true});const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true}),report=[];
  const ready=()=>page.waitForFunction(()=>document.querySelector('#mainCanvas')?.dataset.previewStatus==='ready');
  try{
    await page.goto(url);
    for(const photo of photos){
      const native=path.join(folder,'native',photo.file),isNative=await fs.access(native).then(()=>true,()=>false),file=isNative?native:path.resolve(__dirname,'../test-results/e1/photos',photo.file),bytes=await fs.readFile(file);
      const result=await page.evaluate(async({png,name})=>{
        const image=new Image();image.src='data:image/jpeg;base64,'+png;await image.decode();
        const neutral=EditorCore.createState(),sharp=EditorCore.createState(),noise=EditorCore.createState(),combined=EditorCore.createState();
        Object.assign(sharp.detail,{sharpen:60,radius:1.2,protection:40});Object.assign(noise.detail,{luminance:50,color:65});Object.assign(combined.detail,sharp.detail,{luminance:50,color:65});
        const raw=EditorCore.render(image,neutral,{maxSide:0,color:false});
        const positions=name==='night.jpg'?[{x:.45,y:.53},{x:.55,y:.18}]:[{x:.48,y:.65}];
        const variants=[['原图',neutral],['锐化',sharp],['降噪',noise],['降噪 + 锐化',combined]].map(([label,state])=>{
          const patches=positions.map(position=>{const r=EditorCore.renderRegion(raw,state,{...position,side:384});return{...position,left:r.left,top:r.top,width:r.width,height:r.height,png:r.edited.toDataURL().split(',')[1]};});
          const start=performance.now(),canvas=EditorCore.render(image,state,{maxSide:1200});
          return{label,recipe:EditorCore.toRecipe(state),previewRenderMs:performance.now()-start,preview:canvas.toDataURL().split(',')[1],patches};
        });
        return{width:image.naturalWidth,height:image.naturalHeight,variants};
      },{png:bytes.toString('base64'),name:photo.file});
      for(const[index,v]of result.variants.entries()){
        v.previewFile=photo.file.replace('.jpg',`-${index}-view.png`);await fs.writeFile(path.join(folder,v.previewFile),Buffer.from(v.preview,'base64'));delete v.preview;
        for(const[pindex,patch]of v.patches.entries()){patch.file=photo.file.replace('.jpg',`-${index}-patch${pindex}.png`);await fs.writeFile(path.join(folder,patch.file),Buffer.from(patch.png,'base64'));delete patch.png;}
      }
      report.push({...photo,native:isNative,...result});
      if(photo.file==='night.jpg'){
        await page.locator('#image-input').setInputFiles(file);await ready();await page.getByLabel('导入配方',{exact:true}).setInputFiles({name:'detail-look.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(result.variants[3].recipe))});await page.getByRole('button',{name:'应用到照片',exact:true}).click();await ready();
        await page.locator('.tool-group').first().evaluate(el=>el.open=false);await page.locator('#detail-group > summary').click();await page.locator('#detail-group').scrollIntoViewIfNeeded();await page.getByRole('button',{name:'100% 细节查看',exact:true}).click();await ready();await page.screenshot({path:path.join(folder,'workspace-detail.png')});
        // Check a real 12MP file through the actual native-size PNG download path.
        await page.getByRole('button',{name:'关闭细节查看',exact:true}).click();await ready();await page.getByRole('button',{name:'导出照片',exact:true}).click();await page.locator('dialog select').first().selectOption('png');const waiting=page.waitForEvent('download');await page.getByRole('button',{name:'下载照片',exact:true}).click();const download=await waiting;await download.saveAs(path.join(folder,'night-native-export.png'));
        const expected=await page.evaluate(async({png,recipe})=>{const image=new Image();image.src='data:image/jpeg;base64,'+png;await image.decode();const start=performance.now(),state=EditorCore.recipeState(EditorCore.createState(),recipe).state,c=EditorCore.render(image,state,{maxSide:0}),data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return{renderMs:performance.now()-start,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(v=>v.toString(16).padStart(2,'0')).join('')};},{png:bytes.toString('base64'),recipe:result.variants[3].recipe});
        const actual=await page.evaluate(async png=>{const image=new Image();image.src='data:image/png;base64,'+png;await image.decode();const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;c.getContext('2d').drawImage(image,0,0);const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return{width:c.width,height:c.height,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(v=>v.toString(16).padStart(2,'0')).join('')};},(await fs.readFile(path.join(folder,'night-native-export.png'))).toString('base64'));assert.equal(actual.hash,expected.hash);report.at(-1).nativeExport={...actual,renderMs:expected.renderMs};
      }
      if(photo.file==='snow.jpg'){
        await page.locator('#image-input').setInputFiles(file);await ready();await page.getByText('构图与方向',{exact:true}).click();await page.getByRole('button',{name:'拉直照片',exact:true}).click();await page.locator('#straighten-angle').evaluate(el=>{el.value=-3.2;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});await ready();await page.screenshot({path:path.join(folder,'workspace-straighten.png')});
      }
    }
    await fs.writeFile(path.join(folder,'photos.json'),JSON.stringify(report,null,2));
    const body=report.map(p=>`<section><h2>${escape(p.title)}</h2><p>${escape(p.author)} · <a href="${p.licenseUrl}">${escape(p.license)}</a> · <a href="${p.source}">来源</a> · ${p.width} × ${p.height} · ${p.native?'来源站点原尺寸文件':'1280px 检查图'}</p><p>所有变体由本项目处理，沿用所列图片许可。下方局部按原图像素显示，可横向滚动比较。</p><div class="grid">${p.variants.map(v=>`<figure><img class="overview" src="${v.previewFile}" alt="${escape(v.label)}"><figcaption>${escape(v.label)}</figcaption>${v.patches.map(patch=>`<p>局部 (${patch.left}, ${patch.top})，${patch.width} × ${patch.height}</p><img class="patch" src="${patch.file}" alt="${escape(v.label)}原图像素局部">`).join('')}<details><summary>参数</summary><pre>${escape(JSON.stringify(v.recipe,null,2))}</pre></details></figure>`).join('')}</div></section>`).join('');
    await fs.writeFile(path.join(folder,'review.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>E3 真实照片检查</title><style>body{background:#10141c;color:#e5e9f0;font:15px/1.7 system-ui;margin:24px}a{color:#a0c9ab}.grid{display:grid;grid-template-columns:repeat(4,384px);gap:14px;overflow-x:auto}figure{margin:0}.overview{width:384px}.patch{display:block;width:384px;height:384px;max-width:none}p,figcaption{color:#b4becc}pre{white-space:pre-wrap}section{margin:45px 0}</style><h1>E3 细节与构图检查</h1><p>对比原图、锐化、降噪及组合；局部以一个源图像素对应一个显示像素。高强度会牺牲纹理或产生光晕，应结合照片微调。</p>${body}</html>`);
    await page.setViewportSize({width:1640,height:1000});await page.goto('file:///'+path.join(folder,'review.html').replaceAll('\\','/'));await page.screenshot({path:path.join(folder,'contact-sheet.png'),fullPage:true});console.log(JSON.stringify(report.map(p=>({file:p.file,native:p.native,size:[p.width,p.height],nativeExport:p.nativeExport})),null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
