/* The opening curtain must reveal a photo even while both full-size assets are delayed. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const {start} = require('./isolated-browser-support.cjs');

(async () => {
  const browser = await chromium.launch(), folder = 'test-results/welcome-startup';
  await fs.mkdir(folder, {recursive: true});
  try {
    for (const prefix of ['', '/landscape']) {
      const server = await start({prefix}), context = await browser.newContext({viewport: {width: 1440, height: 1000}});
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let releaseOriginal, releaseAfter;
      const originalGate = new Promise(resolve => {releaseOriginal = resolve;});
      const afterGate = new Promise(resolve => {releaseAfter = resolve;});
      await page.route('**/assets/welcome/alpine-lake.jpg', async route => {await originalGate;await route.continue();});
      await page.route('**/assets/welcome/alpine-lake-after.jpg', async route => {await afterGate;await route.continue();});
      try {
        await page.goto(server.url.replace(/\/$/, '') + '/?intro=1', {waitUntil: 'domcontentloaded'});
        await page.locator('.hg-curtain-stage').waitFor({state: 'visible'});
        await page.locator('.hg-curtain-stage').waitFor({state: 'hidden'});
        const frame = page.locator('.welcome-comparison');
        await frame.scrollIntoViewIfNeeded();
        const preview = await frame.evaluate(async el => {
          const background = getComputedStyle(el).backgroundImage;
          const src = background.match(/^url\(["']?(data:image\/webp;base64,[^"')]+)["']?\)$/)?.[1];
          if (!src) return null;
          const image = new Image();image.src = src;await image.decode();
          return {width: image.naturalWidth, height: image.naturalHeight, visible: el.getBoundingClientRect().height > 0};
        });
        assert.deepEqual(preview, {width: 480, height: 320, visible: true});
        assert.equal(await frame.locator('img').first().evaluate(i => i.complete && i.naturalWidth > 0), false);
        assert.equal(await page.locator('.hero-edited').count(), 0);
        assert.equal(await frame.locator('.print-whisper-tag.right').isVisible(), false);
        await frame.screenshot({path: `${folder}/${prefix ? 'prefix' : 'root'}-preview.png`, animations: 'disabled'});

        releaseOriginal();
        await page.waitForFunction(() => {
          const original = document.querySelector('.welcome-comparison > img');
          return original?.complete && original.naturalWidth > 0;
        });
        assert.equal(await page.locator('.hero-edited').count(), 0, 'Original must be visible without waiting for after');
        await frame.screenshot({path: `${folder}/${prefix ? 'prefix' : 'root'}-original.png`, animations: 'disabled'});
        releaseAfter();
        await page.locator('img.hero-edited').waitFor({state: 'visible'});
        await page.waitForFunction(() => {
          const after = document.querySelector('img.hero-edited');return after.complete && after.naturalWidth > 0;
        });
        assert.equal(await page.getByRole('slider', {name: '拖动中央手柄对比作品显影前后效果', exact: true}).isVisible(), true);
        assert.equal(await frame.locator('.print-whisper-tag.right').isVisible(), true);
        assert.deepEqual(errors, []);
      } finally {releaseOriginal();releaseAfter();await context.close();await server.stop();}
    }
  } finally {await browser.close();}
  console.log('PASS: opening curtain finishes with inline photo visible; original appears before delayed after image; comparison activates when ready, under both prefixes.');
})().catch(error => {console.error(error);process.exitCode = 1;});
