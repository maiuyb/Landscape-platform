// Test-only references. They are not shipped as application assets.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
// urllib respects configured environment/system proxies; no application network dependency is added.
const result = spawnSync(fs.existsSync(python) ? python : 'python', [path.join(__dirname, 'fetch-test-photos.py')], {stdio:'inherit'});
if(result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
