import { spawn } from 'node:child_process';
import { mkdir, rename, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

if (process.platform !== 'darwin') throw new Error('macOS 安装包须在 Mac 上构建，请使用 GitHub Actions 的 macOS 工作流。');
const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
if (args.some(arg => !['--arm64', '--x64', '--dir'].includes(arg))) throw new Error('仅支持 --arm64、--x64 和 --dir。');
const architectures = args.filter(arg => arg === '--arm64' || arg === '--x64');
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const id = randomUUID();
const stage = path.join(root, 'release', `.mac-build-${id}`);
const destination = path.join(root, 'release', `macos-${version}-${id}`);
await mkdir(stage, { recursive: true });
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(root, 'node_modules/electron-builder/cli.js'),
    '--mac', ...(args.includes('--dir') ? ['--dir'] : ['dmg', 'zip']),
    ...(architectures.length ? architectures : ['--arm64', '--x64']), '--publish', 'never',
    `--config.directories.output=${stage}`], { cwd: root, stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`macOS 打包失败 (${code})；旧产物未修改，诊断文件保留于 ${stage}`)));
});
await rename(stage, destination);
console.log(`macOS 构建完成：${destination}`);
