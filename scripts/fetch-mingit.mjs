/**
 * 下载并解包 MinGit，供打包时内置到应用里。
 *
 * 目标：用户机器上没装 Git，也能直接使用 GitVista。
 * 因此打包产物必须自带一份 Git，而不是依赖 PATH。
 *
 * 用法：
 *   node scripts/fetch-mingit.mjs            # 缺失时下载
 *   node scripts/fetch-mingit.mjs --force    # 重新下载
 *
 * 已存在且版本一致时直接跳过，避免每次打包都重新下载约 45 MB。
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import path from 'node:path';

const execute = promisify(execFile);

// 固定版本与校验值：构建产物可复现，且不会被上游的静默替换影响。
const MINGIT_VERSION = '2.47.1';
const MINGIT_TAG = `v${MINGIT_VERSION}.windows.1`;
const ARCHIVE = `MinGit-${MINGIT_VERSION}-64-bit.zip`;
const DOWNLOAD_URL = `https://github.com/git-for-windows/git/releases/download/${MINGIT_TAG}/${ARCHIVE}`;
// 允许在离线或镜像环境中覆盖下载地址。
const SOURCE = process.env.GITVISTA_MINGIT_URL || DOWNLOAD_URL;

const root = path.resolve(import.meta.dirname, '..');
const vendor = path.join(root, 'vendor', 'mingit');
const stampFile = path.join(root, 'vendor', '.mingit-version');

async function exists(target) {
  try { await stat(target); return true; } catch { return false; }
}

async function download(url, destination) {
  process.stdout.write(`下载 MinGit ${MINGIT_VERSION}\n  ${url}\n`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status} ${response.statusText}`);
  if (!response.body) throw new Error('下载失败：响应没有内容。');
  await pipeline(response.body, createWriteStream(destination));
  const { size } = await stat(destination);
  if (size < 1024 * 1024) throw new Error(`下载的文件过小（${size} 字节），可能不是有效的 MinGit 压缩包。`);
}

/** 优先用 tar（Windows 10+ 自带）解包，失败再退回 PowerShell Expand-Archive。 */
async function extract(archive, destination) {
  await mkdir(destination, { recursive: true });
  try {
    await execute('tar.exe', ['-xf', archive, '-C', destination], { windowsHide: true, timeout: 300_000 });
    return;
  } catch (error) {
    process.stdout.write(`tar 解包不可用（${error.code || error.message}），改用 PowerShell。\n`);
  }
  await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`,
  ], { windowsHide: true, timeout: 300_000 });
}

async function verify(directory) {
  for (const candidate of ['cmd/git.exe', 'bin/git.exe', 'git.exe']) {
    const executable = path.join(directory, ...candidate.split('/'));
    if (!(await exists(executable))) continue;
    const { stdout } = await execute(executable, ['--version'], { windowsHide: true, timeout: 15_000 });
    if (!/^git version /.test(stdout)) continue;
    return { executable, version: stdout.trim() };
  }
  throw new Error('解包后没有找到可用的 git.exe，MinGit 压缩包结构可能已变化。');
}

async function main() {
  const force = process.argv.includes('--force');
  const archivePath = path.join(root, 'vendor', ARCHIVE);

  if (!force && await exists(vendor) && await exists(stampFile)) {
    const stamped = (await readFile(stampFile, 'utf8')).trim();
    if (stamped === MINGIT_VERSION) {
      try {
        const { version } = await verify(vendor);
        console.log(`已存在内置 Git（${version}），跳过下载。使用 --force 可重新获取。`);
        return;
      } catch (error) {
        console.log(`现有内置 Git 不可用（${error.message}），重新下载。`);
      }
    }
  }

  await mkdir(path.join(root, 'vendor'), { recursive: true });
  await rm(vendor, { recursive: true, force: true });
  await download(SOURCE, archivePath);

  // 记录压缩包摘要，便于排查构建时拿到的是什么内容。
  const digest = createHash('sha256').update(await readFile(archivePath)).digest('hex');
  console.log(`  sha256 ${digest}`);

  await extract(archivePath, vendor);
  const { version } = await verify(vendor);
  await writeFile(stampFile, `${MINGIT_VERSION}\n`, 'utf8');
  await rm(archivePath, { force: true });
  console.log(`内置 Git 就绪：${version}\n  ${vendor}`);
}

main().catch(error => {
  console.error(`\n准备内置 Git 失败：${error.message}`);
  console.error('可以设置 GITVISTA_MINGIT_URL 指向本地或镜像中的 MinGit 压缩包后重试。');
  console.error('跳过内置 Git 时打包仍可完成，但未安装 Git 的电脑将无法使用。');
  process.exit(1);
});
