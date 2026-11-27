/* Kryptografie-Helfer für den Beleg-Worker (nur WebCrypto, keine Abhängigkeiten).
 *
 * Umschlag-Verschlüsselung (Envelope Encryption):
 *  - Jede Datei bekommt einen eigenen, zufälligen Datenschlüssel (DEK, AES-256-GCM).
 *  - Der DEK wird mit dem Hauptschlüssel (KEK, Worker-Secret MASTER_KEY) verschlüsselt ("gewickelt")
 *    und nur gewickelt in D1 gespeichert. Der Klartext-DEK existiert nur kurz im Speicher.
 *  - Additional Authenticated Data (AAD) = "fall-id|datei-id": Eine Datei kann nicht unbemerkt
 *    einem anderen Fall untergeschoben werden.
 *  - key_id erlaubt eine spätere Schlüsselrotation (MASTER_KEY_<ID>).
 */
const te = new TextEncoder();
const td = new TextDecoder();

export function b64(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
export const b64url = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function unb64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return unb64(s);
}
export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
export const randomToken = (n = 32) => b64url(randomBytes(n));
export function randomCode6() {
  // gleichverteilt 000000–999999 (Verwerfen oberhalb des größten Vielfachen)
  const max = Math.floor(0xffffffff / 1e6) * 1e6;
  for (;;) {
    const v = crypto.getRandomValues(new Uint32Array(1))[0];
    if (v < max) return String(v % 1e6).padStart(6, '0');
  }
}

const keyCache = new Map();
async function importAes(raw, usages) {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, usages);
}
function masterRaw(env, keyId) {
  const name = keyId === 'k1' ? 'MASTER_KEY' : 'MASTER_KEY_' + keyId.toUpperCase();
  const v = env[name];
  if (!v) throw new Error('missing_master_key');
  const raw = unb64(v);
  if (raw.length !== 32) throw new Error('bad_master_key');
  return raw;
}
async function kek(env, keyId) {
  const ck = 'kek:' + keyId + ':' + (env[keyId === 'k1' ? 'MASTER_KEY' : 'MASTER_KEY_' + keyId.toUpperCase()] || '');
  if (!keyCache.has(ck)) keyCache.set(ck, await importAes(masterRaw(env, keyId), ['encrypt', 'decrypt']));
  return keyCache.get(ck);
}
export const currentKeyId = (env) => env.MASTER_KEY_ID || 'k1';

/** Verschlüsselt Bytes mit einem frischen DEK. Rückgabe: Chiffrat + gewickelter DEK (alles base64 außer Chiffrat). */
export async function encryptBlob(env, plain, aad) {
  const keyId = currentKeyId(env);
  const dekRaw = randomBytes(32);
  const dek = await importAes(dekRaw, ['encrypt']);
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, dek, plain);
  const wrapIv = randomBytes(12);
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wrapIv, additionalData: te.encode('dek|' + aad) }, await kek(env, keyId), dekRaw);
  dekRaw.fill(0);
  return { ciphertext: new Uint8Array(ct), keyId, iv: b64(iv), wrappedDek: b64(wrapIv) + '.' + b64(wrapped) };
}
export async function decryptBlob(env, ciphertext, meta, aad) {
  const [wIv, wCt] = meta.wrappedDek.split('.');
  const dekRaw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(wIv), additionalData: te.encode('dek|' + aad) }, await kek(env, meta.keyId), unb64(wCt)));
  const dek = await importAes(dekRaw, ['decrypt']);
  dekRaw.fill(0);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(meta.iv), additionalData: te.encode(aad) }, dek, ciphertext));
}

/** Kleine Textfelder (E-Mail, Dateiname, TOTP-Secret) direkt mit dem KEK verschlüsseln. */
export async function sealText(env, text, context) {
  const keyId = currentKeyId(env);
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(context) }, await kek(env, keyId), te.encode(text));
  return keyId + '.' + b64(iv) + '.' + b64(ct);
}
export async function openText(env, sealed, context) {
  const [keyId, iv, ct] = sealed.split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: te.encode(context) }, await kek(env, keyId), unb64(ct));
  return td.decode(pt);
}

async function hmacKey(env) {
  const v = env.HMAC_KEY;
  if (!v) throw new Error('missing_hmac_key');
  const ck = 'hmac:' + v;
  if (!keyCache.has(ck)) keyCache.set(ck, await crypto.subtle.importKey('raw', unb64(v), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']));
  return keyCache.get(ck);
}
/** Deterministischer, geheimer Hash (für E-Mail-Suche, Token-/Code-Speicherung). */
export async function hmacHex(env, msg) {
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(env), te.encode(msg)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}
export async function sign(env, msg) {
  return b64url(await crypto.subtle.sign('HMAC', await hmacKey(env), te.encode(msg)));
}
export async function verifySig(env, msg, sig) {
  try {
    return await crypto.subtle.verify('HMAC', await hmacKey(env), unb64url(sig), te.encode(msg));
  } catch {
    return false;
  }
}
export function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
export async function sha256Hex(buf) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- TOTP (RFC 6238, SHA-1, 6 Stellen, 30 s) ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(u) {
  let bits = 0, val = 0, out = '';
  for (const b of u) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s) {
  s = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, val = 0;
  const out = [];
  for (const c of s) {
    val = (val << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}
export async function totpAt(secretB32, counter) {
  const key = await crypto.subtle.importKey('raw', base32Decode(secretB32), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 0xff; c = Math.floor(c / 256); }
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[19] & 0xf;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 1e6).padStart(6, '0');
}
/** Prüft einen TOTP-Code mit ±1 Zeitfenster. Gibt den verwendeten Zähler zurück (gegen Wiederverwendung) oder -1. */
export async function verifyTotp(secretB32, code, nowMs = Date.now(), lastCounter = -1) {
  if (!/^\d{6}$/.test(code || '')) return -1;
  const t = Math.floor(nowMs / 30000);
  for (const d of [0, -1, 1]) {
    const ctr = t + d;
    if (ctr <= lastCounter) continue;
    if (timingSafeEqualStr(await totpAt(secretB32, ctr), code)) return ctr;
  }
  return -1;
}
