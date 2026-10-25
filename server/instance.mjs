import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function acquireInstance(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'instance.lock');
  const token = randomUUID();
  if (fs.existsSync(file)) {
    const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
    let alive = false;
    try {
      process.kill(existing.pid, 0);
      alive = true;
    } catch (error) {
      alive = error.code === 'EPERM';
    }
    if (alive)
      throw Object.assign(new Error('Esta base já está aberta em outra instância do Disparo.'), {
        code: 'INSTANCE_RUNNING',
        port: existing.port,
        directory,
      });
    fs.unlinkSync(file);
  }
  const current = { token, pid: process.pid, port: null };
  fs.writeFileSync(file, JSON.stringify(current), { flag: 'wx' });
  return {
    setPort(port) {
      current.port = port;
      fs.writeFileSync(file, JSON.stringify(current));
    },
    release() {
      if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).token === token)
        fs.unlinkSync(file);
    },
  };
}
