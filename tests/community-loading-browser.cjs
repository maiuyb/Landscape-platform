/* Controlled slow/failed downloads: real community DOM and scheduler, no external services. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const {start} = require('./isolated-browser-support.cjs');

(async () => {
  const browser = await chromium.launch();
  try {
    for (const prefix of ['', '/landscape']) {
      const server = await start({prefix});
      const context = await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:2});
      const page = await context.newPage();
      let releaseSlow;
      const held = new Promise(resolve => {releaseSlow = resolve;});
      let running = 0, maximum = 0, originals = 0;
      const requested = new Set(), attempts = new Map(), errors = [];
      page.on('pageerror',error=>errors.push(error.message));
      try {
        const png = Buffer.from(await page.evaluate(() => {
          const c=document.createElement('canvas');c.width=1200;c.height=800;
          c.getContext('2d').fillStyle='#315c73';c.getContext('2d').fillRect(0,0,c.width,c.height);
          return c.toDataURL().split(',')[1];
        }), 'base64');
        const recipes = Array.from({length:50},(_,id)=>({id:id+1,name:'Synthetic '+id,tags:[],favorite_count:0,
          cover_before:prefix+'/uploads/synthetic-'+id+'.png',cover_after:'',steps:[]}));
        await page.route('**/api/recipes**',route=>{
          const path=new URL(route.request().url()).pathname;
          return route.fulfill({json:path.endsWith('/categories')?{categories:[]}:
            path.endsWith('/recommend')?{recipes:recipes.slice(0,6)}:
            /\/recipes\/\d+$/.test(path)?{recipe:recipes[Number(path.split('/').pop())-1]}:
            {recipes,total:50,has_more:false}});
        });
        await page.route('**/uploads/**',route=>{originals++;return route.fulfill({contentType:'image/png',body:png});});
        await page.route('**/api/thumb/**',async route=>{
          const url=new URL(route.request().url()),id=Number(url.pathname.match(/synthetic-(\d+)/)[1]);
          const key=url.pathname+url.search, count=(attempts.get(key)||0)+1;attempts.set(key,count);
          requested.add(id);running++;maximum=Math.max(maximum,running);
          try {
            if(id===0)await held;
            else await new Promise(resolve=>setTimeout(resolve,80));
            if(id===3 || (id===2&&count===1))await route.fulfill({status:503,body:'synthetic transient failure'});
            else await route.fulfill({contentType:'image/png',body:png});
          } finally {running--;}
        });
        await page.goto(server.url.replace(/\/$/,'')+'/community/');
        await page.locator('#recommend img').first().scrollIntoViewIfNeeded();
        await page.waitForFunction(()=>document.querySelectorAll('#recommend img[data-image-status="ready"]').length>=2);
        assert.equal(await page.locator('#recommend img').first().getAttribute('data-image-status'),'loading');
        assert.ok(maximum<=4,'Too many parallel downloads: '+maximum);
        assert.equal(requested.has(49),false,'Far-offscreen image was downloaded');
        releaseSlow();
        await page.waitForFunction(()=>document.querySelectorAll('#recommend img[data-image-status="ready"]').length===5&&
          document.querySelectorAll('#recommend img[data-image-status="failed"]').length===1);
        assert.equal(originals,0,'A failed thumbnail downloaded the original');
        assert.ok([...attempts.values()].every(count=>count<=3),'Retry count is not bounded');
        const first=page.locator('#grid img').first();await first.scrollIntoViewIfNeeded();
        await page.waitForFunction(()=>document.querySelector('#grid img')?.dataset.imageStatus==='ready');
        const sizes=await first.evaluate(img=>[parseInt(img.sizes),Math.ceil(img.getBoundingClientRect().width)]);
        assert.deepEqual(sizes.slice(0,1),sizes.slice(1),'Source size ignores actual card width');
        await page.locator('#grid .card-title').first().click();
        await page.waitForFunction(()=>document.querySelector('#detailModal .detail-img')?.dataset.imageStatus==='ready');
        assert.equal(originals,0,'Detail view downloaded a full-size original');
        await page.locator('#detailModal .detail-img').click();
        await page.locator('#imageLightbox').waitFor({state:'visible'});
        await page.waitForFunction(()=>document.querySelector('#lightboxImage')?.naturalWidth>0);
        assert.equal(originals,1,'Explicit full-size view should fetch the original');
        await page.locator('#lightboxClose').click();await page.locator('#detailModal [data-close]').click();
        await page.locator('#grid .card').last().scrollIntoViewIfNeeded();
        await page.waitForFunction(()=>document.querySelector('#grid .card:last-child img')?.dataset.imageStatus==='ready');
        assert.ok(requested.has(49),'Scrolling did not activate the next images');
        assert.deepEqual(errors,[]);assert.ok(maximum<=4);
        console.log(`PASS ${prefix||'/'}: viewport priority, <=4 downloads, slow image isolation, bounded retry, no full-size fallback, measured sizing, explicit original and scrolling`);
      } finally {releaseSlow();await context.close();await server.stop();}
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
