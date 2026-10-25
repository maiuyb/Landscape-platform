/* Synthetic image and disposable server; no user data or paid AI requests. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { start } = require('./isolated-browser-support.cjs');

(async () => {
  const server = await start({ prefix: '/landscape' });
  const browser = await chromium.launch();
  const checks = [], errors = [];
  try {
    for (const compatible of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.on('pageerror', error => errors.push(error.message));
      if (compatible) await page.addInitScript(() => { window.Worker = undefined; });
      await page.goto(server.url);
      const image = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 480; canvas.height = 720;
        const context = canvas.getContext('2d'), gradient = context.createLinearGradient(0, 0, 480, 720);
        gradient.addColorStop(0, '#255b71'); gradient.addColorStop(1, '#d8c08c');
        context.fillStyle = gradient; context.fillRect(0, 0, 480, 720);
        return canvas.toDataURL().split(',')[1];
      });
      await page.locator('#image-input').setInputFiles({
        name: 'synthetic-share.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64')
      });
      const ready = () => page.waitForFunction(() => document.querySelector('#mainCanvas')?.dataset.previewStatus === 'ready');
      await ready();
      await page.locator('#exposure').evaluate(input => {
        input.value = '.7';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await ready();
      const pixels = await page.locator('#mainCanvas').evaluate(canvas => canvas.toDataURL());
      let uploads = 0;
      page.on('request', request => {
        if (request.method() === 'POST' && /\/api\/(upload|recipes)(?:\?|$)/.test(request.url())) uploads++;
      });
      await page.evaluate(() => {
        window.shareWork = [];
        const wrap = (target, key) => {
          const original = target[key];
          target[key] = function (...args) { shareWork.push(key); return original.apply(this, args); };
        };
        wrap(EditorCore, 'render');
        wrap(EditorPreview.prototype, 'request');
        wrap(EditorPreview.prototype, 'requestThumbnails');
      });

      for (const tab of ['编辑', '预设']) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        if (tab === '预设') await page.waitForFunction(() =>
          [...document.querySelectorAll('.preset-card[data-preset-id] canvas')].every(canvas => canvas.dataset.thumbnailStatus === 'ready'));
        // Let an earlier adjustment's thumbnail debounce finish before observing this action.
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 150)));
        for (const cancel of ['button', 'escape']) {
          const revision = await page.locator('#mainCanvas').getAttribute('data-preview-revision');
          await page.evaluate(() => { shareWork.length = 0; });
          const share = page.getByRole('button', { name: '分享到社区', exact: true });
          await share.click();
          const dialog = page.getByRole('dialog', { name: '分享到社区', exact: true });
          await dialog.waitFor();
          if (cancel === 'button') await dialog.getByRole('button', { name: '取消', exact: true }).click();
          else await page.keyboard.press('Escape');
          await dialog.waitFor({ state: 'hidden' });
          // Cover the 100ms thumbnail debounce that used to run after cancellation.
          await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 200)));
          assert.deepEqual(await page.evaluate(() => shareWork), [], 'confirmation and cancellation must not generate photo or preset images');
          assert.equal(await page.locator('#mainCanvas').getAttribute('data-preview-revision'), revision);
          assert.equal(await page.locator('#mainCanvas').evaluate(canvas => canvas.toDataURL()), pixels);
          assert.equal(await page.locator('#exposure').inputValue(), '0.7');
          assert.equal(await page.getByRole('button', { name: '撤销', exact: true }).isEnabled(), true);
          assert.equal(await share.isEnabled(), true);
          assert.equal(await share.evaluate(button => document.activeElement === button), true);
        }
      }
      assert.equal(uploads, 0);
      checks.push(`${compatible ? 'compatible' : 'worker'}: edit/presets × Cancel/Escape; no redraw, thumbnail rebuild or upload; pixels/history/focus retained`);
      await page.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ checks, errors }, null, 2));
  } finally {
    await browser.close();
    await server.stop();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
