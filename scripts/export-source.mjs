import fs from 'node:fs';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { ZipArchive } from 'archiver';
import { projectRoot, sourceFiles } from './source-files.mjs';

const files = sourceFiles();
const { version } = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const outputDirectory = path.join(projectRoot, 'release');
fs.mkdirSync(outputDirectory, { recursive: true });
const filename = path.join(outputDirectory, `Disparo-${version}-fonte.zip`);
const output = fs.createWriteStream(filename);
const archive = new ZipArchive({ zlib: { level: 9 } });
archive.on('error', (error) => output.destroy(error));
archive.on('warning', (error) => output.destroy(error));
archive.pipe(output);
for (const relative of files) archive.file(path.join(projectRoot, relative), { name: relative });
await Promise.all([archive.finalize(), finished(output)]);
console.log(`Código para publicação: ${filename} (${files.length} arquivos).`);
