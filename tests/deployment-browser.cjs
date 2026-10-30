/* Verify editor + embedded/standalone community behind a shared-site prefix. */
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {start}=require('./isolated-browser-support.cjs');
const {observe,readRecipe}=require('./editor-test-observer.cjs');
(async()=>{
 const server=await start({prefix:'/landscape'}),browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],escaped=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{const u=new URL(r.url());if(u.protocol==='http:'&&u.origin===new URL(server.url).origin&&!u.pathname.startsWith('/landscape/'))escaped.push(u.pathname);});
 const btn=name=>page.getByRole('button',{name,exact:true});
 const ready=()=>page.waitForFunction(()=>document.querySelector('#mainCanvas')?.dataset.previewStatus==='ready');
 try{
  assert.equal((await(await fetch(server.url+'api/health')).json()).status,'ok');
  await observe(page);
  await page.goto(server.url);await page.locator('.hero-edited').waitFor();
  await page.getByRole('button',{name:/先用示例试试看/}).click();await ready();
  await page.locator('#exposure').evaluate(e=>{e.value='.65';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));});await ready();
  assert.equal((await readRecipe(page)).version,6);
  await btn('分享到社区').click();await btn('准备发布').click();
  const frame=page.frameLocator('iframe');await frame.locator('#authModal').waitFor({state:'visible'});
  await frame.locator('#authToggle').click();await frame.locator('#authUser').fill('prefix-user');await frame.locator('#authPass').fill('synthetic-only');await frame.locator('#authSubmit').click();await frame.locator('#authModal').waitFor({state:'hidden'});
  await frame.locator('#pName').fill('部署往返');
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/recipes')&&r.request().method()==='POST');
  await frame.locator('#publishSubmit').click();const response=await pending;assert.equal(response.status(),201);const published=await response.json();
  for(const url of[published.recipe.cover_before,published.recipe.cover_after]){assert.match(url,/^\/landscape\/uploads\//);assert.equal((await fetch(new URL(url,server.url))).status,200);}
  await frame.locator('#publishModal').waitFor({state:'hidden'});await frame.locator(`.card-title[data-id="${published.id}"]`).click();await frame.locator('#dPreview').click();
  await btn('在我的照片上预览').click();await ready();await btn('取消预览').click();await ready();
  const standalone=await browser.newPage();standalone.on('pageerror',e=>errors.push(e.message));
  standalone.on('request',r=>{const u=new URL(r.url());if(u.protocol==='http:'&&u.origin===new URL(server.url).origin&&!u.pathname.startsWith('/landscape/'))escaped.push(u.pathname);});
  await standalone.goto(server.url+'community/');await standalone.locator(`.card-title[data-id="${published.id}"]`).waitFor();
  assert.deepEqual(escaped,[]);assert.deepEqual(errors,[]);
  console.log('PASS: prefixed assets, sample rendering, auth, two uploads, v6 publication, recipe preview/cancel and standalone community; no requests escape into the existing site');
 }finally{await browser.close();await server.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
