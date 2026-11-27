/* GetMyRight – gemeinsame Helfer für Beleg-Upload (Spieler) und Kanzlei-Ansicht.
 * Endpunkt: GMR_CONFIG.evidenceEndpoint (leer = Funktion noch nicht freigeschaltet).
 * Lokal (localhost/127.0.0.1) wird automatisch der lokale Test-Worker genutzt. */
(function (global) {
  'use strict';
  var CFG = global.GMR_CONFIG || {};
  var lokal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var BASIS = (CFG.evidenceEndpoint || (lokal ? (CFG.evidenceEndpointLokal || 'http://127.0.0.1:8787') : '')).replace(/\/$/, '');

  var MELDUNG = {
    einwilligung_fehlt: 'Bitte bestätigen Sie die Einwilligung.',
    anbieter_fehlt: 'Bitte nennen Sie den Anbieter.',
    spielart_ungueltig: 'Bitte wählen Sie, was Sie gespielt haben.',
    zeitraum_ungueltig: 'Bitte prüfen Sie den Zeitraum.',
    verlust_ungueltig: 'Bitte wählen Sie eine ungefähre Verlusthöhe.',
    bundesland_ungueltig: 'Bitte wählen Sie, wo Sie wohnen.',
    turnstile_fehlt: 'Die Sicherheitsprüfung ist noch nicht fertig. Bitte versuchen Sie es in ein paar Sekunden erneut.',
    turnstile_ungueltig: 'Die Sicherheitsprüfung hat nicht geklappt. Bitte laden Sie die Seite neu.',
    email_ungueltig: 'Bitte prüfen Sie die E-Mail-Adresse.',
    code_falsch: 'Der Code stimmt nicht. Bitte prüfen Sie ihn.',
    code_abgelaufen: 'Der Code ist abgelaufen. Bitte fordern Sie einen neuen an.',
    zu_viele_versuche: 'Zu viele Versuche. Bitte fordern Sie einen neuen Code an.',
    zu_viele_anfragen: 'Gerade kommen zu viele Anfragen. Bitte warten Sie eine Minute.',
    datei_zu_gross: 'Die Datei ist größer als 10 MB.',
    dateityp_nicht_erlaubt: 'Dieser Dateityp geht nicht. Erlaubt sind PDF, JPEG und PNG.',
    zu_viele_dateien: 'Es sind schon sehr viele Dateien in diesem Fall. Bitte melden Sie sich bei uns.',
    fall_uebernommen: 'Ihr Fall wurde schon von einer Kanzlei übernommen. Änderungen bitte direkt mit der Kanzlei klären.',
    nicht_angemeldet: 'Ihre Anmeldung ist abgelaufen. Bitte melden Sie sich neu an.',
    kein_zugriff: 'Dafür fehlt die Berechtigung.',
    bereits_uebernommen: 'Diesen Fall hat inzwischen eine andere Kanzlei übernommen.',
    link_abgelaufen: 'Der Link ist abgelaufen.',
    mail_fehlgeschlagen: 'Die E-Mail konnte gerade nicht verschickt werden. Bitte versuchen Sie es später erneut.',
    netz: 'Keine Verbindung. Bitte prüfen Sie Ihr Netz und versuchen Sie es erneut.',
  };
  function meldung(code) { return MELDUNG[code] || 'Da ist etwas schiefgelaufen. Bitte versuchen Sie es erneut.'; }

  function anfrage(methode, pfad, opt) {
    opt = opt || {};
    var h = { 'Accept': 'application/json' };
    if (opt.sitzung) h.Authorization = 'Bearer ' + opt.sitzung;
    var body;
    if (opt.json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(opt.json); }
    return fetch(BASIS + pfad, { method: methode, headers: h, body: body, credentials: 'omit', mode: 'cors' })
      .catch(function () { var e = new Error('netz'); e.code = 'netz'; throw e; })
      .then(function (r) {
        return r.json().catch(function () { return { fehler: 'http_' + r.status }; }).then(function (j) {
          if (!r.ok) { var e = new Error(j.fehler || 'fehler'); e.code = j.fehler; e.status = r.status; throw e; }
          return j;
        });
      });
  }
  /** Upload mit Fortschrittsanzeige (XHR, weil fetch keinen Upload-Fortschritt meldet). Ein Neuversuch bei Funkloch. */
  function hochladen(pfad, sitzung, blob, kopfzeilen, fortschritt, versuch) {
    versuch = versuch || 0;
    return new Promise(function (res, rej) {
      var x = new XMLHttpRequest();
      x.open('PUT', BASIS + pfad);
      x.setRequestHeader('Authorization', 'Bearer ' + sitzung);
      Object.keys(kopfzeilen).forEach(function (k) { x.setRequestHeader(k, kopfzeilen[k]); });
      x.upload.onprogress = function (ev) { if (ev.lengthComputable && fortschritt) fortschritt(ev.loaded / ev.total); };
      x.onload = function () {
        var j = {}; try { j = JSON.parse(x.responseText); } catch (e) { /* leer */ }
        if (x.status >= 200 && x.status < 300) res(j); else { var e = new Error(j.fehler || 'fehler'); e.code = j.fehler; e.status = x.status; rej(e); }
      };
      x.onerror = function () {
        if (versuch < 2) setTimeout(function () { hochladen(pfad, sitzung, blob, kopfzeilen, fortschritt, versuch + 1).then(res, rej); }, 2000 * (versuch + 1));
        else { var e = new Error('netz'); e.code = 'netz'; rej(e); }
      };
      x.send(blob);
    });
  }

  /* Turnstile im unsichtbaren Modus ("interaction-only": nur bei Verdacht sichtbar). */
  var tsId = null;
  function turnstileStart(box) {
    if (lokal || !CFG.turnstileSiteKey || !box || tsId !== null) return;
    var render = function () { if (global.turnstile && tsId === null) tsId = global.turnstile.render(box, { sitekey: CFG.turnstileSiteKey, language: 'de', appearance: 'interaction-only' }); };
    if (global.turnstile) return render();
    var sc = document.createElement('script');
    sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    sc.async = true; sc.onload = render;
    document.head.appendChild(sc);
  }
  function turnstileToken() {
    if (lokal) return Promise.resolve('lokal');
    return new Promise(function (res) {
      var n = 0;
      (function warte() {
        var t = (global.turnstile && tsId !== null) ? global.turnstile.getResponse(tsId) : '';
        if (t || n++ > 40) return res(t || '');
        setTimeout(warte, 300);
      })();
    });
  }
  function turnstileReset() { if (global.turnstile && tsId !== null) try { global.turnstile.reset(tsId); } catch (e) { /* ignorieren */ } }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function groesse(b) { return b > 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }

  global.GMRBelege = {
    aktiv: !!BASIS, basis: BASIS, lokal: lokal, anfrage: anfrage, hochladen: hochladen, meldung: meldung,
    turnstileStart: turnstileStart, turnstileToken: turnstileToken, turnstileReset: turnstileReset, esc: esc, groesse: groesse,
    EINWILLIGUNG_VERSION: '2026-11-27',
    SPIELART: { 'online-casino': 'Online-Casino', slots: 'Automatenspiele', sportwetten: 'Sportwetten', poker: 'Poker', sonstiges: 'Sonstiges' },
    VERLUST: { 'unter-1000': 'unter 1.000 €', '1000-5000': '1.000 – 5.000 €', '5000-10000': '5.000 – 10.000 €', '10000-25000': '10.000 – 25.000 €', '25000-50000': '25.000 – 50.000 €', '50000-100000': '50.000 – 100.000 €', 'ueber-100000': 'über 100.000 €', unbekannt: 'unbekannt' },
    LAND: { BW: 'Baden-Württemberg', BY: 'Bayern', BE: 'Berlin', BB: 'Brandenburg', HB: 'Bremen', HH: 'Hamburg', HE: 'Hessen', MV: 'Mecklenburg-Vorpommern', NI: 'Niedersachsen', NW: 'Nordrhein-Westfalen', RP: 'Rheinland-Pfalz', SL: 'Saarland', SN: 'Sachsen', ST: 'Sachsen-Anhalt', SH: 'Schleswig-Holstein', TH: 'Thüringen', ausland: 'Ausland' },
  };
})(window);
