import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

// Usage: npm run validation:run -- smoke node .local/tests/smoke.mjs
// Tests store screenshots/profiles beneath GITVISTA_VALIDATION_DIR; source scripts stay outside it.
const [group, command, ...args] = process.argv.slice(2);
if (!group || !/^[a-z0-9-]{1,60}$/.test(group) || !command) throw new Error('用法：npm run validation:run -- <分组> <程序> [参数]');
const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, '.local', 'runs', `${group}-${randomUUID()}`);
await mkdir(directory, { recursive: true });
const metadata = { owner: 'cn.gitvista.validation', schema: 1, group, pid: process.pid, created: new Date().toISOString(), completed: null };
const marker = path.join(directory, '.gitvista-run.json');
await writeFile(marker, JSON.stringify(metadata));
try {
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(command === 'node' ? process.execPath : command, args, { cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env, GITVISTA_VALIDATION_DIR: directory } });
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
} finally {
  metadata.completed = new Date().toISOString();
  await writeFile(marker, JSON.stringify(metadata));
}
