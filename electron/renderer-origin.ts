import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 同时兼容便携程序解压目录的 Windows 8.3 短路径和 ASAR 内部页面。 */
export function canonicalRendererPath(file: string): string {
  const absolute = path.resolve(file);
  const archive = /^(.*?\.asar)([\\/].*)?$/i.exec(absolute);
  if (archive) {
    // native realpath 只处理真实目录；app.asar 内部路径属于 Electron 虚拟文件系统。
    const archiveFile = archive[1];
    return path.join(realpathSync.native(path.dirname(archiveFile)), path.basename(archiveFile), archive[2] || '');
  }
  return realpathSync.native(absolute);
}

export function createRendererUrlValidator(rendererFile: string): (value: string) => boolean {
  const key = (file: string) => process.platform === 'win32' ? file.toLowerCase() : file;
  const expected = key(canonicalRendererPath(rendererFile));
  let lastUrl: string | undefined;
  let lastResult = false;
  return value => {
    if (value === lastUrl) return lastResult;
    let matches = false;
    try {
      const url = new URL(value);
      if (url.protocol === 'file:' && !url.hostname && !url.username && !url.password && !url.search) {
        matches = key(canonicalRendererPath(fileURLToPath(url))) === expected;
      }
    } catch { /* 无效 URL、缺失文件及无权读取的路径均拒绝。 */ }
    lastUrl = value; lastResult = matches;
    return matches;
  };
}
