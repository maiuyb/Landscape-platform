// Prepare reproducible community pairs from the saved JPEG bases, using the actual browser renderer.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {chromium} = require('playwright');
const Community = require('../风景调色协作平台/frontend/editor-community.js');
const root = path.resolve(__dirname, '..');
const source = path.join(root, '素材');
const frontend = path.join(root, '风景调色协作平台/frontend');
const output = path.resolve(process.argv[2] || path.join(root, 'test-results/community-import/library'));
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const modules = ['editor-tools.js', 'editor-detail.js', 'editor-effects.js', 'editor-masks.js',
  'editor-upright.js', 'editor-core.js', 'editor-presets.js', 'editor-community.js'];

(async () => {
  if (output === source || output.startsWith(source + path.sep)) throw Error('Do not overwrite source material');
  const originals = JSON.parse(await fsp.readFile(path.join(source, 'manifest.json'), 'utf8'));
  const items = JSON.parse(await fsp.readFile(path.join(source, 'manifest_with_recipes.json'), 'utf8'));
  if (items.length !== 200 || new Set(items.map(i => i.id)).size !== 200) throw Error('Expected 200 unique recipes');
  for (const item of items) {
    if (!/^landscape_\d{3}$/.test(item.id) || item.cover_before !== `before/${item.id}.jpg`) throw Error('Invalid input path');
    Community.normalize(item);
  }
  for (const folder of ['before', 'after', 'rendered']) await fsp.mkdir(path.join(output, folder), {recursive: true});
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(modules.map(m => `<script src="/${m}"></script>`).join(''));return;
      }
      const module = modules.find(m => pathname === '/' + m);
      const match = pathname.match(/^\/before\/(landscape_\d{3})\.jpg$/);
      const file = module ? path.join(frontend, module) : match ? path.join(source, 'before', match[1] + '.jpg') : null;
      if (!file) {response.writeHead(404);response.end();return;}
      response.setHeader('Content-Type', module ? 'text/javascript' : 'image/jpeg');
      response.end(await fsp.readFile(file));
    } catch {response.writeHead(500);response.end();}
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch(), page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const manifest = [];
    for (const item of items) {
      const original = originals.find(o => o.id === item.id);
      if (!original || !original.license_url || !original.source_url) throw Error('Missing attribution: ' + item.id);
      const result = await page.evaluate(async item => {
        const image = new Image();image.src = '/before/' + item.id + '.jpg';await image.decode();
        const recipe = EditorCommunity.normalize(item);
        const state = EditorCore.recipeState(EditorCore.createState(), recipe).state;
        const canvas = EditorCore.render(image, state, {maxSide: 0});
        return {png: canvas.toDataURL('image/png').split(',')[1], width: canvas.width, height: canvas.height};
      }, item);
      await fsp.copyFile(path.join(source, item.cover_before), path.join(output, 'before', item.id + '.jpg'));
      await fsp.writeFile(path.join(output, 'rendered', item.id + '.png'), Buffer.from(result.png, 'base64'));
      const {recipe, ...metadata} = item;
      manifest.push({...metadata, width: result.width, height: result.height,
        cover_after: 'after/' + item.id + '.webp',
        license_url: original.license_url,
        source_sha256: sha(await fsp.readFile(path.join(source, original.file))),
        before_note: '调色前基底经过明暗与饱和度整理，并非相机 RAW 或未经处理的原始文件。成片由此基底和所列配方生成。'});
      if (manifest.length % 10 === 0) console.log(`Rendered ${manifest.length}/200`);
    }
    const converted = spawnSync(python, ['-c', `from pathlib import Path
from PIL import Image
import sys
root=Path(sys.argv[1])
for p in (root/'rendered').glob('*.png'):
    with Image.open(p) as image:
        image.convert('RGB').save(root/'after'/(p.stem+'.webp'),format='WEBP',lossless=True,method=4)
print('Encoded lossless WebP pairs')`, output], {stdio: 'inherit'});
    if (converted.status !== 0) throw Error('Lossless conversion failed');
    // Verify every delivered file by comparing its decoded pixels with a fresh engine render.
    for (let i = 0; i < manifest.length; i++) {
      const item = manifest[i];
      const after = await fsp.readFile(path.join(output, item.cover_after));
      const checked = await page.evaluate(async ({item, encoded}) => {
        const before = new Image();before.src = '/before/' + item.id + '.jpg';await before.decode();
        const actual = new Image();actual.src = 'data:image/webp;base64,' + encoded;await actual.decode();
        const state = EditorCore.recipeState(EditorCore.createState(), EditorCommunity.normalize(item)).state;
        const expected = EditorCore.render(before, state, {maxSide: 0});
        const canvas = document.createElement('canvas');canvas.width = actual.width;canvas.height = actual.height;
        canvas.getContext('2d').drawImage(actual, 0, 0);
        const a = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        const b = expected.getContext('2d').getImageData(0, 0, expected.width, expected.height).data;
        return canvas.width === expected.width && canvas.height === expected.height && a.length === b.length && a.every((v, j) => v === b[j]);
      }, {item, encoded: after.toString('base64')});
      if (!checked) throw Error('Pixel roundtrip mismatch: ' + item.id);
      item.before_sha256 = sha(await fsp.readFile(path.join(output, item.cover_before)));
      item.after_sha256 = sha(after);
      if ((i + 1) % 20 === 0) console.log(`Verified exact pixels ${i + 1}/200`);
    }
    await fsp.writeFile(path.join(output, 'manifest.json'), JSON.stringify({
      dataset: 'landscape-curated-v1', format_version: 1, verified: 'browser-full-render-lossless-webp', items: manifest,
    }, null, 2) + '\n');
    console.log('Prepared and verified 200 pairs: ' + output);
  } finally {await browser.close();await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error);process.exitCode = 1;});
