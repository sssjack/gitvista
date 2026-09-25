import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RepositoryCredentials } from '../shared/types';

export interface ScopedCredential extends RepositoryCredentials { url: string }
const session = new Map<string, ScopedCredential>();
export function credentialUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Credentials require an HTTPS repository URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTPS URL without embedded credentials, query parameters, or fragments.');
  return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
}
export function validateCredentials(value: unknown): RepositoryCredentials {
  const input = value as RepositoryCredentials | null;
  if (!input || typeof input.username !== 'string' || typeof input.secret !== 'string' || !input.username.trim() || !input.secret || /[\r\n\0]/.test(input.username + input.secret) || input.username.length > 512 || input.secret.length > 16384) throw new Error('Enter a valid username and token or password.');
  return { username: input.username.trim(), secret: input.secret };
}
export function rememberCredentials(url: string, value: RepositoryCredentials | null): void {
  const key = credentialUrl(url);
  if (value === null) session.delete(key);
  else session.set(key, { url: key, ...validateCredentials(value) });
}
export function clearCredentials(): void { session.clear(); }

// Git sends the credential context on stdin. Secrets stay in the child environment;
// the helper file and command line contain no credentials. Git's store/erase are no-ops.
const HELPER = `const fs = require('node:fs');
if (process.argv[2] === 'get') {
 const fields = Object.fromEntries(fs.readFileSync(0, 'utf8').split('\\n').filter(Boolean).map(line => { const n = line.indexOf('='); return [line.slice(0, n), line.slice(n + 1)]; }));
 const entries = JSON.parse(process.env.GITVISTA_CREDENTIALS || '[]');
 const match = entries.find(entry => { const url = new URL(entry.url); return fields.protocol === 'https' && fields.host === url.host && (fields.path || '').replace(/\\/$/, '') === url.pathname.slice(1); });
 if (match) process.stdout.write('username=' + match.username + '\\npassword=' + match.secret + '\\n\\n');
}
`;
const shellQuote = (value: string) => "'" + value.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'";
export async function withCredentials<T>(provided: ScopedCredential[] | undefined, work: (args: string[], env: NodeJS.ProcessEnv, redact: (text: string) => string) => Promise<T>): Promise<T> {
  const entries = [...new Map([...session.values(), ...(provided || [])].map(entry => [entry.url, entry])).values()];
  if (!entries.length) return work([], {}, value => value);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gitvista-credentials-'));
  const helper = path.join(directory, 'helper.cjs');
  const secrets = entries.flatMap(entry => [entry.secret, encodeURIComponent(entry.secret), Buffer.from(`${entry.username}:${entry.secret}`).toString('base64')]);
  const redact = (text: string) => secrets.reduce((result, secret) => result.split(secret).join('[redacted]'), text);
  try {
    await fs.writeFile(helper, HELPER, { mode: 0o600 });
    const command = `!${shellQuote(process.execPath)} ${shellQuote(helper)}`;
    const args = entries.flatMap(entry => ['-c', `credential.${entry.url}.helper=`, '-c', `credential.${entry.url}.helper=${command}`]);
    args.push('-c', 'credential.useHttpPath=true', '-c', 'http.followRedirects=false');
    return await work(args, { ELECTRON_RUN_AS_NODE: '1', GITVISTA_CREDENTIALS: JSON.stringify(entries) }, redact);
  } finally {
    const parent = path.resolve(os.tmpdir());
    if (path.dirname(path.resolve(directory)) === parent && path.basename(directory).startsWith('gitvista-credentials-')) await fs.rm(directory, { recursive: true, force: true });
  }
}
