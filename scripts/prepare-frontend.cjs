const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, '风景调色协作平台/frontend/vendor');
fs.mkdirSync(target, { recursive: true });
fs.copyFileSync(require.resolve('vue/dist/vue.global.prod.js'), path.join(target, 'vue.global.prod.js'));
fs.copyFileSync(path.join(root, 'node_modules/vue/LICENSE'), path.join(target, 'VUE-LICENSE'));
console.log('已准备本地 Vue 运行文件。');
