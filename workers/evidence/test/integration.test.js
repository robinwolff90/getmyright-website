import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startLocalWorker } from './helpers.mjs';
import { totpAt } from '../src/crypto.js';

let w;
const ORIGIN = 'http://127.0.0.1:8080';
before(async () => { w = await startLocalWorker({ kanzleien: [['Kanzlei Alpha', 'alpha@example.de'], ['Kanzlei Beta', 'beta@example.de']] }); });
after(async () => { if (w) await w.stop(); });

async function api(method, path, { token, body, headers = {}, raw } = {}) {
  const h = { Origin: ORIGIN, ...headers };
  if (token) h.Authorization = 'Bearer ' + token;
  let b;
  if (raw) b = raw; else if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch(w.base + path, { method, headers: h, body: b });
  const ct = r.headers.get('Content-Type') || '';
  return { status: r.status, headers: r.headers, json: ct.includes('json') ? await r.json() : null, bytes: ct.includes('json') ? null : new Uint8Array(await r.arrayBuffer()) };
}
const ANTWORTEN = { anbieter: 'Beispiel-Casino', spielart: 'online-casino', von: 2019, bis: 2022, verlust: '10000-25000', bundesland: 'NW' };
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const state = {};

async function kanzleiLogin(email, kanzleiState) {
  let r = await api('POST', '/api/kanzlei/login/anfordern', { body: { email, turnstile: 'x' } });
  assert.equal(r.status, 200); assert.match(r.json.devCode, /^\d{6}$/);
  r = await api('POST', '/api/kanzlei/login/code', { body: { email, code: r.json.devCode, geraet: kanzleiState.geraet } });
  assert.equal(r.status, 200);
  if (r.json.schritt === 'fertig') return r.json;
  if (r.json.schritt === 'totp_einrichten') { kanzleiState.secret = r.json.secret; assert.match(r.json.otpauth, /^otpauth:\/\/totp\//); }
  assert.ok(kanzleiState.secret);
  // Code des nächsten Zeitfensters vermeidet Wiederverwendungs-Sperre bei zwei Logins in 30 s
  const ctr = Math.floor(Date.now() / 30000) + (kanzleiState.used ? 1 : 0);
  kanzleiState.used = true;
  const t = await api('POST', '/api/kanzlei/login/totp', { body: { zwischen: r.json.zwischen, code: await totpAt(kanzleiState.secret, ctr), merken: true } });
  assert.equal(t.status, 200, JSON.stringify(t.json));
  assert.equal(t.json.schritt, 'fertig');
  if (t.json.geraet) kanzleiState.geraet = t.json.geraet;
  return t.json;
}

test('Spieler: Fall zuerst ohne Konto, Einwilligung ist Pflicht', async () => {
  let r = await api('POST', '/api/spieler/fall', { body: { antworten: ANTWORTEN, turnstile: 'x' } });
  assert.equal(r.status, 400); assert.equal(r.json.fehler, 'einwilligung_fehlt');
  r = await api('POST', '/api/spieler/fall', { body: { antworten: { ...ANTWORTEN, von: 2023, bis: 2020 }, einwilligung: true, einwilligungVersion: '2026-11-27', turnstile: 'x' } });
  assert.equal(r.json.fehler, 'zeitraum_ungueltig');
  r = await api('POST', '/api/spieler/fall', { body: { antworten: ANTWORTEN, einwilligung: true, einwilligungVersion: '2026-11-27', turnstile: 'x' } });
  assert.equal(r.status, 200);
  state.fall = r.json.fallId; state.spieler = r.json.sitzung;
});

test('Spieler: Upload nur PDF/JPEG/PNG, Checkliste zeigt Stand', async () => {
  let r = await api('PUT', `/api/spieler/fall/${state.fall}/belege`, { token: state.spieler, raw: PDF, headers: { 'X-Beleg-Art': 'kontoauszug', 'X-Dateiname': encodeURIComponent('Auszug März 2025.pdf') } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  state.pdf = r.json.id;
  assert.equal(r.json.checkliste.find((c) => c.item === 'kontoauszug').status, 'hochgeladen');
  assert.equal(r.json.checkliste.find((c) => c.item === 'oasis').status, 'fehlt');
  r = await api('PUT', `/api/spieler/fall/${state.fall}/belege`, { token: state.spieler, raw: PNG, headers: { 'X-Beleg-Art': 'spielverlauf', 'X-Dateiname': 'IMG_0001.HEIC', 'X-Umgewandelt': '1' } });
  assert.equal(r.status, 200); assert.equal(r.json.name, 'IMG_0001.png'); state.png = r.json.id;
  r = await api('PUT', `/api/spieler/fall/${state.fall}/belege`, { token: state.spieler, raw: new TextEncoder().encode('<html><script>alert(1)</script>'), headers: { 'X-Beleg-Art': 'kontoauszug', 'X-Dateiname': 'auszug.pdf' } });
  assert.equal(r.status, 415, 'falsche Endung reicht nicht');
  r = await api('PUT', `/api/spieler/fall/${state.fall}/belege`, { token: state.spieler, raw: new Uint8Array(10 * 1024 * 1024 + 1), headers: { 'X-Beleg-Art': 'kontoauszug' } });
  assert.equal(r.status, 413);
  r = await api('PUT', `/api/spieler/fall/${state.fall}/belege`, { raw: PDF, headers: { 'X-Beleg-Art': 'kontoauszug' } });
  assert.equal(r.status, 401);
  r = await api('POST', `/api/spieler/fall/${state.fall}/checkliste`, { token: state.spieler, body: { item: 'oasis', angefordert: true } });
  assert.equal(r.json.checkliste.find((c) => c.item === 'oasis').status, 'angefordert');
});

test('Gespeichert wird nur verschlüsselt', async () => {
  const { execFileSync } = await import('node:child_process');
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const path = await import('node:path');
  const dir = path.join(process.cwd(), '.test-state', '8799', 'v3', 'r2');
  const all = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else all.push(p); } };
  walk(dir);
  const blobs = all.filter((p) => p.includes('blobs'));
  assert.ok(blobs.length >= 2, 'zwei Objekte im lokalen R2');
  for (const b of blobs) {
    const buf = readFileSync(b);
    assert.ok(!buf.includes(Buffer.from('%PDF')), 'kein PDF-Klartext in R2');
    assert.ok(!buf.includes(Buffer.from('IHDR')), 'kein PNG-Klartext in R2');
  }
  void execFileSync;
});

test('Entwurf ist für Kanzleien unsichtbar, bis die E-Mail bestätigt ist', async () => {
  state.alpha = {}; state.beta = {};
  const a = await kanzleiLogin('alpha@example.de', state.alpha);
  state.alphaTok = a.sitzung;
  let r = await api('GET', '/api/kanzlei/faelle', { token: state.alphaTok });
  assert.equal(r.json.offen.length, 0);
  // Bestätigung am Ende: Code per Mail (lokal ausgegeben), 6-stellig
  r = await api('POST', `/api/spieler/fall/${state.fall}/bestaetigung`, { token: state.spieler, body: { email: 'Spieler@Example.de' } });
  assert.equal(r.status, 200);
  const falsch = await api('POST', '/api/spieler/bestaetigen', { body: { email: 'spieler@example.de', code: r.json.devCode === '000000' ? '111111' : '000000' } });
  assert.equal(falsch.json.fehler, 'code_falsch');
  r = await api('POST', '/api/spieler/bestaetigen', { body: { email: 'spieler@example.de', code: r.json.devCode } });
  assert.equal(r.status, 200);
  const alt = await api('GET', '/api/spieler/faelle', { token: state.spieler });
  assert.equal(alt.status, 401, 'Entwurfs-Sitzung wird ersetzt');
  state.spieler = r.json.sitzung;
  r = await api('GET', '/api/kanzlei/faelle', { token: state.alphaTok });
  assert.equal(r.json.offen.length, 1);
  assert.equal(r.json.offen[0].antworten.anbieter, 'Beispiel-Casino');
  assert.ok(!JSON.stringify(r.json).includes('example.de'), 'keine E-Mail des Spielers vor Übernahme');
  assert.ok(!('belege' in r.json.offen[0]), 'keine Dateien vor Übernahme');
});

test('Magic-Link statt Code funktioniert ebenfalls (späterer Login)', async () => {
  let r = await api('POST', '/api/spieler/login/anfordern', { body: { email: 'spieler@example.de', turnstile: 'x' } });
  assert.ok(r.json.devLink);
  r = await api('POST', '/api/spieler/login', { body: { email: 'spieler@example.de', link: r.json.devLink } });
  assert.equal(r.status, 200);
  const f = await api('GET', '/api/spieler/faelle', { token: r.json.sitzung });
  assert.equal(f.json.faelle[0].id, state.fall);
  const unbekannt = await api('POST', '/api/spieler/login/anfordern', { body: { email: 'niemand@example.de', turnstile: 'x' } });
  assert.deepEqual(unbekannt.json, { ok: true }, 'gleiche Antwort für unbekannte E-Mails');
});

test('Claim-Modell: nur eine Kanzlei übernimmt, nur sie sieht die Belege', async () => {
  const b = await kanzleiLogin('beta@example.de', state.beta);
  state.betaTok = b.sitzung;
  let r = await api('GET', `/api/kanzlei/faelle/${state.fall}`, { token: state.alphaTok });
  assert.equal(r.status, 403, 'vor Übernahme kein Zugriff');
  r = await api('POST', `/api/kanzlei/faelle/${state.fall}/uebernehmen`, { token: state.alphaTok });
  assert.equal(r.status, 200);
  r = await api('POST', `/api/kanzlei/faelle/${state.fall}/uebernehmen`, { token: state.betaTok });
  assert.equal(r.status, 409);
  r = await api('GET', `/api/kanzlei/faelle/${state.fall}`, { token: state.betaTok });
  assert.equal(r.status, 403);
  r = await api('GET', `/api/kanzlei/faelle/${state.fall}`, { token: state.alphaTok });
  assert.equal(r.status, 200);
  assert.equal(r.json.belege.length, 2);
  assert.equal(r.json.belege[0].name, 'Auszug März 2025.pdf');
  assert.match(r.json.belege[0].downloadName, /^[0-9a-f]{8}_Kontoauszug_\d{4}-\d\d-\d\d_1\.pdf$/);
  const sp = await api('GET', '/api/spieler/faelle', { token: state.spieler });
  assert.equal(sp.json.faelle[0].kanzlei, 'Kanzlei Alpha');
  const del = await api('DELETE', `/api/spieler/fall/${state.fall}/belege/${state.pdf}`, { token: state.spieler });
  assert.equal(del.status, 409, 'nach Übernahme löscht der Spieler nicht mehr selbst');
});

test('Kurzlebige Links: entschlüsselt, gebunden, manipulationssicher', async () => {
  let r = await api('POST', `/api/kanzlei/dateien/${state.pdf}/link`, { token: state.betaTok, body: {} });
  assert.equal(r.status, 403);
  r = await api('POST', `/api/kanzlei/dateien/${state.pdf}/link`, { token: state.alphaTok, body: { download: true } });
  assert.equal(r.status, 200);
  assert.ok(r.json.gueltigBis - Date.now() <= 5 * 60 * 1000 + 1000);
  const url = new URL(r.json.url);
  let d = await fetch(url);
  assert.equal(d.status, 200);
  assert.deepEqual(new Uint8Array(await d.arrayBuffer()), PDF);
  assert.match(d.headers.get('Content-Disposition'), /^attachment; filename="[0-9a-f]{8}_Kontoauszug_/);
  assert.match(d.headers.get('Content-Security-Policy'), /sandbox/);
  const bad = new URL(url); bad.searchParams.set('exp', String(Number(url.searchParams.get('exp')) + 1000));
  assert.equal((await fetch(bad)).status, 403);
  const other = new URL(url); other.pathname = `/api/datei/${state.png}`;
  assert.equal((await fetch(other)).status, 403, 'Signatur gilt nur für eine Datei');
  // Abmelden macht offene Links sofort ungültig
  r = await api('POST', `/api/kanzlei/dateien/${state.png}/link`, { token: state.alphaTok, body: {} });
  d = await fetch(r.json.url); assert.equal(d.status, 200); assert.equal(d.headers.get('Content-Type'), 'image/png');
  assert.equal((await api('POST', '/api/abmelden', { token: state.alphaTok })).status, 200);
  assert.equal((await fetch(r.json.url)).status, 403);
});

test('Gerät 30 Tage merken überspringt TOTP, ohne Gerät ist TOTP Pflicht', async () => {
  const again = await kanzleiLogin('alpha@example.de', state.alpha);
  assert.equal(again.schritt, 'fertig');
  let r = await api('POST', '/api/kanzlei/login/anfordern', { body: { email: 'alpha@example.de', turnstile: 'x' } });
  r = await api('POST', '/api/kanzlei/login/code', { body: { email: 'alpha@example.de', code: r.json.devCode } });
  assert.equal(r.json.schritt, 'totp');
  r = await api('POST', '/api/kanzlei/login/totp', { body: { zwischen: r.json.zwischen, code: '123456' } });
  assert.ok([400].includes(r.status));
});

test('Code-Versuche sind begrenzt, fremde Origins abgewiesen', async () => {
  let r = await api('POST', `/api/spieler/fall/${state.fall}/bestaetigung`, { token: state.spieler, body: { email: 'spieler@example.de' } });
  const right = r.json.devCode;
  const wrong = right === '000000' ? '000001' : '000000';
  for (let i = 0; i < 5; i++) await api('POST', '/api/spieler/bestaetigen', { body: { email: 'spieler@example.de', code: wrong } });
  r = await api('POST', '/api/spieler/bestaetigen', { body: { email: 'spieler@example.de', code: right } });
  assert.equal(r.status, 429);
  const evil = await fetch(w.base + '/api/spieler/fall', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(evil.status, 403);
  assert.equal(evil.headers.get('Access-Control-Allow-Origin'), null);
});
