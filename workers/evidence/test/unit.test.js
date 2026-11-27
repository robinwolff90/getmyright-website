import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptBlob, decryptBlob, sealText, openText, totpAt, verifyTotp, base32Encode, base32Decode, randomCode6, hmacHex, sign, verifySig } from '../src/crypto.js';
import { sniffType, cleanName, downloadName, MAX_BYTES } from '../src/files.js';

const key = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
const env = { MASTER_KEY: key(), HMAC_KEY: key() };

test('Umschlag-Verschlüsselung: Rundreise und Bindung an Fall/Datei', async () => {
  const plain = crypto.getRandomValues(new Uint8Array(50000));
  const enc = await encryptBlob(env, plain, 'fallA|datei1');
  assert.notDeepEqual(enc.ciphertext.slice(0, 100), plain.slice(0, 100));
  const back = await decryptBlob(env, enc.ciphertext, enc, 'fallA|datei1');
  assert.deepEqual(back, plain);
  await assert.rejects(decryptBlob(env, enc.ciphertext, enc, 'fallB|datei1'), 'anderer Fall darf nicht entschlüsseln');
  await assert.rejects(decryptBlob({ ...env, MASTER_KEY: key() }, enc.ciphertext, enc, 'fallA|datei1'), 'falscher Hauptschlüssel');
  const tampered = enc.ciphertext.slice(); tampered[10] ^= 1;
  await assert.rejects(decryptBlob(env, tampered, enc, 'fallA|datei1'), 'Manipulation fällt auf');
});

test('Textfelder versiegeln', async () => {
  const s = await sealText(env, 'max@example.de', 'email|1');
  assert.ok(!s.includes('max'));
  assert.equal(await openText(env, s, 'email|1'), 'max@example.de');
  await assert.rejects(openText(env, s, 'email|2'));
});

test('TOTP entspricht RFC 6238 (SHA-1)', async () => {
  const secret = base32Encode(new TextEncoder().encode('12345678901234567890'));
  assert.equal(await totpAt(secret, Math.floor(59 / 30)), '287082');
  assert.equal(await totpAt(secret, Math.floor(1111111109 / 30)), '081804');
  assert.equal(await totpAt(secret, Math.floor(1234567890 / 30)), '005924');
  const ctr = await verifyTotp(secret, '081804', 1111111109 * 1000);
  assert.equal(ctr, Math.floor(1111111109 / 30));
  assert.equal(await verifyTotp(secret, '081804', 1111111109 * 1000, ctr), -1, 'Code nicht zweimal nutzbar');
  assert.equal(await verifyTotp(secret, '000000', 1111111109 * 1000), -1);
  assert.deepEqual(base32Decode(secret), new TextEncoder().encode('12345678901234567890'));
});

test('Codes, HMAC und Signaturen', async () => {
  for (let i = 0; i < 200; i++) assert.match(randomCode6(), /^\d{6}$/);
  assert.equal(await hmacHex(env, 'a'), await hmacHex(env, 'a'));
  assert.notEqual(await hmacHex(env, 'a'), await hmacHex({ HMAC_KEY: key() }, 'a'));
  const sig = await sign(env, 'datei|1|2');
  assert.ok(await verifySig(env, 'datei|1|2', sig));
  assert.ok(!(await verifySig(env, 'datei|1|3', sig)));
  assert.ok(!(await verifySig(env, 'datei|1|2', 'kaputt')));
});

test('Dateityp per Signatur, nicht per Endung', () => {
  assert.equal(sniffType(new TextEncoder().encode('%PDF-1.7 ...')), 'application/pdf');
  assert.equal(sniffType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0])), 'image/jpeg');
  assert.equal(sniffType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(sniffType(new TextEncoder().encode('PK\u0003\u0004zip')), null);
  assert.equal(sniffType(new TextEncoder().encode('<html>')), null);
  assert.equal(sniffType(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])), null, 'HEIC wird im Browser umgewandelt, nicht serverseitig angenommen');
  assert.equal(MAX_BYTES, 10 * 1024 * 1024);
});

test('Dateinamen werden bereinigt', () => {
  assert.equal(cleanName('../../etc/passwd', 'application/pdf'), 'passwd.pdf');
  assert.equal(cleanName('Auszug März.pdf', 'application/pdf'), 'Auszug März.pdf');
  assert.equal(cleanName('IMG_0001.HEIC', 'image/jpeg'), 'IMG_0001.jpg');
  assert.equal(cleanName('<script>.png', 'image/png'), 'script.png');
  assert.equal(downloadName('0123456789ab-cdef', 'kontoauszug', Date.UTC(2025, 2, 4), 'application/pdf', 2), '01234567_Kontoauszug_2025-03-04_2.pdf');
  assert.equal(downloadName('0123456789ab-cdef', 'oasis', Date.UTC(2025, 2, 4), 'image/png', 1), '01234567_OASISAuskunft_2025-03-04_1.png');
});
