/* GetMyRight – Belege im Browser vorbereiten (vor dem Upload, nichts verlässt dabei das Gerät).
 *  - erlaubt: PDF, JPEG, PNG (Prüfung per Dateisignatur, nicht per Endung)
 *  - iPhone-Fotos (HEIC/HEIF) und andere Bildformate werden automatisch in JPEG umgewandelt,
 *    sofern der Browser sie lesen kann (Safari auf iPhone/iPad/Mac kann das).
 *  - zu große Fotos werden automatisch verkleinert statt abgewiesen (Ziel: höchstens 10 MB).
 *  - beim Umwandeln/Verkleinern gehen Foto-Metadaten (z. B. GPS-Standort) verloren – gewollt.
 * Ergebnis: { blob, name, typ, umgewandelt, hinweis } oder Fehler mit .code und deutscher .meldung. */
(function (global) {
  'use strict';
  var MAX = 10 * 1024 * 1024;
  var ZIEL = 9.5 * 1024 * 1024;
  var MAX_KANTE = 4096;

  function fehler(code, meldung) { var e = new Error(meldung); e.code = code; e.meldung = meldung; return e; }

  function kopf(file, n) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(new Uint8Array(r.result)); };
      r.onerror = function () { rej(fehler('lesefehler', 'Die Datei konnte nicht gelesen werden.')); };
      r.readAsArrayBuffer(file.slice(0, n));
    });
  }
  /** Erkennt den echten Typ anhand der ersten Bytes. */
  function erkenne(u) {
    if (u[0] === 0x25 && u[1] === 0x50 && u[2] === 0x44 && u[3] === 0x46 && u[4] === 0x2d) return 'pdf';
    if (u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff) return 'jpeg';
    if (u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47) return 'png';
    if (u[4] === 0x66 && u[5] === 0x74 && u[6] === 0x79 && u[7] === 0x70) {
      var marke = String.fromCharCode(u[8], u[9], u[10], u[11]);
      if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)$/.test(marke)) return 'heic';
    }
    if (u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46 && u[8] === 0x57 && u[9] === 0x45 && u[10] === 0x42 && u[11] === 0x50) return 'bild'; // WebP
    if (u[0] === 0x47 && u[1] === 0x49 && u[2] === 0x46) return 'bild'; // GIF
    return null;
  }
  function ladeBild(file) {
    if (global.createImageBitmap) {
      return createImageBitmap(file).catch(function () { return ladeImg(file); });
    }
    return ladeImg(file);
  }
  function ladeImg(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(fehler('bild_unlesbar', 'Dieses Foto kann Ihr Browser nicht öffnen.')); };
      img.src = url;
    });
  }
  function zuJpeg(bild, kante, qualitaet) {
    var w = bild.width, h = bild.height, f = Math.min(1, kante / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * f)); c.height = Math.max(1, Math.round(h * f));
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); // Transparenz -> weiß
    ctx.drawImage(bild, 0, 0, c.width, c.height);
    return new Promise(function (res, rej) {
      c.toBlob(function (b) { b ? res(b) : rej(fehler('umwandlung', 'Das Foto konnte nicht umgewandelt werden.')); }, 'image/jpeg', qualitaet);
    });
  }
  function neuerName(name) { return String(name || 'foto').replace(/\.[^.]{1,5}$/, '') + '.jpg'; }

  /** Verkleinert, bis die Datei unter das Ziel passt (Kante und Qualität schrittweise runter). */
  async function verkleinere(bild) {
    var kante = Math.min(MAX_KANTE, Math.max(bild.width, bild.height)), q = 0.85, blob;
    for (var i = 0; i < 8; i++) {
      blob = await zuJpeg(bild, kante, q);
      if (blob.size <= ZIEL) return blob;
      if (q > 0.65) q -= 0.1; else kante = Math.round(kante * 0.8);
    }
    if (blob.size <= MAX) return blob;
    throw fehler('zu_gross', 'Das Foto ist auch verkleinert noch zu groß. Bitte fotografieren Sie den Beleg in mehreren Teilen.');
  }

  async function bereite(file) {
    if (!file || !file.size) throw fehler('leer', 'Die Datei ist leer.');
    var typ = erkenne(await kopf(file, 16));
    if (!typ && /image\/hei[cf]/i.test(file.type || '')) typ = 'heic';
    if (typ === 'pdf') {
      if (file.size > MAX) throw fehler('pdf_zu_gross', 'Diese PDF ist größer als 10 MB. Bitte teilen Sie sie auf (z. B. ein Kontoauszug je Monat) oder laden Sie die Seiten als Fotos hoch.');
      return { blob: file, name: file.name || 'beleg.pdf', typ: 'application/pdf', umgewandelt: false, hinweis: '' };
    }
    if (typ === 'jpeg' || typ === 'png') {
      if (file.size <= MAX) return { blob: file, name: file.name || ('beleg.' + (typ === 'png' ? 'png' : 'jpg')), typ: 'image/' + typ, umgewandelt: false, hinweis: '' };
      var gross = await ladeBild(file);
      return { blob: await verkleinere(gross), name: neuerName(file.name), typ: 'image/jpeg', umgewandelt: true, hinweis: 'Wir haben das Foto verkleinert, damit es schneller hochlädt. Es bleibt gut lesbar.' };
    }
    if (typ === 'heic' || typ === 'bild') {
      var bild;
      try { bild = await ladeBild(file); } catch (e) {
        throw fehler('heic_unlesbar', typ === 'heic'
          ? 'Dieses iPhone-Foto (HEIC) kann dieser Browser nicht umwandeln. Öffnen Sie die Seite bitte in Safari, oder machen Sie einen Screenshot des Fotos und laden Sie diesen hoch.'
          : 'Dieses Bildformat kann Ihr Browser nicht umwandeln. Bitte laden Sie ein Foto als JPEG oder PNG hoch.');
      }
      return { blob: await verkleinere(bild), name: neuerName(file.name), typ: 'image/jpeg', umgewandelt: true, hinweis: typ === 'heic' ? 'Wir haben das iPhone-Foto automatisch in JPEG umgewandelt.' : 'Wir haben das Bild automatisch in JPEG umgewandelt.' };
    }
    throw fehler('typ', 'Dieser Dateityp geht nicht. Erlaubt sind PDF und Fotos (JPEG, PNG, iPhone-Fotos).');
  }

  global.GMRBelegBild = { bereite: bereite, erkenne: erkenne, MAX: MAX };
})(window);
