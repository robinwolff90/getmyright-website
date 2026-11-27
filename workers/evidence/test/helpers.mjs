/* Startet den Worker lokal (wrangler dev, Miniflare: lokales R2 + D1) – nichts geht an Cloudflare. */
import { spawn, execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const wrangler = path.join(root, 'node_modules', '.bin', 'wrangler');
const key = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');

export async function startLocalWorker({ port = 8799, origin = 'http://127.0.0.1:8080', kanzleien = [], rateLimits = false } = {}) {
  const state = path.join(root, '.test-state', String(port));
  rmSync(state, { recursive: true, force: true });
  const env = { MASTER_KEY: key(), HMAC_KEY: key() };
  execFileSync(wrangler, ['d1', 'execute', 'DB', '--local', '--persist-to', state, '--file', 'schema.sql'], { cwd: root, stdio: 'pipe' });
  const out = [];
  for (const [name, email] of kanzleien) {
    const sql = execFileSync('node', ['scripts/kanzlei-anlegen.mjs', name, email], { cwd: root, env: { ...process.env, ...env } }).toString();
    const f = path.join(state, 'k.sql'); writeFileSync(f, sql);
    execFileSync(wrangler, ['d1', 'execute', 'DB', '--local', '--persist-to', state, '--file', f], { cwd: root, stdio: 'pipe' });
    out.push(sql.match(/VALUES \('([^']+)'/)[1]);
  }
  const vars = {
    ...env, MAIL_MODE: 'log', DEV_EXPOSE_CODES: '1', TURNSTILE_DISABLED: '1', RATELIMIT_DISABLED: rateLimits ? '0' : '1',
    ALLOWED_ORIGINS: origin, SITE_URL: origin,
  };
  const args = ['dev', '--local', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', state, '--show-interactive-dev-session=false'];
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
  const proc = spawn(wrangler, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(base + '/api/nix'); if (r.status === 404) break; } catch { /* startet noch */ }
    await new Promise((r) => setTimeout(r, 500));
    if (i === 119 || proc.exitCode !== null) { proc.kill(); throw new Error('Worker startet nicht:\n' + log); }
  }
  return { base, origin, env, kanzleiIds: out, log: () => log, stop: () => new Promise((r) => { proc.once('exit', r); proc.kill('SIGTERM'); }) };
}
