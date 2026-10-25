import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sourceFiles } from '../scripts/source-files.mjs';

test('source export includes reproducible project files and excludes private data and generated files', () => {
  const files = sourceFiles();
  for (const required of [
    'package-lock.json',
    '.gitignore',
    'LICENSE',
    '.github/workflows/ci.yml',
    'server/index.mjs',
    'src/App.tsx',
  ])
    assert.ok(files.includes(required), required);
  assert.ok(
    !files.some((file) =>
      /(?:^|\/)(?:\.data|node_modules|release|test-results|\.wwebjs_cache)\//.test(file),
    ),
  );
});

test('source export refuses credentials, data files and symbolic links inside publication directories', (t) => {
  const root = path.resolve('test-results');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'source-audit-'));
  t.after(() => {
    assert.equal(path.dirname(directory), root);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  for (const file of sourceFiles()) {
    const target = path.join(directory, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '');
  }
  const secret = ['gsk', 'A'.repeat(30)].join('_');
  const badFile = path.join(directory, 'src', 'private.txt');
  fs.writeFileSync(badFile, secret);
  assert.throws(
    () => sourceFiles(directory),
    (error) => error.message.includes('private.txt') && !error.message.includes(secret),
  );
  fs.unlinkSync(badFile);
  const dataFile = path.join(directory, 'docs', 'contacts.csv');
  fs.writeFileSync(dataFile, 'name,phone');
  assert.throws(() => sourceFiles(directory), /contacts\.csv/);
  fs.unlinkSync(dataFile);
  const link = path.join(directory, 'src', 'external');
  fs.symlinkSync(
    path.join(directory, 'docs'),
    link,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.throws(() => sourceFiles(directory), /Link simbólico/);
});
