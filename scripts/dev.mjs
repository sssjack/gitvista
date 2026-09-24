import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import './build-electron.mjs';
import electron from 'electron';
const server = await createServer();
await server.listen();
const child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, GITVISTA_DEV_URL: 'http://127.0.0.1:5179' }, windowsHide: true });
child.on('exit', async code => { await server.close(); process.exit(code || 0); });
process.on('SIGINT', () => child.kill());
