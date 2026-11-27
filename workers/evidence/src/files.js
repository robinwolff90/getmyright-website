/* Prüfung hochgeladener Belege: nur PDF, JPEG, PNG; Signatur (Magic Bytes) statt Dateiendung. */
export const MAX_BYTES = 10 * 1024 * 1024; // 10 MB nach Verkleinerung im Browser
export const ITEMS = ['kontoauszug', 'spielverlauf', 'oasis', 'sonstiges'];
export const ITEM_LABEL = {
  kontoauszug: 'Kontoauszug',
  spielverlauf: 'Spielverlauf',
  oasis: 'OASIS-Auskunft',
  sonstiges: 'Sonstiger Beleg',
};

export function sniffType(u8) {
  if (u8.length >= 5 && u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46 && u8[4] === 0x2d) return 'application/pdf';
  if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return 'image/jpeg';
  if (u8.length >= 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47 && u8[4] === 0x0d && u8[5] === 0x0a && u8[6] === 0x1a && u8[7] === 0x0a) return 'image/png';
  return null;
}
export const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

/** Bereinigt einen Dateinamen für Anzeige/Download (keine Pfade, keine Steuerzeichen, max. 120 Zeichen). */
export function cleanName(name, mime) {
  let n = String(name || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"<>|*?:]/g, '').trim();
  n = n.replace(/\s+/g, ' ').slice(0, 120);
  if (!n) n = 'beleg';
  const ext = EXT[mime];
  if (ext && !n.toLowerCase().endsWith('.' + ext) && !(ext === 'jpg' && /\.jpe?g$/i.test(n))) n = n.replace(/\.[^.]{1,5}$/, '') + '.' + ext;
  return n;
}

/** Einheitlicher Download-Name: <Fall-Kurz-ID>_<Belegart>_<JJJJ-MM-TT>.<ext> */
export function downloadName(caseId, item, createdAtMs, mime, index) {
  const d = new Date(createdAtMs).toISOString().slice(0, 10);
  return `${caseId.slice(0, 8)}_${ITEM_LABEL[item] ? ITEM_LABEL[item].replace(/[^A-Za-z]/g, '') : 'Beleg'}_${d}_${index}.${EXT[mime] || 'bin'}`;
}
