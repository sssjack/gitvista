import { spawnSync } from 'node:child_process';
import { windowsPowerShellEnvironment } from './windows-powershell.mjs';

if (process.platform === 'win32') {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    'scripts/cleanup-artifacts.ps1', ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true, env: windowsPowerShellEnvironment() });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  console.log('macOS 构建产物保留在 release/，可按需手动清理。');
}
