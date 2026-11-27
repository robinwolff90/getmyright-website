/* GetMyRight – Beleg-Worker (Phase 1: Upload, Fallzuordnung, Kanzlei-Einsicht)
 *
 * Läuft als Cloudflare Worker vor R2 (Bucket mit Zuständigkeit EU) und D1 (Zuständigkeit EU).
 * Entscheidungen (Robin, 27.11.2026): kein Ende-zu-Ende im Dezember, stattdessen Verschlüsselung
 * auf dem Server mit selbst verwaltetem Schlüssel (MASTER_KEY), Pflicht-2FA (TOTP) für Kanzleien
 * mit "Gerät 30 Tage merken", 6-stelliger Code zusätzlich zum Magic-Link, Turnstile, kurzlebige Links.
 *
 * Secrets (nur per `wrangler secret put`, nie im Repo):
 *   MASTER_KEY        base64, 32 Byte – Hauptschlüssel (KEK) für Datei-Schlüssel, E-Mails, Dateinamen, TOTP
 *   HMAC_KEY          base64, 32 Byte – Signaturen (kurzlebige Links, Geräte), geheime Hashes
 *   TURNSTILE_SECRET  Turnstile-Secret des Widgets (unsichtbarer Modus)
 *   BREVO_API_KEY     Brevo-Key nur mit Recht "Transaktionale E-Mails" für Login-Codes
 * Vars (wrangler.toml): ALLOWED_ORIGINS, SITE_URL, MAIL_FROM, MAIL_MODE
 */
import {
  encryptBlob, decryptBlob, sealText, openText, hmacHex, sign, verifySig, randomToken, randomCode6,
  sha256Hex, base32Encode, randomBytes, verifyTotp,
} from './crypto.js';
import { MAX_BYTES, ITEMS, ITEM_LABEL, sniffType, cleanName, downloadName } from './files.js';

const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const CONSENT_VERSION = '2026-11-27';
const TTL = {
  draft: 7 * DAY,          // Entwurf ohne E-Mail-Bestätigung: danach automatisch gelöscht
  spieler: 30 * DAY,
  kanzlei: 12 * HOUR,
  pending: 10 * MIN,       // zwischen E-Mail-Code und TOTP
  code: 15 * MIN,
  link: 5 * MIN,           // kurzlebiger Datei-Link (Frontend erneuert im Hintergrund)
  device: 30 * DAY,        // "Gerät 30 Tage merken"
};
const MAX_FILES_PER_CASE = 40;
const MAX_CODE_ATTEMPTS = 5;

const SPIELARTEN = ['online-casino', 'sportwetten', 'slots', 'poker', 'sonstiges'];
const VERLUST = ['unter-1000', '1000-5000', '5000-10000', '10000-25000', '25000-50000', '50000-100000', 'ueber-100000', 'unbekannt'];
const BUNDESLAENDER = ['BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH', 'ausland'];
const EMAIL_RE = /^[^\s@<>()"',;]{1,64}@[^\s@<>()"',;]{1,190}\.[^\s@<>()"',;]{2,24}$/;

/* ---------------- Hilfen ---------------- */
function origins(env) { return String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean); }
function isLocal(request) { const h = new URL(request.url).hostname; return h === 'localhost' || h === '127.0.0.1'; }
function corsHeaders(env, origin) {
  const h = { 'Vary': 'Origin', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  if (origins(env).includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Beleg-Art, X-Dateiname, X-Umgewandelt';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}
class HttpError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
const fail = (status, code) => { throw new HttpError(status, code); };
const now = () => Date.now();

async function readJson(request, max = 16 * 1024) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > max) fail(413, 'zu_gross');
  const txt = await request.text();
  if (txt.length > max) fail(413, 'zu_gross');
  try { return JSON.parse(txt || '{}'); } catch { fail(400, 'ungueltig'); }
}
async function audit(env, actorKind, actorId, action, caseId = null, fileId = null) {
  await env.DB.prepare('INSERT INTO audit (at, actor_kind, actor_id, action, case_id, file_id) VALUES (?,?,?,?,?,?)')
    .bind(now(), actorKind, actorId, action, caseId, fileId).run();
}
const normEmail = (e) => String(e || '').trim().toLowerCase();
const emailHash = (env, email) => hmacHex(env, 'email|' + normEmail(email));

async function rateLimit(env, request, bucket) {
  if (env.RATELIMIT_DISABLED === '1' && isLocal(request)) return; // nur lokale Tests
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const binding = bucket === 'auth' ? env.RL_AUTH : env.RL_API;
  if (binding) {
    const r = await binding.limit({ key: bucket + ':' + ip });
    if (!r.success) fail(429, 'zu_viele_anfragen');
  }
}

async function verifyTurnstile(env, request, token) {
  if (env.TURNSTILE_DISABLED === '1' && isLocal(request)) return; // nur lokale Tests
  if (!env.TURNSTILE_SECRET) fail(500, 'turnstile_nicht_konfiguriert');
  if (!token || token.length > 2048) fail(400, 'turnstile_fehlt');
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  const ip = request.headers.get('CF-Connecting-IP'); if (ip) body.append('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  const j = await r.json().catch(() => ({}));
  if (!j.success) fail(403, 'turnstile_ungueltig');
}

/* ---------------- Sitzungen ---------------- */
async function createSession(env, kind, subject, ttl) {
  const token = randomToken(32);
  const t = now();
  await env.DB.prepare('INSERT INTO sessions (id_hash, kind, subject, created_at, expires_at) VALUES (?,?,?,?,?)')
    .bind(await hmacHex(env, 'sess|' + token), kind, subject, t, t + ttl).run();
  return { token, expiresAt: t + ttl };
}
async function getSession(env, request, kinds) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(request.headers.get('Authorization') || '');
  if (!m) fail(401, 'nicht_angemeldet');
  const idHash = await hmacHex(env, 'sess|' + m[1]);
  const s = await env.DB.prepare('SELECT * FROM sessions WHERE id_hash = ?').bind(idHash).first();
  if (!s || s.expires_at < now() || !kinds.includes(s.kind)) fail(401, 'nicht_angemeldet');
  s.token = m[1];
  return s;
}
async function deleteSession(env, s) { await env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(s.id_hash).run(); }

/* ---------------- E-Mail (Login-Code + Magic-Link) ---------------- */
async function sendLoginMail(env, request, to, code, link, purpose) {
  const betreff = purpose === 'kanzlei_login' ? 'Ihr Anmeldecode für GetMyRight (Kanzlei)' : 'Ihr Bestätigungscode für GetMyRight';
  const text = `Ihr Code: ${code}\n\nGeben Sie den Code auf der Seite ein, auf der Sie ihn angefordert haben. Oder öffnen Sie diesen Link (gültig 15 Minuten):\n${link}\n\nWenn Sie das nicht waren, ignorieren Sie diese E-Mail.\n\nGetMyRight · ${env.SITE_URL || 'https://getmyright.de'}`;
  if (env.MAIL_MODE === 'log') {
    if (!isLocal(request)) fail(500, 'mail_nicht_konfiguriert');
    console.log('[lokal] Login-Mail an <verborgen>, Code und Link nur lokal sichtbar:', code, link);
    return;
  }
  if (!env.BREVO_API_KEY) fail(500, 'mail_nicht_konfiguriert');
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ sender: { email: env.MAIL_FROM || 'info@getmyright.de', name: 'GetMyRight' }, to: [{ email: to }], subject: betreff, textContent: text }),
  });
  if (!r.ok) fail(502, 'mail_fehlgeschlagen');
}
async function issueCode(env, request, email, purpose, caseId, sitePath) {
  const eh = await emailHash(env, email);
  const code = randomCode6(), linkToken = randomToken(24), t = now();
  await env.DB.prepare(`INSERT INTO login_codes (email_hash, purpose, code_hash, link_hash, case_id, attempts, created_at, expires_at)
    VALUES (?,?,?,?,?,0,?,?) ON CONFLICT(email_hash, purpose) DO UPDATE SET code_hash=excluded.code_hash, link_hash=excluded.link_hash,
    case_id=excluded.case_id, attempts=0, created_at=excluded.created_at, expires_at=excluded.expires_at`)
    .bind(eh, purpose, await hmacHex(env, 'code|' + eh + '|' + code), await hmacHex(env, 'link|' + linkToken), caseId, t, t + TTL.code).run();
  const link = `${env.SITE_URL || 'https://getmyright.de'}${sitePath}#z=${purpose}&link=${linkToken}&e=${encodeURIComponent(normEmail(email))}`;
  await sendLoginMail(env, request, normEmail(email), code, link, purpose);
  return (env.DEV_EXPOSE_CODES === '1' && isLocal(request)) ? { devCode: code, devLink: linkToken } : {};
}
/** Prüft Code ODER Magic-Link-Token. Gibt die Code-Zeile zurück und löscht sie (einmalig). */
async function consumeCode(env, email, purpose, code, linkToken) {
  const eh = await emailHash(env, email);
  const row = await env.DB.prepare('SELECT * FROM login_codes WHERE email_hash = ? AND purpose = ?').bind(eh, purpose).first();
  if (!row || row.expires_at < now()) fail(400, 'code_abgelaufen');
  if (row.attempts >= MAX_CODE_ATTEMPTS) fail(429, 'zu_viele_versuche');
  let ok = false;
  if (code && /^\d{6}$/.test(code)) ok = (await hmacHex(env, 'code|' + eh + '|' + code)) === row.code_hash;
  else if (linkToken && /^[A-Za-z0-9_-]{20,64}$/.test(linkToken)) ok = (await hmacHex(env, 'link|' + linkToken)) === row.link_hash;
  if (!ok) {
    await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email_hash = ? AND purpose = ?').bind(eh, purpose).run();
    fail(400, 'code_falsch');
  }
  await env.DB.prepare('DELETE FROM login_codes WHERE email_hash = ? AND purpose = ?').bind(eh, purpose).run();
  return { ...row, emailHash: eh };
}

/* ---------------- Fälle ---------------- */
function validateAnswers(a) {
  if (!a || typeof a !== 'object') fail(400, 'antworten_fehlen');
  const anbieter = String(a.anbieter || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 80);
  const spielart = String(a.spielart || '');
  const von = Number(a.von), bis = Number(a.bis);
  const verlust = String(a.verlust || '');
  const bundesland = String(a.bundesland || '');
  const jahr = new Date().getUTCFullYear();
  if (!anbieter) fail(400, 'anbieter_fehlt');
  if (!SPIELARTEN.includes(spielart)) fail(400, 'spielart_ungueltig');
  if (!Number.isInteger(von) || !Number.isInteger(bis) || von < 2000 || bis > jahr || von > bis) fail(400, 'zeitraum_ungueltig');
  if (!VERLUST.includes(verlust)) fail(400, 'verlust_ungueltig');
  if (!BUNDESLAENDER.includes(bundesland)) fail(400, 'bundesland_ungueltig');
  return { anbieter, spielart, von, bis, verlust, bundesland };
}
function canAccessCase(session, c) {
  return session.subject === c.id || (c.email_hash && session.subject === 'e:' + c.email_hash);
}
async function loadCase(env, id) {
  if (!/^[0-9a-f-]{36}$/.test(id || '')) fail(404, 'fall_unbekannt');
  const c = await env.DB.prepare('SELECT * FROM cases WHERE id = ?').bind(id).first();
  if (!c) fail(404, 'fall_unbekannt');
  return c;
}
async function checklist(env, caseId) {
  const files = (await env.DB.prepare('SELECT item, COUNT(*) AS n FROM files WHERE case_id = ? AND deleted_at IS NULL GROUP BY item').bind(caseId).all()).results;
  const marks = (await env.DB.prepare('SELECT item, status FROM checklist_marks WHERE case_id = ?').bind(caseId).all()).results;
  const n = Object.fromEntries(files.map((r) => [r.item, r.n]));
  const m = Object.fromEntries(marks.map((r) => [r.item, r.status]));
  return ['kontoauszug', 'spielverlauf', 'oasis'].map((item) => ({
    item, label: ITEM_LABEL[item], anzahl: n[item] || 0,
    status: n[item] ? 'hochgeladen' : (m[item] === 'angefordert' ? 'angefordert' : 'fehlt'),
  })).concat(n.sonstiges ? [{ item: 'sonstiges', label: ITEM_LABEL.sonstiges, anzahl: n.sonstiges, status: 'hochgeladen' }] : []);
}
async function fileList(env, caseId) {
  const rows = (await env.DB.prepare('SELECT id, item, mime, size, name_enc, converted, created_at FROM files WHERE case_id = ? AND deleted_at IS NULL ORDER BY created_at').bind(caseId).all()).results;
  const out = [];
  for (const r of rows) out.push({ id: r.id, item: r.item, mime: r.mime, size: r.size, name: await openText(env, r.name_enc, 'name|' + r.id), umgewandelt: !!r.converted, hochgeladen: r.created_at });
  return out;
}
async function kanzleiName(env, id) {
  if (!id) return null;
  const k = await env.DB.prepare('SELECT name FROM kanzleien WHERE id = ?').bind(id).first();
  return k ? k.name : null;
}
async function playerCaseView(env, c) {
  return {
    id: c.id, status: c.status, antworten: JSON.parse(c.answers), bestaetigt: !!c.confirmed_at,
    kanzlei: c.status === 'uebernommen' ? await kanzleiName(env, c.claimed_by) : null,
    checkliste: await checklist(env, c.id), belege: await fileList(env, c.id),
  };
}

/* ---------------- Routen: Spieler ---------------- */
async function spielerFallAnlegen(env, request) {
  await rateLimit(env, request, 'auth');
  const b = await readJson(request);
  await verifyTurnstile(env, request, b.turnstile);
  if (b.einwilligung !== true || b.einwilligungVersion !== CONSENT_VERSION) fail(400, 'einwilligung_fehlt');
  const answers = validateAnswers(b.antworten);
  const id = crypto.randomUUID(), t = now();
  await env.DB.prepare('INSERT INTO cases (id, status, answers, consent_version, consent_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
    .bind(id, 'entwurf', JSON.stringify(answers), CONSENT_VERSION, t, t, t).run();
  await audit(env, 'spieler', id, 'fall_angelegt', id);
  const s = await createSession(env, 'spieler', id, TTL.draft);
  return { fallId: id, sitzung: s.token, gueltigBis: s.expiresAt };
}
async function spielerFaelle(env, request) {
  const s = await getSession(env, request, ['spieler']);
  const rows = s.subject.startsWith('e:')
    ? (await env.DB.prepare('SELECT * FROM cases WHERE email_hash = ? ORDER BY created_at DESC').bind(s.subject.slice(2)).all()).results
    : (await env.DB.prepare('SELECT * FROM cases WHERE id = ?').bind(s.subject).all()).results;
  const out = [];
  for (const c of rows) out.push(await playerCaseView(env, c));
  return { faelle: out };
}
async function spielerBelegHochladen(env, request, caseId) {
  await rateLimit(env, request, 'api');
  const s = await getSession(env, request, ['spieler']);
  const c = await loadCase(env, caseId);
  if (!canAccessCase(s, c)) fail(403, 'kein_zugriff');
  if (c.status === 'geschlossen') fail(409, 'fall_geschlossen');
  const item = request.headers.get('X-Beleg-Art') || '';
  if (!ITEMS.includes(item)) fail(400, 'belegart_ungueltig');
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BYTES) fail(413, 'datei_zu_gross');
  const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM files WHERE case_id = ? AND deleted_at IS NULL').bind(caseId).first();
  if (cnt.n >= MAX_FILES_PER_CASE) fail(409, 'zu_viele_dateien');
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.length === 0) fail(400, 'datei_leer');
  if (buf.length > MAX_BYTES) fail(413, 'datei_zu_gross');
  const mime = sniffType(buf);
  if (!mime) fail(415, 'dateityp_nicht_erlaubt');
  let name = 'beleg';
  try { name = decodeURIComponent(request.headers.get('X-Dateiname') || 'beleg'); } catch { /* Standardname */ }
  name = cleanName(name, mime);
  const fileId = crypto.randomUUID();
  const aad = caseId + '|' + fileId;
  const sha = await sha256Hex(buf);
  const size = buf.length;
  const enc = await encryptBlob(env, buf, aad);
  buf.fill(0);
  await env.FILES.put(`faelle/${caseId}/${fileId}`, enc.ciphertext, {
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: { keyId: enc.keyId, iv: enc.iv, wrappedDek: enc.wrappedDek },
  });
  await env.DB.batch([
    env.DB.prepare('INSERT INTO files (id, case_id, item, mime, size, name_enc, sha256, key_id, iv, wrapped_dek, converted, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(fileId, caseId, item, mime, size, await sealText(env, name, 'name|' + fileId), sha, enc.keyId, enc.iv, enc.wrappedDek, request.headers.get('X-Umgewandelt') === '1' ? 1 : 0, now()),
    env.DB.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').bind(now(), caseId),
  ]);
  await audit(env, 'spieler', caseId, 'beleg_hochgeladen', caseId, fileId);
  return { id: fileId, item, mime, name, checkliste: await checklist(env, caseId) };
}
async function spielerBelegLoeschen(env, request, caseId, fileId) {
  const s = await getSession(env, request, ['spieler']);
  const c = await loadCase(env, caseId);
  if (!canAccessCase(s, c)) fail(403, 'kein_zugriff');
  if (c.status === 'uebernommen' || c.status === 'geschlossen') fail(409, 'fall_uebernommen'); // danach nur über die Kanzlei
  const f = await env.DB.prepare('SELECT id FROM files WHERE id = ? AND case_id = ? AND deleted_at IS NULL').bind(fileId, caseId).first();
  if (!f) fail(404, 'beleg_unbekannt');
  await env.FILES.delete(`faelle/${caseId}/${fileId}`);
  await env.DB.prepare('UPDATE files SET deleted_at = ?, name_enc = \'\', wrapped_dek = \'\' WHERE id = ?').bind(now(), fileId).run();
  await audit(env, 'spieler', caseId, 'beleg_geloescht', caseId, fileId);
  return { ok: true, checkliste: await checklist(env, caseId) };
}
async function spielerChecklisteMarkieren(env, request, caseId) {
  const s = await getSession(env, request, ['spieler']);
  const c = await loadCase(env, caseId);
  if (!canAccessCase(s, c)) fail(403, 'kein_zugriff');
  const b = await readJson(request);
  if (!['kontoauszug', 'spielverlauf', 'oasis'].includes(b.item)) fail(400, 'belegart_ungueltig');
  if (b.angefordert) {
    await env.DB.prepare('INSERT INTO checklist_marks (case_id, item, status, updated_at) VALUES (?,?,?,?) ON CONFLICT(case_id, item) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at')
      .bind(caseId, b.item, 'angefordert', now()).run();
  } else {
    await env.DB.prepare('DELETE FROM checklist_marks WHERE case_id = ? AND item = ?').bind(caseId, b.item).run();
  }
  return { checkliste: await checklist(env, caseId) };
}
/** Schritt "Konto später": E-Mail am Ende bestätigen. Code + Link gehen per Mail. */
async function spielerBestaetigungAnfordern(env, request, caseId) {
  await rateLimit(env, request, 'auth');
  const s = await getSession(env, request, ['spieler']);
  const c = await loadCase(env, caseId);
  if (!canAccessCase(s, c)) fail(403, 'kein_zugriff');
  const b = await readJson(request);
  const email = normEmail(b.email);
  if (!EMAIL_RE.test(email)) fail(400, 'email_ungueltig');
  return { ok: true, ...(await issueCode(env, request, email, 'spieler_bestaetigen', caseId, '/spieler/fall.html')) };
}
/** Bestätigung per Code (gleicher Browser) oder Magic-Link (auch im Browser der Mail-App).
 * Braucht keine Entwurfs-Sitzung: der Code ist an E-Mail + Fall gebunden, höchstens 5 Versuche. */
async function spielerBestaetigen(env, request) {
  await rateLimit(env, request, 'auth');
  const b = await readJson(request);
  const email = normEmail(b.email);
  const row = await consumeCode(env, email, 'spieler_bestaetigen', b.code, b.link);
  const caseId = row.case_id;
  const c = await loadCase(env, caseId);
  const t = now();
  await env.DB.batch([
    env.DB.prepare('UPDATE cases SET email_hash = ?, email_enc = ?, confirmed_at = ?, status = CASE WHEN status = \'entwurf\' THEN \'offen\' ELSE status END, updated_at = ? WHERE id = ?')
      .bind(row.emailHash, await sealText(env, email, 'email|case|' + caseId), t, t, caseId),
    env.DB.prepare('DELETE FROM sessions WHERE kind = \'spieler\' AND subject = ?').bind(c.id), // Entwurfs-Sitzung endet
  ]);
  await audit(env, 'spieler', caseId, 'email_bestaetigt', caseId);
  const ns = await createSession(env, 'spieler', 'e:' + row.emailHash, TTL.spieler);
  return { sitzung: ns.token, gueltigBis: ns.expiresAt, fallId: caseId };
}
/** Späterer Login (Fall existiert schon): immer gleiche Antwort, damit niemand E-Mails ausprobieren kann. */
async function spielerLoginAnfordern(env, request) {
  await rateLimit(env, request, 'auth');
  const b = await readJson(request);
  await verifyTurnstile(env, request, b.turnstile);
  const email = normEmail(b.email);
  if (!EMAIL_RE.test(email)) fail(400, 'email_ungueltig');
  const eh = await emailHash(env, email);
  const has = await env.DB.prepare('SELECT id FROM cases WHERE email_hash = ? LIMIT 1').bind(eh).first();
  const dev = has ? await issueCode(env, request, email, 'spieler_login', null, '/spieler/fall.html') : {};
  return { ok: true, ...dev };
}
async function spielerLogin(env, request) {
  await rateLimit(env, request, 'auth');
  const b = await readJson(request);
  const row = await consumeCode(env, normEmail(b.email), 'spieler_login', b.code, b.link);
  const s = await createSession(env, 'spieler', 'e:' + row.emailHash, TTL.spieler);
  return { sitzung: s.token, gueltigBis: s.expiresAt };
}

/* ---------------- Routen: Kanzlei (E-Mail-Code + Pflicht-TOTP) ---------------- */
async function kanzleiLoginAnfordern(env, request) {
  await rateLimit(env, request, 'auth');
  const b = await readJson(request);
  await verifyTurnstile(env, request, b.turnstile);
  const email = normEmail(b.email);
  if (!EMAIL_RE.test(email)) fail(400, 'email_ungueltig');
  const k = await env.DB.prepare('SELECT id FROM kanzleien WHERE email_hash = ? AND active = 1').bind(await emailHash(env, email)).first();
  const dev = k ? await issueCode(env, request, email, 'kanzlei_login', null, '/kanzlei/faelle.html') : {};
  return { ok: true, ...dev };
}
async function kanzleiCodePruefen(env, request) {
  await rateLimit(env, request, 'auth');
  const b = await readJson(request);
  const row = await consumeCode(env, normEmail(b.email), 'kanzlei_login', b.code, b.link);
  const k = await env.DB.prepare('SELECT * FROM kanzleien WHERE email_hash = ? AND active = 1').bind(row.emailHash).first();
  if (!k) fail(403, 'kein_zugriff');
  // "Gerät 30 Tage merken": gültiges Geräte-Token ersetzt den TOTP-Schritt (nur wenn TOTP eingerichtet ist)
  if (k.totp_confirmed && typeof b.geraet === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(b.geraet)) {
    const d = await env.DB.prepare('SELECT * FROM devices WHERE id_hash = ?').bind(await hmacHex(env, 'dev|' + b.geraet)).first();
    if (d && d.kanzlei_id === k.id && d.expires_at > now()) {
      const s = await createSession(env, 'kanzlei', k.id, TTL.kanzlei);
      await audit(env, 'kanzlei', k.id, 'login_geraet');
      return { schritt: 'fertig', sitzung: s.token, gueltigBis: s.expiresAt, kanzlei: k.name };
    }
  }
  const p = await createSession(env, 'kanzlei_pending', k.id, TTL.pending);
  if (!k.totp_confirmed) {
    const secret = base32Encode(randomBytes(20));
    await env.DB.prepare('UPDATE kanzleien SET totp_secret_enc = ? WHERE id = ?').bind(await sealText(env, secret, 'totp|' + k.id), k.id).run();
    const label = encodeURIComponent('GetMyRight:' + k.name);
    return { schritt: 'totp_einrichten', zwischen: p.token, secret, otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=GetMyRight&algorithm=SHA1&digits=6&period=30` };
  }
  return { schritt: 'totp', zwischen: p.token };
}
async function kanzleiTotp(env, request) {
  await rateLimit(env, request, 'auth');
  const b = await readJson(request);
  const m = /^[A-Za-z0-9_-]{20,100}$/.exec(b.zwischen || '');
  if (!m) fail(401, 'nicht_angemeldet');
  const p = await env.DB.prepare('SELECT * FROM sessions WHERE id_hash = ?').bind(await hmacHex(env, 'sess|' + b.zwischen)).first();
  if (!p || p.kind !== 'kanzlei_pending' || p.expires_at < now()) fail(401, 'nicht_angemeldet');
  const k = await env.DB.prepare('SELECT * FROM kanzleien WHERE id = ? AND active = 1').bind(p.subject).first();
  if (!k || !k.totp_secret_enc) fail(401, 'nicht_angemeldet');
  const secret = await openText(env, k.totp_secret_enc, 'totp|' + k.id);
  const ctr = await verifyTotp(secret, String(b.code || ''), now(), k.totp_last_counter);
  if (ctr < 0) fail(400, 'code_falsch');
  await env.DB.batch([
    env.DB.prepare('UPDATE kanzleien SET totp_confirmed = 1, totp_last_counter = ? WHERE id = ?').bind(ctr, k.id),
    env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(p.id_hash),
  ]);
  const s = await createSession(env, 'kanzlei', k.id, TTL.kanzlei);
  const out = { schritt: 'fertig', sitzung: s.token, gueltigBis: s.expiresAt, kanzlei: k.name };
  if (b.merken === true) {
    const dev = randomToken(32), t = now();
    await env.DB.prepare('INSERT INTO devices (id_hash, kanzlei_id, created_at, expires_at) VALUES (?,?,?,?)').bind(await hmacHex(env, 'dev|' + dev), k.id, t, t + TTL.device).run();
    out.geraet = dev; out.geraetBis = t + TTL.device;
  }
  await audit(env, 'kanzlei', k.id, k.totp_confirmed ? 'login_totp' : 'totp_eingerichtet');
  return out;
}
async function kanzleiFaelle(env, request) {
  await rateLimit(env, request, 'api');
  const s = await getSession(env, request, ['kanzlei']);
  const offen = (await env.DB.prepare('SELECT id, answers, created_at, updated_at FROM cases WHERE status = \'offen\' ORDER BY updated_at DESC LIMIT 200').all()).results;
  const meine = (await env.DB.prepare('SELECT id, answers, status, claimed_at, updated_at FROM cases WHERE claimed_by = ? ORDER BY claimed_at DESC LIMIT 200').bind(s.subject).all()).results;
  const map = async (rows) => Promise.all(rows.map(async (c) => ({ id: c.id, antworten: JSON.parse(c.answers), status: c.status || 'offen', aktualisiert: c.updated_at, checkliste: await checklist(env, c.id) })));
  return { kanzlei: await kanzleiName(env, s.subject), offen: await map(offen), meine: await map(meine) };
}
async function kanzleiUebernehmen(env, request, caseId) {
  const s = await getSession(env, request, ['kanzlei']);
  await loadCase(env, caseId);
  const r = await env.DB.prepare('UPDATE cases SET status = \'uebernommen\', claimed_by = ?, claimed_at = ?, updated_at = ? WHERE id = ? AND status = \'offen\' AND claimed_by IS NULL')
    .bind(s.subject, now(), now(), caseId).run();
  if (!r.meta.changes) fail(409, 'bereits_uebernommen');
  await audit(env, 'kanzlei', s.subject, 'uebernommen', caseId);
  return { ok: true };
}
async function kanzleiFall(env, request, caseId) {
  const s = await getSession(env, request, ['kanzlei']);
  const c = await loadCase(env, caseId);
  if (c.claimed_by !== s.subject) fail(403, 'kein_zugriff'); // Belege erst nach Übernahme
  const belege = await fileList(env, caseId);
  belege.forEach((f, i) => { f.downloadName = downloadName(caseId, f.item, f.hochgeladen, f.mime, i + 1); });
  await audit(env, 'kanzlei', s.subject, 'fall_angesehen', caseId);
  return { id: c.id, status: c.status, antworten: JSON.parse(c.answers), checkliste: await checklist(env, caseId), belege };
}
/** Kurzlebiger, an Kanzlei + Sitzung gebundener Link. Das Frontend erneuert ihn im Hintergrund. */
async function kanzleiLink(env, request, fileId) {
  await rateLimit(env, request, 'api');
  const s = await getSession(env, request, ['kanzlei']);
  const f = await env.DB.prepare('SELECT f.id, f.case_id, c.claimed_by FROM files f JOIN cases c ON c.id = f.case_id WHERE f.id = ? AND f.deleted_at IS NULL').bind(fileId).first();
  if (!f || f.claimed_by !== s.subject) fail(403, 'kein_zugriff');
  const b = await readJson(request);
  const disp = b.download ? 'a' : 'i';
  const exp = now() + TTL.link;
  const sid = s.id_hash.slice(0, 16);
  const sig = await sign(env, ['datei', fileId, exp, s.subject, sid, disp].join('|'));
  await audit(env, 'kanzlei', s.subject, disp === 'a' ? 'download_link' : 'vorschau_link', f.case_id, fileId);
  const base = new URL(request.url).origin;
  return { url: `${base}/api/datei/${fileId}?exp=${exp}&k=${encodeURIComponent(s.subject)}&sid=${sid}&d=${disp}&sig=${sig}`, gueltigBis: exp };
}
async function dateiAbrufen(env, request, fileId) {
  const u = new URL(request.url);
  const exp = Number(u.searchParams.get('exp')), k = u.searchParams.get('k') || '', sid = u.searchParams.get('sid') || '';
  const disp = u.searchParams.get('d') === 'a' ? 'a' : 'i', sig = u.searchParams.get('sig') || '';
  if (!exp || exp < now() || exp > now() + TTL.link + MIN) fail(403, 'link_abgelaufen');
  if (!(await verifySig(env, ['datei', fileId, exp, k, sid, disp].join('|'), sig))) fail(403, 'link_ungueltig');
  // Sitzung muss noch leben und die Kanzlei muss den Fall weiterhin halten
  const sess = await env.DB.prepare('SELECT 1 FROM sessions WHERE substr(id_hash,1,16) = ? AND subject = ? AND kind = \'kanzlei\' AND expires_at > ?').bind(sid, k, now()).first();
  if (!sess) fail(403, 'link_ungueltig');
  const f = await env.DB.prepare('SELECT f.*, c.claimed_by FROM files f JOIN cases c ON c.id = f.case_id WHERE f.id = ? AND f.deleted_at IS NULL').bind(fileId).first();
  if (!f || f.claimed_by !== k) fail(403, 'kein_zugriff');
  const obj = await env.FILES.get(`faelle/${f.case_id}/${fileId}`);
  if (!obj) fail(404, 'beleg_unbekannt');
  const plain = await decryptBlob(env, new Uint8Array(await obj.arrayBuffer()), { keyId: f.key_id, iv: f.iv, wrappedDek: f.wrapped_dek }, f.case_id + '|' + fileId);
  await audit(env, 'kanzlei', k, disp === 'a' ? 'beleg_heruntergeladen' : 'beleg_angesehen', f.case_id, fileId);
  const idx = (await env.DB.prepare('SELECT COUNT(*) AS n FROM files WHERE case_id = ? AND created_at <= ? AND deleted_at IS NULL').bind(f.case_id, f.created_at).first()).n;
  const name = downloadName(f.case_id, f.item, f.created_at, f.mime, idx);
  return new Response(plain, {
    headers: {
      'Content-Type': f.mime,
      'Content-Disposition': `${disp === 'a' ? 'attachment' : 'inline'}; filename="${name}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
async function abmelden(env, request) {
  const s = await getSession(env, request, ['spieler', 'kanzlei']);
  await deleteSession(env, s);
  return { ok: true };
}

/* ---------------- Aufräumen (Cron) ---------------- */
async function cleanup(env) {
  const t = now();
  const drafts = (await env.DB.prepare('SELECT id FROM cases WHERE status = \'entwurf\' AND created_at < ?').bind(t - TTL.draft).all()).results;
  for (const c of drafts) {
    const files = (await env.DB.prepare('SELECT id FROM files WHERE case_id = ?').bind(c.id).all()).results;
    if (files.length) await env.FILES.delete(files.map((f) => `faelle/${c.id}/${f.id}`));
    await env.DB.batch([
      env.DB.prepare('DELETE FROM files WHERE case_id = ?').bind(c.id),
      env.DB.prepare('DELETE FROM checklist_marks WHERE case_id = ?').bind(c.id),
      env.DB.prepare('DELETE FROM cases WHERE id = ?').bind(c.id),
    ]);
    await audit(env, 'system', null, 'entwurf_geloescht', c.id);
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t),
    env.DB.prepare('DELETE FROM login_codes WHERE expires_at < ?').bind(t),
    env.DB.prepare('DELETE FROM devices WHERE expires_at < ?').bind(t),
  ]);
  return { entwuerfeGeloescht: drafts.length };
}

/* ---------------- Router ---------------- */
const UUID = '([0-9a-f-]{36})';
const ROUTES = [
  ['POST', /^\/api\/spieler\/fall$/, spielerFallAnlegen],
  ['GET', /^\/api\/spieler\/faelle$/, spielerFaelle],
  ['PUT', new RegExp(`^/api/spieler/fall/${UUID}/belege$`), spielerBelegHochladen],
  ['DELETE', new RegExp(`^/api/spieler/fall/${UUID}/belege/${UUID}$`), spielerBelegLoeschen],
  ['POST', new RegExp(`^/api/spieler/fall/${UUID}/checkliste$`), spielerChecklisteMarkieren],
  ['POST', new RegExp(`^/api/spieler/fall/${UUID}/bestaetigung$`), spielerBestaetigungAnfordern],
  ['POST', /^\/api\/spieler\/bestaetigen$/, spielerBestaetigen],
  ['POST', /^\/api\/spieler\/login\/anfordern$/, spielerLoginAnfordern],
  ['POST', /^\/api\/spieler\/login$/, spielerLogin],
  ['POST', /^\/api\/kanzlei\/login\/anfordern$/, kanzleiLoginAnfordern],
  ['POST', /^\/api\/kanzlei\/login\/code$/, kanzleiCodePruefen],
  ['POST', /^\/api\/kanzlei\/login\/totp$/, kanzleiTotp],
  ['GET', /^\/api\/kanzlei\/faelle$/, kanzleiFaelle],
  ['POST', new RegExp(`^/api/kanzlei/faelle/${UUID}/uebernehmen$`), kanzleiUebernehmen],
  ['GET', new RegExp(`^/api/kanzlei/faelle/${UUID}$`), kanzleiFall],
  ['POST', new RegExp(`^/api/kanzlei/dateien/${UUID}/link$`), kanzleiLink],
  ['GET', new RegExp(`^/api/datei/${UUID}$`), dateiAbrufen],
  ['POST', /^\/api\/abmelden$/, abmelden],
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(env, origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: origins(env).includes(origin) ? 204 : 403, headers: cors });
    try {
      for (const [method, re, handler] of ROUTES) {
        const m = re.exec(url.pathname);
        if (!m || method !== request.method) continue;
        const isFile = handler === dateiAbrufen;
        // Browser-Anfragen nur von getmyright.de (Datei-Links sind signiert und kommen als <img>/Download)
        if (!isFile && origin && !origins(env).includes(origin)) fail(403, 'origin');
        if (!isFile && !origin && request.method !== 'GET' && !isLocal(request)) fail(403, 'origin');
        const res = await handler(env, request, ...m.slice(1));
        if (res instanceof Response) return res;
        return new Response(JSON.stringify(res), { status: 200, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
      }
      fail(404, 'nicht_gefunden');
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error('Fehler', e && e.message); // keine Inhalte/E-Mails loggen
      return new Response(JSON.stringify({ fehler: e instanceof HttpError ? e.code : 'serverfehler' }), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(cleanup(env));
  },
};
