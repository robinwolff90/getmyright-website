/* GetMyRight – optionale Selbstschwärzung durch den Spieler (läuft ausschließlich im Browser)
 *
 * Es gibt KEINE automatische Systemschwärzung: Diese Datei verändert keinen Text von sich aus.
 * Sie stellt nur ein Hilfswerkzeug bereit, mit dem Spielerinnen und Spieler – wenn sie es selbst
 * wünschen – einzelne private Buchungszeilen OHNE Glücksspielbezug (z. B. Alltagseinkäufe,
 * Bestellungen) in einer KOPIE ihrer CSV-/TXT-Datei schwärzen können. Die Originaldatei bleibt unverändert.
 *
 * Casino-relevante Buchungen (Ein- und Auszahlungen zum/vom Casino bzw. Sportwettenanbieter mit
 * Datum, Betrag und Zahlungsdienstleister/Empfänger) MÜSSEN im Klartext lesbar bleiben, damit eine
 * Partnerkanzlei sie prüfen kann. Zeilen mit erkennbarem Glücksspielbezug werden deshalb markiert und
 * können mit diesem Werkzeug nicht geschwärzt werden.
 */
(function (root) {
  'use strict';
  var WORDS = /(^|[^a-zäöüß])(bet|bets|betting|stake)([^a-zäöüß]|$)|bet365|betway|bet-at-home|888 ?casino|888 ?poker/;
  var GAMBLING = ['casino', 'kasino', 'wett', 'poker', 'slot', 'spielbank', 'lotto', 'lottery', 'jackpot', 'gaming', 'gambl', 'roulette', 'blackjack', 'bingo',
    'tipico', 'bwin', 'interwetten', 'betano', 'tipwin', 'neo.bet', 'sportingbet', 'william hill', 'unibet', 'betsson', 'netbet', 'bethard', 'comeon', 'leovegas',
    'mr green', 'casumo', 'wildz', 'wunderino', 'drückglück', 'druckgluck', 'platincasino', 'sunmaker', 'lapalingo', 'vulkan', 'wheelz', 'videoslots', 'rizk',
    'mr bet', '22bet', 'pokerstars', 'partypoker', 'ggpoker', 'lottoland', 'royal panda', 'mr play', 'energy casino', 'karamba', 'hyperino', 'vera&john',
    'dunder', 'playamo', 'bitstarz', 'wazamba', 'vavada', 'skrill', 'neteller', 'paysafe', 'trustly', 'muchbetter', 'ecopayz', 'astropay'];
  var MARK = '[vom Spieler geschwärzt – private Buchung ohne Glücksspielbezug]';
  function isGambling(line) {
    var l = String(line || '').toLowerCase();
    if (WORDS.test(l)) return true;
    for (var i = 0; i < GAMBLING.length; i++) if (l.indexOf(GAMBLING[i]) >= 0) return true;
    return false;
  }
  function isHeader(line, i) { return i === 0 && /datum|date|betrag|amount|buchung|verwendungszweck/i.test(line || ''); }
  /* Zeilen für die Auswahl aufbereiten – verändert nichts. */
  function rows(text) {
    return String(text || '').split(/\r?\n/).map(function (line, i) {
      return { index: i, text: line, gambling: isGambling(line), header: isHeader(line, i), empty: !line.trim() };
    });
  }
  /* Nur die ausdrücklich vom Spieler gewählten Zeilen schwärzen; Zeilen mit Glücksspielbezug bleiben immer erhalten. */
  function apply(text, indices) {
    var pick = {}, n = 0, kept = 0;
    (indices || []).forEach(function (i) { pick[i] = true; });
    var out = String(text || '').split(/\r?\n/).map(function (line, i) {
      if (!pick[i]) return line;
      if (isGambling(line) || isHeader(line, i)) { kept++; return line; }
      n++; return MARK;
    });
    return { text: out.join('\n'), redacted: n, protectedKept: kept };
  }
  root.GMRSelfRedact = { rows: rows, apply: apply, isGambling: isGambling, MARK: MARK, automatic: false };
})(typeof window !== 'undefined' ? window : globalThis);
