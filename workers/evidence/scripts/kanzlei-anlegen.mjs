#!/usr/bin/env node
/* Legt eine Partnerkanzlei an (gibt nur SQL aus, schreibt nichts selbst).
 * Nutzung:
 *   MASTER_KEY=... HMAC_KEY=... node scripts/kanzlei-anlegen.mjs "Kanzlei Muster" kanzlei@example.de > /tmp/k.sql
 *   npx wrangler d1 execute gmr-belege --remote --file /tmp/k.sql
 * Die Schlüssel müssen dieselben sein wie die Worker-Secrets. Die Kanzlei richtet ihre
 * Authenticator-App beim ersten Login selbst ein (Pflicht).
 */
import { hmacHex, sealText } from '../src/crypto.js';

const [name, email] = process.argv.slice(2);
if (!name || !email || !process.env.MASTER_KEY || !process.env.HMAC_KEY) {
  console.error('Aufruf: MASTER_KEY=… HMAC_KEY=… node scripts/kanzlei-anlegen.mjs "<Name>" <email>');
  process.exit(1);
}
const env = { MASTER_KEY: process.env.MASTER_KEY, HMAC_KEY: process.env.HMAC_KEY, MASTER_KEY_ID: process.env.MASTER_KEY_ID };
const id = crypto.randomUUID();
const norm = email.trim().toLowerCase();
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const sql = `INSERT INTO kanzleien (id, name, email_hash, email_enc, created_at) VALUES (${q(id)}, ${q(name)}, ${q(await hmacHex(env, 'email|' + norm))}, ${q(await sealText(env, norm, 'email|kanzlei|' + id))}, ${Date.now()});`;
console.log(sql);
