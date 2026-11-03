/* Recommendation covers must have enough pixels after portrait object-fit cropping. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const {start} = require('./isolated-browser-support.cjs');

(async () => {
  const browser = await chromium.launch();
  const folder = 'test-results/community-recommendation-images';
  await fs.mkdir(folder, {recursive: true});
  try {
    for (const prefix of ['', '/landscape']) {
      const server = await start({prefix});
      const base = server.url.replace(/\/$/, '') + '/';
      const setup = await browser.newPage();
      try {
        await setup.goto(base + 'community/');
        const photos = await setup.evaluate(() => [[2400, 1080], [1600, 1000], [1000, 1600]].map(([width, height]) => {
          const c = document.createElement('canvas'); c.width = width; c.height = height;
          const ctx = c.getContext('2d');
          for (let y = 0; y < height; y += 8) for (let x = 0; x < width; x += 8) {
            ctx.fillStyle = (x + y) % 16 ? '#e5c68d' : '#315c72'; ctx.fillRect(x, y, 8, 8);
          }
          return c.toDataURL('image/png').split(',')[1];
        }));
        const recipes = [];
        for (const [i, photo] of photos.entries()) {
          const response = await setup.request.post(base + 'api/upload', {multipart: {
            file: {name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64')},
          }});
          assert.equal(response.status(), 200);
          recipes.push({id: i + 1, name: ['Panorama', 'Landscape', 'Portrait'][i],
            cover_before: (await response.json()).url, favorite_count: 0, tags: []});
        }
        for (const {width, height, dpr} of [{width: 1920, height: 1080, dpr: 1}, {width: 1440, height: 1000, dpr: 2}, {width: 390, height: 844, dpr: 2}]) {
          const context = await browser.newContext({viewport: {width, height}, deviceScaleFactor: dpr});
          const page = await context.newPage();
          try {
            await page.route('**/api/recipes/recommend', r => r.fulfill({json: {recipes}}));
            await page.goto(base + 'community/');
            await page.locator('#recommend img').first().scrollIntoViewIfNeeded();
            await page.waitForFunction(() => document.querySelectorAll('#recommend img').length === 3 &&
              [...document.querySelectorAll('#recommend img')].every(i => i.complete && i.naturalWidth));
            const dimensions = await page.locator('#recommend img').evaluateAll(images => images.map(i => {
              const r = i.getBoundingClientRect();
              return {name: i.alt, source: new URL(i.currentSrc).pathname,
                scale: Math.max(r.width / i.naturalWidth, r.height / i.naturalHeight) * devicePixelRatio};
            }));
            for (const image of dimensions) {
              assert.ok(image.source.startsWith(prefix + '/api/thumb/'), JSON.stringify(image));
              assert.ok(image.scale <= 1, 'Cover would upscale its image pixels: ' + JSON.stringify({width, dpr, ...image}));
            }
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            await page.screenshot({path: `${folder}/${prefix ? 'prefix' : 'root'}-${width}-${dpr}x.png`});
          } finally { await context.close(); }
        }
      } finally { await setup.close(); await server.stop(); }
    }
  } finally { await browser.close(); }
  console.log('PASS: panorama/landscape/portrait recommendation covers stay sharp at desktop, HiDPI and mobile widths, under both prefixes.');
})().catch(error => {console.error(error); process.exitCode = 1;});
