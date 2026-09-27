import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { windowsPowerShellEnvironment } from './windows-powershell.mjs';

const root = path.resolve(import.meta.dirname, '..');
const stage = path.join(root, 'release', `.build-${randomUUID()}`);
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, env: command.toLowerCase() === 'powershell.exe' ? windowsPowerShellEnvironment() : process.env });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with ${code}`)));
  });
}
await mkdir(stage, { recursive: true });
await writeFile(path.join(stage, '.gitvista-build.json'), JSON.stringify({ owner: 'cn.gitvista.desktop', schema: 1, pid: process.pid, created: new Date().toISOString() }));
try {
  const targets = process.argv.includes('--dir') ? ['--win', '--dir'] : ['--win', 'nsis', 'portable'];
  await run(process.execPath, [path.join(root, 'node_modules', 'electron-builder', 'cli.js'), ...targets, '--x64', `--config.directories.output=${stage}`]);
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'publish-build.ps1'), '-StagingDirectory', stage]);
} catch (error) {
  process.exitCode = 1;
  console.error(`打包未完成，上一份成功产物仍保留：${error.message}`);
} finally {
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'publish-build.ps1'), '-StagingDirectory', stage, '-CleanupOnly']).catch(error => {
    console.warn(`临时构建目录将在下次清理时重试：${error.message}`);
  });
}
