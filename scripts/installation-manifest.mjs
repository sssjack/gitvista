import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CopyElevateHelper } from 'app-builder-lib/out/targets/nsis/nsisUtil.js';

// afterSign runs after Electron's version/icon edits, even when code signing is disabled.
export default async function installationManifest({ appOutDir, packager, targets = [], electronPlatformName }) {
  // This ownership manifest is only consumed by the Windows installer/cleanup scripts.
  // macOS frameworks contain required symlinks and must remain intact after signing.
  if (electronPlatformName !== 'win32') return;
  if (electronPlatformName === 'win32') {
    // electron-builder 26.15.3 otherwise adds resources/elevate.exe *after* afterSign,
    // immediately before NSIS compression. Use its shared helper/cache now so the
    // ownership manifest and the embedded installer archive contain identical files.
    // Keep this integration covered when upgrading the pinned electron-builder version.
    const nsisTargets = targets.filter(target => ['nsis', 'portable', 'nsis-web'].includes(target.name));
    if (nsisTargets.length) {
      for (const target of nsisTargets) {
        const helper = target.packageHelper?.elevateHelper;
        if (typeof helper?.copy !== 'function') throw new Error('electron-builder NSIS helper lifecycle changed; update the installation manifest hook.');
        await helper.copy(appOutDir, target);
      }
    } else {
      // --dir ships the same owned helper as the installer, without broadening cleanup rules.
      await new CopyElevateHelper().copy(appOutDir, { packager, options: packager.config.nsis ?? {} });
    }
  }
  const files = [];
  async function visit(directory) {
    for (const name of await readdir(directory)) {
      if (name === '.gitvista-installation.json') continue;
      const target = path.join(directory, name);
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new Error(`Installation must not contain a link: ${target}`);
      if (info.isDirectory()) await visit(target);
      else {
        const digest = createHash('sha256');
        for await (const chunk of createReadStream(target)) digest.update(chunk);
        files.push({ path: path.relative(appOutDir, target).replaceAll('\\', '/'), sha256: digest.digest('hex') });
      }
    }
  }
  await visit(appOutDir);
  await writeFile(path.join(appOutDir, '.gitvista-installation.json'), JSON.stringify({ owner: 'cn.gitvista.desktop', schema: 1, version: packager.appInfo.version, files }, null, 2));
}
