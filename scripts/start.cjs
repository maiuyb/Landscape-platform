const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const localPython = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const child = spawn(fs.existsSync(localPython) ? localPython : 'python', [path.join(root, '风景调色协作平台/backend/app.py')], { stdio: 'inherit', cwd: root });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
