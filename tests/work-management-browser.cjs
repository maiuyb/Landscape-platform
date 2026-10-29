/* Unified private management, with synthetic users/images and disposable storage only. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {start}=require('./isolated-browser-support.cjs');
(async()=>{
 const browser=await chromium.launch(),report=[],folder='test-results/work-management';await fs.mkdir(folder,{recursive:true});
 try{for(const prefix of ['', '/landscape']){
  const server=await start({prefix}),base=server.url.replace(/\/$/,''),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],escaped=[];
  page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{const url=new URL(request.url());if(prefix&&url.origin===new URL(base).origin&&/^\/(api|uploads)\//.test(url.pathname))escaped.push(url.pathname);});
  const frame=page.frameLocator('iframe'),child=()=>page.frames().find(f=>new URL(f.url()).pathname.endsWith('/community/'));
  try{
   const login=await(await page.request.post(base+'/api/auth/register',{data:{username:'synthetic-manager',password:'synthetic-only'}})).json(),headers={Authorization:'Bearer '+login.token};
   const other=await(await page.request.post(base+'/api/auth/register',{data:{username:'synthetic-foreign',password:'synthetic-only'}})).json();
   await context.addInitScript(login=>{localStorage.setItem('landscape:token',login.token);localStorage.setItem('landscape:user',JSON.stringify(login.user));},login);
   await page.goto(base+'/community/');
   const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=480;c.height=320;const x=c.getContext('2d');x.fillStyle='#78958a';x.fillRect(0,0,480,320);x.fillStyle='#335e4a';x.beginPath();x.moveTo(0,320);x.lineTo(220,40);x.lineTo(480,320);x.fill();return c.toDataURL().split(',')[1];});
   const cover=(await(await page.request.post(base+'/api/upload',{headers,multipart:{file:{name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')}}})).json()).url;
   const create=async(name,auth=headers)=>(await(await page.request.post(base+'/api/recipes',{headers:auth,data:{recipe:{version:1,name,cover_before:cover,steps:[]}}})).json()).recipe;
   for(let i=0;i<51;i++)await create('合成作品 '+String(i).padStart(2,'0'));
   for(let i=0;i<21;i++){const work=await create('已删除合成作品 '+i);assert.equal((await page.request.delete(base+'/api/recipes/'+work.id,{headers})).status(),200);}
   const foreign=await create('不属于本人的作品',{Authorization:'Bearer '+other.token});await page.request.delete(base+'/api/recipes/'+foreign.id,{headers:{Authorization:'Bearer '+other.token}});
   await page.goto(base+'/');await page.locator('.user-chip').hover();await page.getByRole('menuitem',{name:'用户中心',exact:true}).click();await frame.locator('[data-uc-view="mine"]').click();
   await child().waitForFunction(()=>document.querySelectorAll('#grid .card').length===50);
   assert.equal(await frame.locator('.uc-nav [data-uc-view="mine"]').innerText(),'我的作品');assert.equal(await frame.locator('.uc-nav [data-uc-view="records"]').count(),0);
   assert.deepEqual(await frame.locator('.work-management-tabs button').allTextContents(),['已发布作品','发布记录','删除找回']);
   assert.ok((await frame.locator('#workManagementStatus').innerText()).includes('51 件已发布作品'));
   await frame.locator('#nextPage').click();await child().waitForFunction(()=>document.querySelectorAll('#grid .card').length===1);
   const deletionRequests=[];page.on('request',request=>{if(request.method()==='DELETE'&&/\/api\/recipes\/\d+$/.test(new URL(request.url()).pathname))deletionRequests.push(request.url());});
   page.once('dialog',dialog=>dialog.dismiss());await frame.locator('.card-del').click();assert.equal(deletionRequests.length,0);assert.equal(await frame.locator('#grid .card').count(),1);
   page.once('dialog',dialog=>{assert.ok(dialog.message().includes('7 天'));assert.ok(dialog.message().includes('我的作品 → 删除找回'));dialog.accept();});await frame.locator('.card-del').click();await child().waitForFunction(()=>document.querySelectorAll('#grid .card').length===50);assert.equal(await frame.locator('#pagination').isVisible(),false);
   await frame.locator('[data-display-mode="gallery"]').click();await child().waitForFunction(()=>document.querySelectorAll('#grid .gallery-owned').length===50);assert.equal(await frame.locator('#grid .gallery-del').count(),50);assert.equal(await frame.locator('#grid button button').count(),0);
   page.once('dialog',dialog=>dialog.accept());await frame.locator('.gallery-del').first().click();await child().waitForFunction(()=>document.querySelectorAll('#grid .gallery-card').length===49);assert.equal(await frame.locator('#detailModal').isVisible(),false);
   for(const width of [320,390,1440]){await page.setViewportSize({width,height:1000});assert.equal(await child().evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
   await page.screenshot({path:`${folder}/${prefix?'prefix':'root'}-published.png`});

   await frame.locator('[data-work-view="records"]').click();await child().waitForFunction(()=>document.querySelectorAll('#records .record').length===20);assert.ok((await frame.locator('#workManagementStatus').innerText()).includes('72 条发布记录'));
   await frame.locator('#pageNumbers [data-page="4"]').click();await child().waitForFunction(()=>document.querySelectorAll('#records .record').length===12);
   await frame.locator('.rec-view').first().click();await frame.locator('#detailModal').waitFor({state:'visible'});
   page.once('dialog',dialog=>{assert.ok(dialog.message().includes('我的作品 → 删除找回'));dialog.accept();});await frame.locator('#dDel').click();await frame.locator('#detailModal').waitFor({state:'hidden'});await frame.locator('#pageNumbers [data-page="4"].active').waitFor();await child().waitForFunction(()=>document.querySelectorAll('#records .record').length===12);

   await frame.locator('[data-work-view="deleted"]').click();await child().waitForFunction(()=>document.querySelectorAll('#records .record').length===20);assert.ok((await frame.locator('#workManagementStatus').innerText()).includes('24 条删除记录'));assert.equal(await frame.locator('.rec-del,.rec-view').count(),0);assert.equal(await frame.locator('.rec-restore').count(),20);assert.equal(await frame.getByText('不属于本人的作品',{exact:true}).count(),0);
   await frame.locator('#nextPage').click();await child().waitForFunction(()=>document.querySelectorAll('#records .record').length===4);
   await frame.locator('.rec-restore').first().click();await child().waitForFunction(()=>document.querySelectorAll('#records .record').length===3);assert.ok((await frame.locator('#workManagementStatus').innerText()).includes('23 条删除记录'));await frame.locator('#pageNumbers [data-page="2"].active').waitFor();
   const visible=await(await page.request.get(base+'/api/me/recipes',{headers})).json(),publicWorks=await(await page.request.get(base+'/api/recipes?author_id='+login.user.id)).json();assert.equal(visible.total,49);assert.equal(publicWorks.total,49);
   for(const count of [2,1,20]){await frame.locator('.rec-restore').first().click();await child().waitForFunction(count=>document.querySelectorAll('#records .record').length===count,count);}
   assert.equal(await child().evaluate(()=>state.recPage),1);assert.equal(await frame.locator('#pagination').isVisible(),false);assert.ok((await frame.locator('#workManagementStatus').innerText()).includes('20 条删除记录'));
   for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});assert.equal(await child().evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(width===390)await page.screenshot({path:`${folder}/${prefix?'prefix':'root'}-deleted-mobile.png`});}
   await page.setViewportSize({width:1440,height:1000});await frame.locator('[data-work-view="mine"]').click();await child().waitForFunction(()=>document.querySelectorAll('#grid .gallery-card').length===50);assert.ok((await frame.locator('#workManagementStatus').innerText()).includes('52 件已发布作品'));

   await page.route('**/api/me/uploads?*',route=>route.fulfill({status:503,json:{error:'synthetic network failure'}}));await frame.locator('[data-work-view="records"]').click();await frame.locator('#workManagementRetry').waitFor({state:'visible'});await page.unroute('**/api/me/uploads?*');await frame.locator('#workManagementRetry').click();await frame.locator('#records .record').first().waitFor();assert.equal(await frame.locator('#workManagementRetry').isVisible(),false);
   await frame.locator('[data-uc-view="profile"]').click();await frame.locator('#authorHeading').waitFor();await frame.locator('#authorWorks .author-work').first().waitFor();assert.ok((await frame.locator('#authorWorkCount').innerText()).includes('52 件公开作品'));assert.equal(await frame.locator('#workManagement').isVisible(),false);
   assert.deepEqual(errors,[]);assert.deepEqual(escaped,[]);
   report.push({prefix:prefix||'/',checks:['one My Works entry and published/records/recovery sections','cancel is read-only; unified deletion in card/gallery/detail','last published page clamps after deletion; record page preserved','deleted-only server pagination; recovery restores public visibility','private ownership, network retry, 320–1440 layout and author page return']});
  }catch(error){await page.screenshot({path:folder+'/failure.png'}).catch(()=>{});throw error;}finally{await context.close();await server.stop();}
 }}finally{await browser.close();}
 await fs.writeFile(folder+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
