import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const roots = [
  '.gitattributes',
  '.github',
  '.gitignore',
  '.prettierignore',
  '.prettierrc.json',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'INICIAR.cmd',
  'index.html',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'docs',
  'electron',
  'scripts',
  'server',
  'shared',
  'src',
  'tests',
];
const privateNames = new Set(
  [
    '.data',
    '.env',
    '.wwebjs_auth',
    '.wwebjs_cache',
    '.git',
    'node_modules',
    'test-results',
    'release',
    'dist',
    'sessions',
    'backups',
    'ai-secrets.json',
    'disparo.json',
    'instance.lock',
    'DevToolsActivePort',
  ].map((name) => name.toLowerCase()),
);
const privateExtensions =
  /\.(?:pem|key|p12|pfx|csv|xlsx?|vcf|db|sqlite3?|log|exe|asar|zip|7z|tgz)$/i;
const secretPatterns = [
  /\bsbp_[a-f0-9]{30,}\b/,
  /\beyJ[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{20,}\b/,
  /\bgsk_[A-Za-z0-9]{24,}\b/,
  /\bsk-or-v1-[a-f0-9]{32,}\b/,
  /\bsk-proj-[A-Za-z0-9_-]{24,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

export function sourceFiles(root = projectRoot) {
  const result = [];
  const visit = (relative) => {
    const filename = path.resolve(root, relative);
    const resolved = path.relative(root, filename);
    if (resolved.startsWith('..') || path.isAbsolute(resolved))
      throw new Error('Arquivo fora do projeto.');
    if (
      relative
        .split(/[\\/]/)
        .some(
          (part) => privateNames.has(part.toLowerCase()) || part.toLowerCase().startsWith('.env'),
        )
    ) {
      throw new Error(`Conteúdo privado não permitido na exportação: ${relative}`);
    }
    const stat = fs.lstatSync(filename);
    if (stat.isSymbolicLink()) throw new Error(`Link simbólico não permitido: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(filename).sort()) visit(path.join(relative, name));
    } else {
      if (privateExtensions.test(relative))
        throw new Error(`Arquivo de dados ou executável não permitido: ${relative}`);
      if (!/\.(?:jpg|png|woff2?)$/i.test(relative)) {
        const content = fs.readFileSync(filename, 'utf8');
        if (secretPatterns.some((pattern) => pattern.test(content)))
          throw new Error(`Possível credencial em ${relative}. O valor não será exibido.`);
      }
      result.push(relative.replaceAll(path.sep, '/'));
    }
  };
  for (const entry of roots) visit(entry);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = sourceFiles();
  console.log(
    `${files.length} arquivos de código e documentação conferidos. Dados locais, sessões e builds ficam fora da exportação.`,
  );
}
