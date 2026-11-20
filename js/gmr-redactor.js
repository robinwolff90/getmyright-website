/* GetMyRight – Teilmaskierung sensibler Finanzkennungen (läuft ausschließlich im Browser)
 * Regeln:
 *  - Kartennummern (13–19 Ziffern, Luhn-geprüft): nur die letzten 4 Ziffern bleiben sichtbar.
 *  - IBAN: Ländercode + letzte 4 Zeichen bleiben sichtbar.
 *  - Transaktions- und Buchungskennungen (Buchungsnummer, Referenz, SEPA End-to-End-ID/EREF,
 *    Mandatsreferenz/MREF, ARN, Auth-/Autorisierungscode, Transaktions-ID, Beleg-Nr.):
 *    nur die letzten 4 Zeichen bleiben sichtbar (bei sehr kurzen Werten die letzten 2), z. B. ••••78A2.
 *  - Namen nach Kontoinhaber/Karteninhaber/Name/Auftraggeber/Empfänger werden auf Initialen gekürzt (z. B. M. M.).
 *  - Postanschriften (Straße + Hausnummer, PLZ + Ort) werden entfernt.
 *  - Unbeschriftete ARN (23 Ziffern) und lange alphanumerische Transaktions-IDs: ebenso letzte 4 Zeichen.
 * So bleibt eine Buchung für die beauftragte Kanzlei zuordenbar, ist für Dritte aber nicht eindeutig identifizierbar.
 */
(function (root) {
  'use strict';
  var DOT = '\u2022';
  function dots(n) { return new Array(Math.max(n, 0) + 1).join(DOT); }
  function tail(v) {
    var clean = v.replace(/[\s\-\/\.]/g, '');
    var keep = clean.length <= 6 ? 2 : 4;
    return dots(4) + clean.slice(-keep);
  }
  function luhn(d) {
    var s = 0, alt = false;
    for (var i = d.length - 1; i >= 0; i--) { var n = +d[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt; }
    return s % 10 === 0;
  }
  function mod97(iban) {
    var r = iban.slice(4) + iban.slice(0, 4), num = '', rem = 0;
    for (var i = 0; i < r.length; i++) { var ch = r.charCodeAt(i); num += ch >= 65 ? String(ch - 55) : r[i]; }
    for (var j = 0; j < num.length; j++) rem = (rem * 10 + (+num[j])) % 97;
    return rem === 1;
  }
  var LABEL = '(Buchungs(?:-?nummer|-?nr\\.?|referenz)|Buchungs-Nr\\.?|Referenz(?:nummer|-?Nr\\.?)?|Ref\\.?(?:-?Nr\\.?)?|End-?to-?End(?:-?ID|-?Referenz)?|E2E(?:-?ID)?|EREF|MREF|KREF|Mandatsreferenz|Kundenreferenz|ARN|Acquirer Reference(?: Number)?|Auth(?:orisierungs|orization)?-?Code|Autorisierungs-?(?:code|nummer)|Genehmigungs-?(?:code|nummer)|Transaktions-?(?:ID|nummer|nr\\.?)|Transaction(?:\\s|-)?(?:ID|Number|Ref)|TxID|TAN-?Ref|Beleg-?(?:nummer|nr\\.?)|Auftrags-?(?:nummer|nr\\.?))';
  var RE_LABELED = new RegExp(LABEL + '(\\s*[:#=+]?\\s*)([A-Za-z0-9][A-Za-z0-9\\-\\/\\.]{2,63})', 'gi');
  var RE_IBAN = /\b([A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30})\b/g;
  var RE_PAN = /\b(?:\d[ \-]?){12,18}\d\b/g;
  var RE_ARN = /\b\d{23}\b/g;
  var RE_GENERIC = /\b(?=[A-Z0-9\-]*\d[A-Z0-9\-]*\d[A-Z0-9\-]*\d)(?=[A-Z0-9\-]*[A-Z])[A-Z0-9][A-Z0-9\-]{11,39}\b/g;

  var RE_NAME = /(Kontoinhaber(?:in)?|Karteninhaber(?:in)?|Inhaber(?:in)?|Name|Auftraggeber(?:in)?|Empf\u00e4nger(?:in)?|Zahlungspflichtige[rn]?)(\s*[:=]\s*)([A-Z\u00c4\u00d6\u00dc][a-z\u00e4\u00f6\u00fc\u00df\-]+)\s+([A-Z\u00c4\u00d6\u00dc][a-z\u00e4\u00f6\u00fc\u00df\-]+)/g;
  var RE_STREET = /\b[A-Z\u00c4\u00d6\u00dc][A-Za-z\u00c4\u00d6\u00dc\u00e4\u00f6\u00fc\u00df\-]*(?:stra\u00dfe|strasse|str\.|weg|allee|platz|gasse|ring|damm)\s+\d{1,4}\s?[a-zA-Z]?\b/g;
  var RE_PLZ = /\b\d{5}\s+[A-Z\u00c4\u00d6\u00dc][a-z\u00e4\u00f6\u00fc\u00df]+(?:[\s\-][A-Z\u00c4\u00d6\u00dc]?[a-z\u00e4\u00f6\u00fc\u00df]+)?\b/g;
  function redact(text) {
    var c = { iban: 0, karte: 0, transaktion: 0, name: 0, adresse: 0 };
    var out = String(text);
    out = out.replace(RE_IBAN, function (m) {
      // Längsten Präfix mit gültiger IBAN-Prüfsumme (ISO 13616, mod 97) suchen
      for (var end = m.length; end >= 15; end--) {
        var cand = m.slice(0, end);
        if (/ $/.test(cand)) continue;
        var all = cand.replace(/ /g, '');
        if (all.length < 15 || all.length > 34 || !mod97(all)) continue;
        c.iban++; return all.slice(0, 2) + dots(all.length - 6) + all.slice(-4) + m.slice(end);
      }
      return m;
    });
    out = out.replace(RE_PAN, function (m) {
      var d = m.replace(/\D/g, '');
      if (d.length < 13 || d.length > 19 || !luhn(d)) return m;
      c.karte++; return dots(4) + ' ' + dots(4) + ' ' + dots(4) + ' ' + d.slice(-4);
    });
    out = out.replace(RE_LABELED, function (m, label, sep, val) {
      if (val.indexOf(DOT) >= 0 || !/\d/.test(val)) return m;
      c.transaktion++; return label + sep + tail(val);
    });
    out = out.replace(RE_ARN, function (m) { c.transaktion++; return tail(m); });
    out = out.replace(RE_GENERIC, function (m, off, str) {
      if (str.charAt(off - 1) === DOT) return m;
      c.transaktion++; return tail(m);
    });
    out = out.replace(RE_NAME, function (m, label, sep, first, last) {
      c.name++; return label + sep + first.charAt(0) + '. ' + last.charAt(0) + '.';
    });
    out = out.replace(RE_STREET, function () { c.adresse++; return '[Adresse entfernt]'; });
    out = out.replace(RE_PLZ, function () { c.adresse++; return '[Adresse entfernt]'; });
    return { text: out, counts: c, total: c.iban + c.karte + c.transaktion + c.name + c.adresse };
  }
  var api = { redact: redact, mask: tail, luhn: luhn };
  root.GMRRedactor = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
