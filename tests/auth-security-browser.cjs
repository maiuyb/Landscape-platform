/* Registration, email and failure-triggered image challenges on real UI. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {start}=require('./isolated-browser-support.cjs');
(async()=>{
 const browser=await chromium.launch(),folder='test-results/auth-security';await fs.mkdir(folder,{recursive:true});
 try{for(const prefix of ['', '/landscape']){
  const service=await start({prefix,fixture:'credits-browser-server.py'}),base=service.url.replace(/\/$/,''),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(base+(prefix?'/':'/community/'));
   let ui=page;
   if(prefix){await page.getByRole('button',{name:'登录 / 注册',exact:true}).click();ui=page.frameLocator('iframe');}else await page.locator('#loginBtn').click();
   await ui.locator('#authToggle').click();await ui.locator('#authEmailBox').waitFor({state:'visible'});
   await ui.locator('#authUser').fill('synthetic-new');await ui.locator('#authPass').fill('synthetic-password');await ui.locator('#authEmailInput').fill('new@example.test');
   await ui.locator('#authEmailCaptchaRefresh').waitFor({state:'visible'});await ui.locator('#authEmailCaptchaImage').evaluate(img=>new Promise((resolve,reject)=>{if(img.complete&&img.naturalWidth)return resolve();img.onload=resolve;img.onerror=reject;}));
   await ui.locator('#authEmailCaptchaAnswer').fill('AAAAA');await ui.locator('#authSendCodeBtn').click();
   await ui.getByText('验证码已发送，请在 10 分钟内输入。',{exact:true}).waitFor();
   const mail=(await(await page.request.get(base+'/__test/mailbox')).json()).at(-1);await ui.locator('#authEmailCode').fill(mail.html.match(/<strong>(\d{6})<\/strong>/)[1]);
   await ui.locator('#authModal').screenshot({path:folder+'/'+(prefix?'prefix':'root')+'-registration.png'});
   assert.ok(await ui.locator('html').evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const waitSignedIn=()=>prefix?page.locator('.user-chip').waitFor():ui.locator('#authUserBtn').waitFor();
   await ui.locator('#authSubmit').click();await waitSignedIn();
   assert.equal(await ui.locator('body').evaluate(()=>JSON.parse(localStorage.getItem('landscape:user')).email_verified),true);
   if(prefix){await page.locator('.user-chip').hover();await page.getByRole('menuitem',{name:'退出登录',exact:true}).click();await page.getByRole('button',{name:'登录 / 注册',exact:true}).click();}
   else {await ui.locator('#authUserBtn').hover();await ui.locator('#logoutBtn').click();await ui.locator('#loginBtn').click();}
   await ui.locator('#authUser').fill('synthetic-new');await ui.locator('#authPass').fill('wrong');
   for(let i=0;i<5;i++){
    const response=page.waitForResponse(r=>r.url().endsWith('/api/auth/login')&&r.request().method()==='POST');await ui.locator('#authSubmit').click();await response;
    await ui.locator('#authSubmit').evaluate(el=>new Promise(resolve=>{const t=setInterval(()=>{if(!el.disabled){clearInterval(t);resolve();}},10);}));
   }
   await ui.locator('#authLoginCaptcha').waitFor({state:'visible'});await ui.locator('#authPass').fill('synthetic-password');await ui.locator('#authLoginCaptchaAnswer').fill('AAAAA');
   await ui.locator('#authModal').screenshot({path:folder+'/'+(prefix?'prefix':'root')+'-login-challenge.png'});
   await ui.locator('#authSubmit').click();await waitSignedIn();
   assert.deepEqual(errors,[]);console.log('PASS '+(prefix||'/')+': verified registration, mobile, login challenge and existing password sign-in');
  }finally{await context.close();await service.stop();}
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
