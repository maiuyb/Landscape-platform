// Run maintained suites from a fresh checkout, using disposable storage for browsers.
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const tests = path.join(root, 'tests');
const {start} = require('../tests/isolated-browser-support.cjs');
const pythonPath = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = fs.existsSync(pythonPath) ? pythonPath : 'python';

async function run(command, args, {env = process.env, log} = {}) {
  return new Promise((resolve, reject) => {
    const output = log ? fs.openSync(log, 'w') : null;
    const child = spawn(command, args, {cwd: root, env, stdio: output === null ? 'inherit' : ['ignore', output, output]});
    child.once('error', error => {
      if (output !== null) fs.closeSync(output);
      reject(error);
    });
    child.once('exit', code => {
      if (output !== null) fs.closeSync(output);
      if (code === 0) resolve();
      else {
        if (log) console.error(fs.readFileSync(log, 'utf8').split('\n').map(line => line.length > 500 ? line.slice(0, 160) + ' [long value omitted]' : line).join('\n').slice(-4500));
        reject(new Error(args.join(' ') + ' failed (' + code + ')'));
      }
    });
  });
}

async function main() {
  const suite = process.argv[2] || 'core';
  if (suite === 'core') {
    return run(process.execPath, ['--test', ...fs.readdirSync(tests).filter(f => f.endsWith('.test.cjs')).sort().map(f => path.join(tests, f))]);
  }
  if (suite === 'backend') return run(python, ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py']);
  if (suite === 'integration') return run(process.execPath, ['tests/community-roundtrip.cjs']);
  if (suite !== 'browser') throw new Error('Unknown suite: ' + suite);
  const requested = process.argv.slice(3);
  const files = fs.readdirSync(tests).filter(f => f.endsWith('-browser.cjs') && (!requested.length || requested.includes(f))).sort();
  if (!files.length || requested.some(f => !files.includes(f))) throw new Error('Choose existing *-browser.cjs files in tests/');
  const folder = path.join(root, 'test-results/checks');
  fs.mkdirSync(folder, {recursive: true});
  const failures = [];
  for (const file of files) {
    let service;
    const began = Date.now();
    process.stdout.write(file + ' ... ');
    try {
      const source = fs.readFileSync(path.join(tests, file), 'utf8');
      // Self-hosted tests cover root and /landscape; other suites get a fresh root service.
      if (!source.includes("require('./isolated-browser-support.cjs')")) service = await start();
      await run(process.execPath, [path.join(tests, file)], {
        env: {...process.env, ...(service ? {HMI_TEST_URL: service.url} : {})},
        log: path.join(folder, file + '.log'),
      });
      console.log('PASS (' + Math.round((Date.now() - began) / 1000) + 's)');
    } catch (error) {
      failures.push(file);
      console.error('FAIL: ' + error.message);
    } finally {
      if (service) await service.stop();
    }
  }
  console.log((files.length - failures.length) + '/' + files.length + ' browser suites passed.');
  if (failures.length) process.exitCode = 1;
}
main().catch(error => {console.error(error); process.exitCode = 1;});
