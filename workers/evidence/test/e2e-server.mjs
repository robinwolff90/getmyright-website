/* Nur für lokale Browser-Tests: startet Worker (8787) + statische Seite (8080) mit lokal umgeschriebener CSP. */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalWorker } from './helpers.mjs';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const w = await startLocalWorker({ port: 8787, origin: 'http://127.0.0.1:8080', kanzleien: [['Kanzlei Alpha', 'alpha@example.de']] });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(site, path.normalize(p));
    if (!f.startsWith(site)) throw new Error('pfad');
    let body = await readFile(f);
    const ext = path.extname(f);
    if (ext === '.html') body = Buffer.from(body.toString().replaceAll('https://gmr-evidence.getmyright.workers.dev', 'http://127.0.0.1:8787').replace('; upgrade-insecure-requests', ''));
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end('404'); }
}).listen(8080, '127.0.0.1', () => console.log('BEREIT http://127.0.0.1:8080'));
process.on('SIGTERM', async () => { await w.stop(); process.exit(0); });
