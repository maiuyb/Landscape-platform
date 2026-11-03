/* Fixed welcome comparisons: no editor rendering, decoded-pair reuse and safe async switches. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const {start} = require('./isolated-browser-support.cjs');

(async () => {
  const browser = await chromium.launch(), folder = 'test-results/welcome-images';
  await fs.mkdir(folder, {recursive: true});
  try {
    for (const prefix of ['', '/landscape']) {
      const server = await start({prefix}), context = await browser.newContext({viewport: {width: 1440, height: 1000}});
      const page = await context.newPage(), errors = [], requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {if (request.url().includes('/assets/welcome/')) requests.push(request.url());});
      await page.route('**/app.js', async route => {
        if (route.request().url().includes('/community/')) return route.continue();
        const response = await route.fetch();
        await route.fulfill({response, body: `window.__welcomeRenderCalls=0;
          {const render=EditorCore.render;EditorCore.render=(...args)=>{window.__welcomeRenderCalls++;return render(...args);};}
          ` + await response.text()});
      });
      let releaseSnow, snowRequested, failPanorama = true;
      const snowGate = new Promise(resolve => {releaseSnow = resolve;});
      const snowArrival = new Promise(resolve => {snowRequested = resolve;});
      await page.route('**/assets/welcome/gulmarg-snow-after.jpg', async route => {snowRequested();await snowGate;await route.continue();});
      await page.route('**/assets/welcome/alpine-panorama-after.jpg', route => failPanorama
        ? route.fulfill({status: 503, body: 'Synthetic asset failure'}) : route.continue());
      const button = name => page.getByRole('button', {name, exact: true});
      const pair = async key => {
        await page.waitForFunction(key => {
          const images = [...document.querySelectorAll('.welcome-comparison > img')];
          return images.length === 2 && images.every(i => i.complete && i.naturalWidth) &&
            images[0].src.endsWith('/' + key + '.jpg') && images[1].src.endsWith('/' + key + '-after.jpg') &&
            getComputedStyle(images[1]).display !== 'none';
        }, key);
      };
      try {
        await page.goto(server.url);await pair('alpine-lake');
        assert.equal(await page.locator('.welcome-comparison canvas').count(), 0);
        const slider = page.getByRole('slider', {name: '拖动中央手柄对比作品显影前后效果', exact: true});
        await slider.press('ArrowRight');assert.equal(await slider.getAttribute('aria-valuenow'), '55');
        assert.match(await page.locator('.hero-edited').evaluate(e => getComputedStyle(e).clipPath), /55%/);

        await button('Fig. 02 怀俄明孤峰').click();await pair('devils-tower');
        assert.equal(await page.locator('.hero-edited').evaluate(e => getComputedStyle(e).animationName), 'edition-optical-focus');
        await snowArrival;await button('Fig. 03 克什米尔雪杉').click();await pair('devils-tower');
        await button('Fig. 01 晨雾湖岸').click();await pair('alpine-lake');releaseSnow();
        await page.waitForResponse(r => r.url().endsWith('/gulmarg-snow-after.jpg'));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await pair('alpine-lake');
        await button('Fig. 03 克什米尔雪杉').click();await pair('gulmarg-snow');

        await button('在主展框对比').click();await page.getByRole('alert').filter({hasText: '示例图片暂时无法读取'}).waitFor();
        await pair('gulmarg-snow');failPanorama = false;
        await button('在主展框对比').click();await pair('alpine-panorama');
        assert.equal(await page.getByRole('alert').count(), 0);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const before = requests.length;
        for (const [name, key] of [['Fig. 01 晨雾湖岸', 'alpine-lake'], ['Fig. 02 怀俄明孤峰', 'devils-tower'], ['Fig. 03 克什米尔雪杉', 'gulmarg-snow'], ['Fig. 01 晨雾湖岸', 'alpine-lake']]) {
          await button(name).click();await pair(key);
        }
        assert.equal(requests.length, before, 'Decoded pairs should be reused without new image requests');
        assert.equal(await page.evaluate(() => window.__welcomeRenderCalls), 0);
        await page.setViewportSize({width: 390, height: 844});await button('Fig. 02 怀俄明孤峰').click();await pair('devils-tower');
        await page.waitForFunction(() => !document.querySelector('.welcome-comparison').classList.contains('edition-switching'));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.deepEqual(errors, []);
        await page.screenshot({path: `${folder}/${prefix ? 'prefix' : 'root'}-mobile.png`});
      } finally {releaseSnow();await context.close();await server.stop();}
    }
  } finally {await browser.close();}
  console.log('PASS: static before/after pairs, retained animation/slider, no rendering, cache reuse, latest selection, failed-asset retry and mobile/prefix layouts.');
})().catch(error => {console.error(error);process.exitCode = 1;});
