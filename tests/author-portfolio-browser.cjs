/* Public portfolios: disposable service, synthetic users/artworks, no real AI or data. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { start } = require('./isolated-browser-support.cjs');
const {observe,previewRecipe}=require('./editor-test-observer.cjs');

(async () => {
  const browser = await chromium.launch(), report = [], folder = 'test-results/author-portfolio';
  await fs.mkdir(folder, { recursive: true });
  try {
    for (const prefix of ['', '/landscape']) {
      const server = await start({ prefix }), base = server.url.replace(/\/$/, '');
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage(), errors = [], escaped = [];
      await observe(page);page.setDefaultTimeout(12000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        const url = new URL(request.url());
        if (prefix && url.origin === new URL(base).origin && /^\/(api|uploads)\//.test(url.pathname)) escaped.push(url.pathname);
      });
      const child = () => page.frames().find(frame => new URL(frame.url()).pathname.endsWith('/community/'));
      const frame = page.frameLocator('iframe');
      try {
        const author = await (await page.request.post(base + '/__test/register', { data: { username: 'synthetic-photographer', password: 'synthetic-only' } })).json();
        const other = await (await page.request.post(base + '/__test/register', { data: { username: 'synthetic-visitor', password: 'synthetic-only' } })).json();
        const headers = { Authorization: 'Bearer ' + author.token };
        await page.goto(base + '/community/');
        const png = await page.evaluate(() => {
          const c = document.createElement('canvas'); c.width = 720; c.height = 480;
          const ctx = c.getContext('2d'), g = ctx.createLinearGradient(0, 0, 0, 480);
          g.addColorStop(0, '#c5d5d2'); g.addColorStop(1, '#334e43'); ctx.fillStyle = g; ctx.fillRect(0, 0, 720, 480);
          ctx.fillStyle = '#648477'; ctx.beginPath(); ctx.moveTo(0, 400); ctx.lineTo(260, 100); ctx.lineTo(720, 480); ctx.fill();
          return c.toDataURL().split(',')[1];
        });
        const file = { name: 'synthetic-landscape.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') };
        const uploaded = await (await page.request.post(base + '/api/upload', { headers, multipart: { file } })).json();
        await page.request.put(base + '/api/users/me', { headers, data: { display_name: '山间来信', bio: '记录山川与四季的光。\n<script>仅为合成文字，不执行</script>', location: '合成城市', avatar: uploaded.url } });
        const ids = [];
        for (let i = 0; i < 53; i++) {
          const created = await page.request.post(base + '/api/recipes', { headers, data: { recipe: { version: 1, name: '合成风景 ' + String(i).padStart(2, '0'), cover_before: uploaded.url, steps: [] } } });
          assert.equal(created.status(), 201); ids.push((await created.json()).recipe.id);
        }
        await page.request.post(`${base}/api/recipes/${ids[0]}/favorite`, { headers: { Authorization: 'Bearer ' + other.token } });
        const link = `${base}/?author=${author.user.id}`;
        await page.goto(link);
        await frame.locator('#authorHeading').filter({ hasText: '山间来信' }).waitFor();
        await frame.locator('#authorWorks .author-work').first().waitFor();
        await page.waitForFunction(() => document.title.includes('山间来信的作品集'));
        assert.equal(await frame.locator('#authorWorks .author-work').count(), 24);
        assert.equal(await frame.locator('#authorEdit').isVisible(), false);
        assert.equal(await frame.locator('#authorManage').isVisible(), false);
        assert.equal(await frame.locator('#ucAccountPanel').isVisible(), false);
        assert.ok((await frame.locator('.public-profile-bio').last().innerText()).includes('<script>'));
        assert.equal(await frame.locator('#authorHeader script').count(), 0);
        await child().waitForFunction(() => [...document.querySelectorAll('#authorWorks img')].slice(0,3).every(img => img.complete && img.naturalWidth > 0));
        await page.screenshot({ path: `${folder}/${prefix ? 'prefix' : 'root'}-desktop.png` });

        await frame.locator('#authorSort').selectOption('favorites');
        await child().waitForFunction(id => document.querySelector('#authorWorks .author-work')?.dataset.workId === String(id), ids[0]);
        await page.waitForURL(url => url.searchParams.get('author_sort') === 'favorites');
        await frame.locator('#authorPagination [data-author-page="2"]').first().click();
        await page.waitForURL(url => url.searchParams.get('author_page') === '2');
        await frame.locator('#authorPagination [aria-current="page"]').filter({ hasText: '2' }).waitFor();
        const secondPage = await frame.locator('#authorWorks .author-work').first().getAttribute('data-work-id');
        await frame.locator('#authorPagination [data-author-page="3"]').first().click();
        await child().waitForFunction(() => document.querySelectorAll('#authorWorks .author-work').length === 5);
        await page.reload();
        await child().waitForFunction(() => document.querySelectorAll('#authorWorks .author-work').length === 5);
        assert.equal(await frame.locator('#authorSort').inputValue(), 'favorites');
        await page.goBack();
        await frame.locator('#authorPagination [aria-current="page"]').filter({ hasText: '2' }).waitFor();
        assert.equal(await frame.locator('#authorWorks .author-work').first().getAttribute('data-work-id'), secondPage);
        await page.goForward();
        await child().waitForFunction(() => document.querySelectorAll('#authorWorks .author-work').length === 5);
        await frame.locator('#authorWorks .author-work').first().click();
        await frame.locator('#detailModal').waitFor({ state: 'visible' });
        await frame.locator('#detailModal [data-close]').click();
        assert.equal(await frame.locator('#authorWorks .author-work').count(), 5);
        await child().evaluate(() => { copyText = async () => { throw Error('synthetic clipboard unavailable'); }; });
        await frame.locator('#authorShare').click();
        const shared = await frame.locator('#authorShareUrl').inputValue();
        assert.equal(new URL(shared).pathname, prefix + '/');
        assert.equal(new URL(shared).searchParams.get('author'), String(author.user.id));
        assert.equal(new URL(shared).searchParams.get('author_page'), '3');
        assert.ok(!/token|password/.test(shared));

        for (const width of [320, 390, 768, 1920]) {
          await page.setViewportSize({ width, height: 1000 });
          await frame.locator('#authorHeading').scrollIntoViewIfNeeded();
          assert.equal(await child().evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          if (width === 390) await page.screenshot({ path: `${folder}/${prefix ? 'prefix' : 'root'}-mobile.png` });
        }

        // Standalone links and history use the same public route without host messaging.
        await page.goto(`${base}/community/?author=${author.user.id}&author_page=3`);
        await page.locator('#authorHeading').filter({ hasText: '山间来信' }).waitFor();
        await page.waitForFunction(() => document.querySelectorAll('#authorWorks .author-work').length === 5);
        await page.locator('#authorSort').selectOption('favorites');
        await page.waitForFunction(() => document.querySelectorAll('#authorWorks .author-work').length === 24);
        await page.goBack();
        await page.waitForFunction(() => document.querySelectorAll('#authorWorks .author-work').length === 5);
        await page.goto(`${base}/community/?author=${other.user.id}`);
        await page.locator('#authorStatus').filter({ hasText: '还没有公开作品' }).waitFor();
        await page.locator('#search').fill('合成风景 00');
        await page.locator('#search').press('Enter');
        await page.locator('#grid .card-title').filter({ hasText: '合成风景 00' }).waitFor();
        assert.equal(await page.locator('#authorPage').isVisible(), false);
        assert.equal(new URL(page.url()).searchParams.has('author'), false);
        await page.goto(`${base}/community/?author=9999999`);
        await page.locator('#authorRetry').waitFor({ state: 'visible' });
        assert.ok((await page.locator('#authorStatus').innerText()).includes('作者不存在'));
        await page.locator('#authorBack').click();
        await page.locator('#grid .card').first().waitFor();

        await page.route('**/api/recipes?author_id=*', route => route.fulfill({ status: 503, json: { error: 'synthetic network failure' } }));
        await page.evaluate(id => { void openPublicProfile(id); }, author.user.id);
        await page.locator('#authorRetry').waitFor({ state: 'visible' });
        assert.ok((await page.locator('#authorStatus').innerText()).includes('作品暂时加载失败'));
        await page.unroute('**/api/recipes?author_id=*');
        await page.locator('#authorRetry').click();
        await page.locator('#authorWorks .author-work').first().waitFor();
        assert.equal(await page.locator('#authorRetry').isVisible(), false);
        await page.locator('#authorBack').click();

        // A late profile response must not take over a different author or the community.
        let release, arrived, finished;
        const gate = new Promise(resolve => release = resolve), requestArrived = new Promise(resolve => arrived = resolve), requestFinished = new Promise(resolve => finished = resolve);
        await page.route(`**/api/users/${author.user.id}`, async route => { const response = await route.fetch(); arrived(); await gate; await route.fulfill({ response }); finished(); });
        await page.evaluate(id => { void openPublicProfile(id); }, author.user.id);
        await requestArrived;
        await page.evaluate(id => { void openPublicProfile(id); }, other.user.id);
        await page.locator('#authorHeading').filter({ hasText: 'synthetic-visitor' }).waitFor();
        release(); await requestFinished;
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.locator('#authorHeading').innerText(), 'synthetic-visitor');
        await page.unroute(`**/api/users/${author.user.id}`);

        await page.evaluate(login => { localStorage.setItem('landscape:token', 'synthetic-expired'); localStorage.setItem('landscape:user', JSON.stringify(login.user)); }, author);
        await page.goto(`${base}/community/?author=${author.user.id}`);
        await page.locator('#loginBtn').waitFor({ state: 'visible' });
        await page.locator('#authorWorks .author-work').first().waitFor();
        assert.equal(await page.locator('#authorEdit').isVisible(), false);
        assert.equal(await page.locator('#authorPage').isVisible(), true);

        // Personal landing page shows the portfolio first. Editing reuses the existing form.
        await page.evaluate(login => { localStorage.setItem('landscape:token', login.token); localStorage.setItem('landscape:user', JSON.stringify(login.user)); }, author);
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(base + '/');
        await page.getByRole('button', { name: '编辑器', exact: true }).click();
        await page.locator('#image-input').setInputFiles(file);
        const ready = () => page.waitForFunction(() => document.querySelector('#mainCanvas')?.dataset.previewStatus === 'ready');
        await ready();
        const recipe = await page.evaluate(() => { const s = EditorCore.createState(); s.adjustments.exposure = .3; return EditorCore.toRecipe(s); });
        await previewRecipe(page,recipe);
        await page.getByRole('button', { name: '应用到照片', exact: true }).click(); await ready();
        const edited = await page.locator('#mainCanvas').evaluate(c => c.toDataURL());
        await page.locator('.user-chip').click();
        await frame.locator('#authorEdit').waitFor({ state: 'visible' });
        await frame.locator('#authorWorks .author-work').first().waitFor();
        await child().waitForFunction(() => scrollY === 0);
        await child().waitForFunction(() => [...document.querySelectorAll('#authorWorks img')].slice(0,3).every(img => img.complete && img.naturalWidth > 0));
        await page.screenshot({ path: `${folder}/${prefix ? 'prefix' : 'root'}-owner.png` });
        assert.equal(await frame.locator('#ucAccountPanel').isVisible(), false);
        await frame.locator('#authorEdit').click(); await frame.locator('#ucAccountPanel').waitFor({ state: 'visible' });
        await frame.locator('#ucBioInput').fill('新的合成简介');
        await frame.locator('#ucSaveProfile').click();
        await frame.locator('#authorHeader .public-profile-bio').filter({ hasText: '新的合成简介' }).waitFor();
        await page.waitForURL(url => url.searchParams.get('author') === String(author.user.id));
        await page.getByRole('button', { name: '编辑器', exact: true }).click(); await ready();
        assert.equal(await page.locator('#mainCanvas').evaluate(c => c.toDataURL()), edited);
        assert.equal(new URL(page.url()).searchParams.has('author'), false);
        await page.goBack();
        await frame.locator('#authorHeader .public-profile-bio').filter({ hasText: '新的合成简介' }).waitFor();
        await page.waitForFunction(() => document.title.includes('山间来信的作品集'));
        await page.getByRole('button', { name: '编辑器', exact: true }).click(); await ready();
        assert.equal(await page.locator('#mainCanvas').evaluate(c => c.toDataURL()), edited);
      } catch (error) {
        await page.screenshot({ path: `${folder}/failure.png` }).catch(() => {});
        throw error;
      } finally {
        await context.close(); await server.stop();
      }
      assert.deepEqual(errors, []); assert.deepEqual(escaped, []);
      report.push({ prefix: prefix || '/', checks: ['complete public portfolio and escaped text', '53 works with sorting/pagination', 'deep link refresh and host/standalone back/forward', 'artwork details preserve author page', 'share fallback and anonymous/private boundaries', '320–1920 layout and empty/error states', 'late responses cannot replace another author', 'owner portfolio/edit/save; live edited photo survives navigation'] });
    }
  } finally { await browser.close(); }
  await fs.writeFile(folder + '/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
