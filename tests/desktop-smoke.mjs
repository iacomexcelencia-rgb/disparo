import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const executable = path.resolve('release/win-unpacked/Disparo.exe');
const directory = path.resolve('test-results/desktop');
fs.mkdirSync(directory, { recursive: true });
const report = path.join(directory, 'startup.json');
if (fs.existsSync(report)) fs.unlinkSync(report);
const processHandle = spawn(executable, ['--smoke-test'], {
  windowsHide: true,
  stdio: 'inherit',
  env: {
    ...process.env,
    DISPARO_DATA_DIR: path.join(directory, 'data'),
    DISPARO_SMOKE_REPORT: report,
  },
});
const timer = setTimeout(() => {
  processHandle.kill();
  console.error('Inicialização excedeu 45 segundos.');
  process.exitCode = 1;
}, 45000);
processHandle.on('error', (error) => {
  clearTimeout(timer);
  throw error;
});
processHandle.on('exit', (code) => {
  clearTimeout(timer);
  assert.equal(code, 0);
  const result = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.equal(result.loaded, true);
  console.log('Executável Windows iniciou e carregou a interface:', result);
});
