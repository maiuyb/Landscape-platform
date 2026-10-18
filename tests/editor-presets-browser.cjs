const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {reveal}=require('./workspace-support.cjs');
const url=process.env.HMI_TEST_URL||'http://127.0.0.1:5050';
const folder=path.resolve(__dirname,'../test-results/presets');
const photo=path.resolve(__dirname,'../test-results/e1/photos/alpine.jpg');
(async()=>{
  await fs.mkdir(folder,{recursive:true});
  const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await context.newPage(),checks=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const button=n=>page.getByRole('button',{name:n,exact:true}),tab=n=>page.getByRole('tab',{name:n,exact:true});
  const apply=async name=>{await button(name).click();const dialog=page.getByRole('dialog',{name:'应用预设前确认'});if(await dialog.isVisible())await dialog.getByRole('button',{name:'应用预设',exact:true}).click();};
  const ready=()=>page.waitForFunction(()=>document.querySelector('#mainCanvas')?.dataset.previewStatus==='ready',null,{timeout:60000});
  const settle=async()=>{await page.mouse.move(400,100);await tab('预设').focus();await ready();};
  const pixels=async()=>crypto.createHash('sha256').update(await page.locator('#mainCanvas').evaluate(c=>c.toDataURL())).digest('hex');
  const range=async(id,value)=>{await page.locator('#'+id).evaluate((e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},value);await ready();};
  const recipe=async()=>{
    await reveal(page,'.workspace-output');const wait=page.waitForEvent('download');await button('下载配方').click();
    return JSON.parse(await fs.readFile(await(await wait).path(),'utf8'));
  };
  const closeNotice=async()=>{if(await button('关闭提示').count())await button('关闭提示').click();};
  try{
    await page.goto(url);await page.screenshot({path:path.join(folder,'empty.png')});
    await page.locator('#image-input').setInputFiles(photo);await ready();await closeNotice();
    const initial=await page.evaluate(()=>{
      const s=EditorCore.createState();s.adjustments.exposure=.25;s.adjustments.brightness=2;EditorCore.setWhiteBalance(s,[1.04,1,.96],'sample');
      s.adjustments.contrast=3;s.curves.master=[[0,0],[.3,.32],[1,1]];
      s.geometry=[{type:'flip',params:{direction:'h'}}];const mask=EditorCore.masks.create('linear','preserved-mask');mask.adjustments.exposure=.1;s.masks=[mask];
      return EditorCore.toRecipe(s);
    });
    await page.getByLabel('导入配方',{exact:true}).setInputFiles({name:'initial.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(initial))});
    await button('应用到照片').click();await ready();await closeNotice();
    const before=await pixels();await tab('预设').click();
    await page.waitForFunction(()=>[...document.querySelectorAll('[data-preset-id] canvas')].length===18&&[...document.querySelectorAll('[data-preset-id] canvas')].every(c=>c.dataset.thumbnailStatus==='ready'));
    assert.equal(await page.locator('[data-preset-id]').count(),18);
    for(const category of ['自然通透','山林植被','日落暖色','城市夜景','胶片柔和','黑白影调']){
      await button('筛选'+category+'预设').click();assert.equal(await page.locator('[data-preset-id]').count(),3);
    }
    await button('筛选全部预设').click();await page.getByLabel('搜索预设',{exact:true}).fill('蓝调夜色');assert.equal(await page.locator('[data-preset-id]').count(),1);
    await page.getByLabel('搜索预设',{exact:true}).fill('不存在的风格');await page.getByText(/暂时没有找到这类风格/).waitFor();await button('查看全部风格').click();
    await button('收藏晴空通透').click();await button('筛选我的收藏预设').click();assert.equal(await page.locator('[data-preset-id]').count(),1);
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('landscape-preset-favorites'))),['clear-day']);
    await button('筛选全部预设').click();await settle();assert.equal(await pixels(),before);
    checks.push('18 presets / six categories, text search, empty state and local favorites do not alter the photo');

    await button('晴空通透').hover();await ready();const hover=await pixels();assert.notEqual(hover,before);await settle();assert.equal(await pixels(),before);
    await apply('晴空通透');await settle();assert.equal(await pixels(),hover);assert.equal(await button('晴空通透').getAttribute('aria-pressed'),'true');
    await range('preset-strength',0);assert.equal(await pixels(),before);await range('preset-strength',100);
    await apply('蓝调夜色');await settle();await apply('清新明信片');await settle();
    const clean=await recipe();const same=await page.evaluate(({initial,clean})=>{
      const base=EditorCore.recipeState(EditorCore.createState(),initial).state,expected=EditorPresets.apply(base,'airy-postcard'),actual=EditorCore.recipeState(EditorCore.createState(),clean).state;
      return JSON.stringify(EditorPresets.snapshot(expected))===JSON.stringify(EditorPresets.snapshot(actual));
    },{initial,clean});assert.equal(same,true);
    assert.deepEqual(clean.steps.find(s=>s.type==='masks').params,initial.steps.find(s=>s.type==='masks').params);
    assert.equal(clean.steps.find(s=>s.type==='exposure').params.value,.25);assert.equal(clean.steps.find(s=>s.type==='detail').params.color,0);
    assert.equal(clean.steps.find(s=>s.type==='white-balance').params.mode,'sample');
    checks.push('hover matches applied pixels; strength 0 restores the manual baseline; direct switching clears previous style and preserves exposure/WB/geometry/masks');

    await tab('预设').click();await closeNotice();await page.locator('#preset-strength').evaluate(e=>{
      for(const v of [90,70,37]){e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));}e.dispatchEvent(new Event('change',{bubbles:true}));
    });await ready();await button('撤销').click();await ready();assert.equal(await page.locator('#preset-strength').inputValue(),'100');
    await button('重做').click();await ready();assert.equal(await page.locator('#preset-strength').inputValue(),'37');
    await button('继续手动微调').click();await reveal(page,'#contrast');await range('contrast',28);
    await reveal(page,'#hsl-group');await page.getByRole('combobox',{name:'HSL 调整类型'}).selectOption('luminance');await range('hsl-blue',17);
    await tab('预设').click();await range('preset-strength',0);assert.equal(await page.locator('#contrast').inputValue(),'28');assert.equal(await page.locator('#hsl-blue').inputValue(),'17');
    await page.getByText(/已保留你手动改过的参数/).waitFor();await button('移除预设').click();await ready();assert.equal(await page.locator('#preset-strength').count(),0);
    assert.equal(await page.locator('#contrast').inputValue(),'28');await button('撤销').click();await ready();assert.equal(await page.locator('#preset-strength').inputValue(),'0');
    checks.push('one strength gesture is one undo step; manual contrast/HSL survives later strength changes and removal; undo restores the session');

    const legacyBase=await recipe();await tab('预设').click();await button('筛选全部预设').click();await apply('金色晚霞');await settle();
    await reveal(page,'#legacy-presets');await page.waitForFunction(()=>document.querySelector('#legacy-presets button[aria-label="胶片"] canvas')?.dataset.thumbnailStatus&&document.querySelector('#legacy-presets button[aria-label="胶片"] canvas')?.dataset.thumbnailStatus!=='pending');const legacyError=await button('胶片').locator('canvas').getAttribute('data-thumbnail-error');assert.equal(legacyError,null);
    const legacyComparison=await page.evaluate(async({source,recipe})=>{
      const image=new Image();image.src='data:image/jpeg;base64,'+source;await image.decode();const s=EditorCore.recipeState(EditorCore.createState(),recipe).state;s.filter='film';s.filterStrength=100;
      const bitmap=await createImageBitmap(image),expected=EditorCore.render(bitmap,s,{maxSide:240}),actual=document.querySelector('#legacy-presets button[aria-label="胶片"] canvas');
      const a=actual.getContext('2d').getImageData(0,0,actual.width,actual.height).data,b=expected.getContext('2d').getImageData(0,0,expected.width,expected.height).data;
      let max=0,sum=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);max=Math.max(max,d);sum+=d;}
      return{max,mean:sum/a.length,actual:[actual.width,actual.height],expected:[expected.width,expected.height]};
    },{source:(await fs.readFile(photo)).toString('base64'),recipe:legacyBase});
    assert.deepEqual(legacyComparison.actual,legacyComparison.expected);assert.equal(legacyComparison.max,0,'classic thumbnail must match the same ImageBitmap render path');

    await apply('胶片');await ready();assert.equal(await page.locator('#preset-strength').count(),0);assert.equal(await page.locator('#filter-strength').inputValue(),'100');
    const legacyActual=await recipe();assert.deepEqual(await page.evaluate(({before,after})=>{const a=EditorCore.recipeState(EditorCore.createState(),before).state,b=EditorCore.recipeState(EditorCore.createState(),after).state;return Object.keys(a).filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k]));},{before:legacyBase,after:legacyActual}),['filter']);
    await button('撤销').click();await ready();assert.equal(await page.locator('#preset-strength').inputValue(),'100');await page.locator('#legacy-presets').evaluate(e=>e.open=false);
    checks.push('classic filter thumbnail matches its application baseline after a new preset; undo restores the new preset session');

    await button('筛选黑白影调预设').click();await apply('黑白层次');await settle();await closeNotice();
    await page.waitForFunction(()=>[...document.querySelectorAll('[data-preset-id] canvas')].every(c=>c.dataset.thumbnailStatus==='ready'));
    await page.screenshot({path:path.join(folder,'desktop-presets.png')});
    const activeRecipe=await recipe();assert.equal(activeRecipe.version,6);assert.equal(JSON.stringify(activeRecipe).includes('presetSession'),false);
    await tab('编辑').click();await closeNotice();await page.screenshot({path:path.join(folder,'desktop-edit.png')});
    await button('导出照片').click();await page.locator('dialog select').first().selectOption('png');const waiting=page.waitForEvent('download');await button('下载照片').click();
    const png=await fs.readFile(await(await waiting).path());const source=(await fs.readFile(photo)).toString('base64');
    const output=await page.evaluate(async({source,png,recipe})=>{
      const load=async(url)=>{const image=new Image();image.src=url;await image.decode();return image;};
      const original=await load('data:image/jpeg;base64,'+source),image=await load('data:image/png;base64,'+png);
      const state=EditorCore.recipeState(EditorCore.createState(),recipe).state,expected=EditorCore.render(original,state,{maxSide:0});
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d').drawImage(image,0,0);
      const a=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,b=expected.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      return{equal:a.every((v,i)=>v===b[i]),width:canvas.width,height:canvas.height,mono:a.every((v,i)=>i%4!==0||Math.max(v,a[i+1],a[i+2])-Math.min(v,a[i+1],a[i+2])<=1)};
    },{source,png:png.toString('base64'),recipe:activeRecipe});
    assert.equal(output.equal,true);assert.equal(output.mono,true);assert.deepEqual([output.width,output.height],[1280,575]);
    const painted=await pixels();await button('重置').click();await ready();await page.getByLabel('导入配方',{exact:true}).setInputFiles({name:'roundtrip.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(activeRecipe))});await button('应用到照片').click();await ready();
    assert.equal(await page.locator('.applied-preset-note').count(),0);await closeNotice();await ready();assert.equal(await pixels(),painted);
    checks.push('black-and-white full-size PNG is grayscale and pixel-identical to the exported v6 recipe; flattened reimport preserves the appearance');

    const sources=await page.request.get(url+'/preset-sources.json');assert.equal(sources.ok(),true);assert.equal((await sources.json()).presets.length,18);
    const license=await page.request.get(url+'/licenses/peva3-presets-MIT.txt');assert.match(await license.text(),/Copyright \(c\) 2026 peva3/);
    const colors=await page.evaluate(()=>({scheme:getComputedStyle(document.documentElement).colorScheme,body:getComputedStyle(document.body).color,panel:getComputedStyle(document.querySelector('.parameter-panel')).backgroundColor,canvas:getComputedStyle(document.querySelector('.canvas-panel')).backgroundColor}));
    assert.equal(colors.scheme,'light');assert.equal(colors.panel,'rgb(255, 252, 246)');assert.equal(colors.canvas,'rgb(229, 229, 224)');
    checks.push('warm light theme has a neutral photo surround; pinned source manifest and MIT notice are served with the app');

    const fallbackContext=await browser.newContext({viewport:{width:1440,height:1000}});await fallbackContext.addInitScript(()=>window.Worker=undefined);const fallback=await fallbackContext.newPage();fallback.on('pageerror',e=>errors.push(e.message));
    await fallback.goto(url);await fallback.locator('#image-input').setInputFiles(photo);await fallback.waitForFunction(()=>document.querySelector('#mainCanvas')?.dataset.previewStatus==='ready');await fallback.getByRole('tab',{name:'预设',exact:true}).click();
    await fallback.getByRole('button',{name:'筛选自然通透预设',exact:true}).click();await fallback.waitForFunction(()=>[...document.querySelectorAll('[data-preset-id] canvas')].length===3&&[...document.querySelectorAll('[data-preset-id] canvas')].every(c=>c.dataset.thumbnailStatus==='ready'));
    await fallback.getByRole('button',{name:'晴空通透',exact:true}).click();await fallback.getByRole('button',{name:'移除预设',exact:true}).click();await fallback.waitForFunction(()=>document.querySelector('#mainCanvas')?.dataset.previewStatus==='ready');assert.equal(await fallback.locator('#exposure').inputValue(),'0');await fallbackContext.close();
    const revisit=await context.newPage();await revisit.goto(url);assert.deepEqual(await revisit.evaluate(()=>JSON.parse(localStorage.getItem('landscape-preset-favorites'))),['clear-day']);await revisit.close();
    checks.push('compatibility renderer produces new thumbnails and supports applying/removing presets; favorites persist in a second page');

    const mobileContext=await browser.newContext({viewport:{width:375,height:812},hasTouch:true,isMobile:true});const mobile=await mobileContext.newPage();mobile.on('pageerror',e=>errors.push(e.message));
    await mobile.goto(url);await mobile.locator('#image-input').setInputFiles(photo);await mobile.waitForFunction(()=>document.querySelector('#mainCanvas')?.dataset.previewStatus==='ready');await mobile.getByRole('button',{name:'关闭提示',exact:true}).tap();
    await mobile.getByRole('tab',{name:'预设',exact:true}).tap();await mobile.getByRole('button',{name:'筛选山林植被预设',exact:true}).tap();await mobile.getByRole('button',{name:'林间深绿',exact:true}).tap();await mobile.waitForFunction(()=>document.querySelector('#mainCanvas')?.dataset.previewStatus==='ready');
    assert.equal(await mobile.locator('#preset-strength').inputValue(),'100');await mobile.getByRole('button',{name:'收藏林间深绿',exact:true}).tap();await mobile.getByRole('button',{name:'筛选我的收藏预设',exact:true}).tap();
    assert.equal(await mobile.locator('[data-preset-id]').count(),1);assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await mobile.getByRole('button',{name:'关闭提示',exact:true}).tap();await mobile.locator('.panel-scroll').evaluate(e=>e.scrollTop=0);await mobile.waitForFunction(()=>[...document.querySelectorAll('[data-preset-id] canvas')].every(c=>c.dataset.thumbnailStatus==='ready'));await mobile.locator('#image-input').scrollIntoViewIfNeeded();await mobile.screenshot({path:path.join(folder,'mobile.png'),fullPage:true});await mobileContext.close();
    checks.push('375px touch layout: category/favorite/apply/strength remain reachable without horizontal overflow');
    assert.deepEqual(errors,[]);await fs.writeFile(path.join(folder,'browser-report.json'),JSON.stringify({checks,errors,colors,browser:browser.version()},null,2));console.log(JSON.stringify({checks,errors},null,2));
  }catch(e){await page.screenshot({path:path.join(folder,'failure.png'),fullPage:true}).catch(()=>{});throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
