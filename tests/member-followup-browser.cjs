/* Member follow-up acceptance: isolated storage, synthetic images, in-memory mail. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {start}=require('./isolated-browser-support.cjs');
const {observe,readRecipe}=require('./editor-test-observer.cjs');

async function syntheticImage(page,name='synthetic-a.png'){
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=96;c.height=64;const x=c.getContext('2d');x.fillStyle='#799b8e';x.fillRect(0,0,96,64);x.fillStyle='#d6ad7f';x.fillRect(8,8,32,40);return c.toDataURL().split(',')[1];});
 return {name,mimeType:'image/png',buffer:Buffer.from(png,'base64')};
}
const ready=page=>page.waitForFunction(()=>document.querySelector('#mainCanvas')?.dataset.previewStatus==='ready');
const pixels=page=>page.locator('#mainCanvas').evaluate(c=>c.toDataURL());
const button=(page,name)=>page.getByRole('button',{name,exact:true});
const authFrame=page=>page.frameLocator('.auth-frame-overlay iframe');
async function captcha(ui,prefix){
 await ui.locator('#'+prefix+'Refresh').evaluate(el=>new Promise(resolve=>{if(!el.disabled)return resolve();const t=setInterval(()=>{if(!el.disabled){clearInterval(t);resolve();}},10);}));
 await ui.locator('#'+prefix+'Answer').fill('AAAAA');
}

async function preferencesAndPrivacy(browser,base,folder){
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));page.on('pageerror',e=>errors.push(e.message));
 try{
  const seed=async username=>(await(await page.request.post(base+'/__test/register',{data:{username}})).json());
  const owner=await seed('synthetic-owner'),peer=await seed('synthetic-peer'),headers={Authorization:'Bearer '+owner.token};
  await page.request.put(base+'/api/users/me',{headers,data:{bio:'Synthetic biography',location:'Synthetic city'}});
  await context.addInitScript(owner=>{if(!['127.0.0.1','localhost'].includes(location.hostname))return;localStorage.setItem('landscape:token',owner.token);localStorage.setItem('landscape:user',JSON.stringify(owner.user));},owner);
  await page.goto(base+'/');await button(page,'编辑器').click();const file=await syntheticImage(page);
  await page.locator('#image-input').setInputFiles(file);await ready(page);
  await button(page,'导出照片').click();const output=page.getByRole('dialog',{name:'导出照片',exact:true});
  await output.getByRole('combobox',{name:'格式',exact:true}).selectOption('png');await output.getByRole('combobox',{name:'导出尺寸',exact:true}).selectOption('0.5');
  const prefs=await context.newPage();await prefs.goto(base+'/community/',{waitUntil:'networkidle'});
  // Ordinary page clicks must never be treated as preference controls, including
  // when the document has an explicit gallery-column attribute on initial load.
  async function checkOrdinaryClick(){
   const result=await prefs.evaluate(()=>{let writes=0;const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='landscape:prefs')writes++;return original.call(this,k,v);};document.body.click();Storage.prototype.setItem=original;return{writes,handler:document.documentElement.onclick,active:document.documentElement.classList.contains('active')};});
   assert.deepEqual(result,{writes:0,handler:null,active:false});
  }
  await checkOrdinaryClick();await prefs.locator('#authUserBtn').hover();await button(prefs,'用户中心').click();await prefs.locator('[data-uc-view="settings"]').click();
  await prefs.locator('#ucSettingsPanel button[data-font-scale="1.1"]').click();await prefs.locator('#ucSettingsPanel button[data-motion="off"]').click();
  await prefs.locator('#ucSettingsPanel button[data-gallery-columns="5"]').click();await prefs.locator('#ucSettingsPanel button[data-default-sort="latest"]').click();
  await prefs.locator('#ucSettingsPanel button[data-export-scale="0.25"]').click();await prefs.locator('#prefExportQuality').selectOption('80');
  await page.waitForFunction(()=>document.documentElement.dataset.motion==='off');
  assert.equal(await output.getByRole('combobox',{name:'格式',exact:true}).inputValue(),'png');assert.equal(await output.getByRole('combobox',{name:'导出尺寸',exact:true}).inputValue(),'0.5');
  await button(output,'取消').click();await page.locator('#image-input').setInputFiles({...file,name:'synthetic-b.png'});await ready(page);await button(page,'导出照片').click();
  assert.equal(await output.getByRole('combobox',{name:'格式',exact:true}).inputValue(),'jpg');assert.equal(await output.getByRole('combobox',{name:'导出尺寸',exact:true}).inputValue(),'0.25');assert.equal(await output.getByRole('slider',{name:'导出质量',exact:true}).inputValue(),'80');
  await button(output,'取消').click();await page.getByRole('tab',{name:'切换到 synthetic-a.png',exact:true}).click();await ready(page);await button(page,'导出照片').click();
  assert.equal(await output.getByRole('combobox',{name:'格式',exact:true}).inputValue(),'png');assert.equal(await output.getByRole('combobox',{name:'导出尺寸',exact:true}).inputValue(),'0.5');await button(output,'取消').click();
  await prefs.reload({waitUntil:'networkidle'});await checkOrdinaryClick();
  const cover=(await(await page.request.post(base+'/api/upload',{multipart:{file}})).json()).url;
  const publish=async(account,name,category)=>{const r=await page.request.post(base+'/api/recipes',{headers:{Authorization:'Bearer '+account.token},data:{recipe:{version:1,name,category,cover_before:cover,steps:[]}}});assert.equal(r.status(),201);return(await r.json()).recipe;};
  await publish(owner,'Shared Lake','Lake');const forest=await publish(owner,'Shared Forest','Forest');await publish(owner,'Other Own','Forest');const foreign=await publish(peer,'Shared Peer','Peer');await publish(peer,'Other Peer','Peer');
  for(const recipe of [forest,foreign])await page.request.post(base+'/api/recipes/'+recipe.id+'/favorite',{headers});
  await prefs.locator('#search').fill('Shared');await prefs.locator('#search').press('Enter');await prefs.waitForFunction(()=>document.querySelectorAll('#grid .card').length===3);
  await prefs.locator('#authUserBtn').hover();await button(prefs,'用户中心').click();await prefs.locator('[data-uc-view="mine"]').click();
  await prefs.locator('#workSearch').fill('Shared');await prefs.waitForFunction(()=>document.querySelectorAll('#grid .card').length===2);await prefs.locator('#workCategory').selectOption('Lake');await prefs.waitForFunction(()=>document.querySelectorAll('#grid .card').length===1);
  assert.equal(await prefs.locator('#grid .card-title').innerText(),'Shared Lake');
  await prefs.locator('[data-uc-view="favorites"]').click();await prefs.waitForFunction(()=>document.querySelectorAll('#grid .card').length===2);
  await prefs.locator('#workCategory').selectOption('Peer');await prefs.waitForFunction(()=>document.querySelectorAll('#grid .card').length===1);assert.equal(await prefs.locator('#grid .card-title').innerText(),'Shared Peer');
  await prefs.locator('#workSearch').fill('missing-fixture');await prefs.getByText('没有找到匹配的收藏作品。',{exact:true}).waitFor();
  await prefs.locator('[data-uc-view="profile"]').click();await prefs.locator('#authorPage').waitFor();
  await prefs.locator('#search').fill('Shared Peer');await prefs.locator('#search').press('Enter');await prefs.locator('#authorWorkCount').filter({hasText:'找到 0 件作品'}).waitFor();
  assert.equal(new URL(prefs.url()).searchParams.get('author_search'),'Shared Peer');await prefs.locator('#search').fill('');await prefs.locator('#search').press('Enter');await prefs.locator('#authorWorkCount').filter({hasText:'3 件公开作品'}).waitFor();
  await prefs.locator('#authorBack').click();await prefs.locator('#grid .card').first().waitFor();assert.equal(await prefs.locator('#search').inputValue(),'Shared');
  let release,arrive,releaseProfile,arriveProfile,finishProfile,held=false;
  const gate=new Promise(r=>release=r),arrived=new Promise(r=>arrive=r),profileGate=new Promise(r=>releaseProfile=r),profileArrived=new Promise(r=>arriveProfile=r),profileFinished=new Promise(r=>finishProfile=r),updates=[];
  await prefs.route('**/api/users/me',async route=>{
   if(route.request().method()==='GET'&&!held){held=true;const response=await route.fetch();arriveProfile();await profileGate;await route.fulfill({response});finishProfile();return;}
   if(route.request().method()!=='PUT')return route.continue();updates.push(route.request().postDataJSON());if(updates.length===1){arrive();await gate;}await route.continue();
  });
  await prefs.locator('#authUserBtn').hover();await button(prefs,'用户中心').click();await prefs.locator('[data-uc-view="settings"]').click();await profileArrived;
  await prefs.locator('[data-privacy-field="show_bio"]').click();await arrived;await prefs.locator('[data-privacy-field="show_location"]').click();assert.equal(updates.length,1);release();
  await prefs.waitForFunction(()=>['show_bio','show_location'].every(k=>document.querySelector('[data-privacy-field="'+k+'"]').getAttribute('aria-pressed')==='false'));
  assert.deepEqual(updates,[{show_bio:false},{show_location:false}]);releaseProfile();await profileFinished;
  await prefs.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.deepEqual(await prefs.locator('[data-privacy-field]').evaluateAll(els=>els.slice(0,2).map(e=>e.getAttribute('aria-pressed'))),['false','false']);
  await prefs.unroute('**/api/users/me');
  await prefs.locator('[data-privacy-field="show_stats"]').click();await prefs.waitForFunction(()=>document.querySelector('[data-privacy-field="show_stats"]').getAttribute('aria-pressed')==='false');
  const publicUser=(await(await page.request.get(base+'/api/users/'+owner.user.id)).json()).user;assert.equal(publicUser.bio,'');assert.equal(publicUser.location,'');assert.equal(publicUser.stats_hidden,true);
  const privateUser=(await(await page.request.get(base+'/api/users/me',{headers})).json()).user;assert.equal(privateUser.bio,'Synthetic biography');
  await prefs.setViewportSize({width:390,height:844});assert.ok(await prefs.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await prefs.screenshot({path:folder+'/settings-mobile.png'});
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
}

async function inPlaceAuthentication(browser,base,folder){
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  const email='auth@example.test',account=await(await page.request.post(base+'/__test/register',{data:{username:'synthetic-auth',email}})).json(),headers={Authorization:'Bearer '+account.token};let messages;
  await observe(page);await page.goto(base+'/');await button(page,'编辑器').click();await page.locator('#image-input').setInputFiles(await syntheticImage(page));await ready(page);
  await page.locator('#basic-group>summary').click();await page.locator('#exposure-value').fill('0.50');await page.locator('#exposure-value').press('Enter');await ready(page);
  const state=await readRecipe(page),image=await pixels(page);assert.equal(await button(page,'撤销').isEnabled(),true);
  await button(page,'登录 / 注册').click();let ui=authFrame(page);await ui.locator('#authModal').waitFor();await ui.locator('#authModal [data-close]').click();await page.locator('.auth-frame-overlay').waitFor({state:'hidden'});assert.deepEqual(await readRecipe(page),state);
  await button(page,'登录 / 注册').click();ui=authFrame(page);await ui.locator('#authUser').fill('synthetic-auth');await ui.locator('#authPass').fill('synthetic-only');
  await ui.locator('#authPassToggle').click();assert.equal(await ui.locator('#authPass').getAttribute('type'),'text');await ui.locator('#authPassToggle').click();assert.equal(await ui.locator('#authPass').getAttribute('type'),'password');
  await ui.locator('#authSubmit').click();await page.locator('.user-chip').waitFor();await page.locator('.auth-frame-overlay').waitFor({state:'hidden'});await ready(page);assert.deepEqual(await readRecipe(page),state);assert.equal(await pixels(page),image);
  await button(page,'撤销').click();await ready(page);assert.notDeepEqual(await readRecipe(page),state);await button(page,'重做').click();await ready(page);assert.deepEqual(await readRecipe(page),state);
  await page.locator('.user-chip').hover();await page.getByRole('menuitem',{name:'退出登录',exact:true}).click();await button(page,'登录 / 注册').click();ui=authFrame(page);
  await ui.locator('#authForgotToggle').click();await ui.locator('#authResetEmail').fill(email);await captcha(ui,'authResetCaptcha');await ui.locator('#authResetSendCode').click();await ui.locator('#toast').filter({hasText:'验证码已发送'}).waitFor({state:'visible'});
  messages=await(await page.request.get(base+'/__test/mailbox')).json();await ui.locator('#authResetCode').fill(messages.at(-1).html.match(/<strong>(\d{6})<\/strong>/)[1]);await ui.locator('#authResetPassword').fill('synthetic-new-password');
  await ui.locator('#authResetSubmit').click();await ui.locator('#authPasswordFields').waitFor();assert.equal(await ui.locator('#authUser').inputValue(),'synthetic-auth');assert.equal(await ui.locator('#authPass').inputValue(),'synthetic-new-password');assert.equal(await ui.locator('#authResetPassword').inputValue(),'');assert.equal(await ui.locator('#authResetCode').inputValue(),'');
  assert.equal((await page.request.get(base+'/api/auth/me',{headers})).status(),401);
  await ui.locator('#authModal').screenshot({path:folder+'/reset-return-login.png'});await ui.locator('#authSubmit').click();await page.locator('.user-chip').waitFor();await ready(page);assert.deepEqual(await readRecipe(page),state);assert.equal(await pixels(page),image);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
}

(async()=>{const browser=await chromium.launch();try{for(const prefix of ['', '/landscape']){
 const service=await start({prefix,fixture:'credits-browser-server.py'}),base=service.url.replace(/\/$/,''),folder='test-results/member-followup/'+(prefix?'prefix':'root');await fs.mkdir(folder,{recursive:true});
 try{await preferencesAndPrivacy(browser,base,folder);await inPlaceAuthentication(browser,base,folder);console.log('PASS '+(prefix||'/')+': scoped preference controls, per-photo export, scoped search, queued privacy and in-place login/reset preserve pixels/history');}
 finally{await service.stop();}
}}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
