/* Isolated synthetic photo: no user files, accounts or paid AI calls. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { start } = require('./isolated-browser-support.cjs');

(async () => {
  const server = await start({ prefix: '/landscape' });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const button = name => page.getByRole('button', { name, exact: true });
  const gripOpacity = value => page.waitForFunction(
    value => +getComputedStyle(document.querySelector('.compare-handle')).opacity === value,
    value, { timeout: 6500 }
  );

  try {
    await page.goto(server.url);
    const photo = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 480;
      canvas.height = 720;
      const context = canvas.getContext('2d');
      context.fillStyle = '#639286';
      context.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL().split(',')[1];
    });
    await page.locator('#image-input').setInputFiles({
      name: 'synthetic-portrait.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64')
    });
    await page.waitForFunction(() => document.querySelector('#mainCanvas')?.dataset.previewStatus === 'ready');
    const pixels = await page.locator('#mainCanvas').evaluate(canvas => canvas.toDataURL());
    const divider = page.getByRole('slider', { name: '前后对比分界' });

    await button('滑杆对比').click();
    await page.mouse.move(2, 2);
    await gripOpacity(1);
    const grip = await page.locator('.compare-handle').boundingBox();
    const image = await page.locator('#mainCanvas').boundingBox();
    const viewport = await page.locator('.canvas-container').boundingBox();
    assert.ok(grip.y >= viewport.y && grip.y + grip.height <= image.y, 'grip stays outside the photo and inside the viewport');
    await gripOpacity(0);

    // The invisible divider still provides a generous hover and drag target.
    await page.mouse.move(image.x + image.width / 2, image.y + image.height / 2);
    await gripOpacity(1);
    await page.mouse.move(2, 2);
    await gripOpacity(0);
    await divider.focus();
    await divider.press('Home');
    await gripOpacity(1);
    await divider.press('Shift+ArrowRight');
    assert.equal(await divider.getAttribute('aria-valuenow'), '10');

    // A new comparison gets a fresh hint; dragging past its expiry must stay visible.
    await button('编辑后').click();
    await button('滑杆对比').click();
    const visibleGrip = await page.locator('.compare-handle').boundingBox();
    const currentImage = await page.locator('#mainCanvas').boundingBox();
    await page.mouse.move(visibleGrip.x + visibleGrip.width / 2, visibleGrip.y + visibleGrip.height / 2);
    await page.mouse.down();
    await page.mouse.move(currentImage.x + currentImage.width * .75, currentImage.y - 100, { steps: 8 });
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 5200)));
    assert.ok(Math.abs(Number(await divider.getAttribute('aria-valuenow')) - 75) <= 1);
    await gripOpacity(1);
    await page.mouse.up();
    await page.mouse.move(2, 2);
    await gripOpacity(0);
    assert.equal(await page.locator('#mainCanvas').evaluate(canvas => canvas.toDataURL()), pixels,
      'comparison only changes viewing, not photo pixels');
    await button('编辑后').click();
    assert.equal(await divider.count(), 0);
    await button('滑杆对比').click();
    await page.mouse.move(2, 2);
    await gripOpacity(1);
    assert.deepEqual(errors, []);
    console.log('PASS: external comparison grip; five-second hint, hover/focus, captured drag beyond expiry, mode reset and unchanged pixels');
  } finally {
    await browser.close();
    await server.stop();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
