/* GetMyRight – Kanzlei: Login (E-Mail-Code + Pflicht-TOTP, "Gerät 30 Tage merken"), offene Fälle übernehmen,
 * Belege des eigenen Falls ansehen/herunterladen über kurzlebige Links, die im Hintergrund erneuert werden. */
(function () {
  'use strict';
  var d = document, A = window.GMRBelege;
  if (!A || !d.querySelector('[data-kf-login]')) return;
  var SITZUNG = 'gmr-kanzlei', GERAET = 'gmr-kanzlei-geraet';
  var LINK_ERNEUERN_MS = 4 * 60 * 1000; // Links gelten 5 Minuten
  var sitzung = null, zwischen = null, erneuerer = [];
  function $(s, w) { return (w || d).querySelector(s); }
  function $$(s, w) { return Array.prototype.slice.call((w || d).querySelectorAll(s)); }
  var fehlerBox = $('[data-kf-fehler]');
  function fehler(t) { fehlerBox.textContent = t || ''; fehlerBox.hidden = !t; }
  function schritt(n) { $$('[data-kf-schritt]').forEach(function (el) { el.hidden = el.getAttribute('data-kf-schritt') !== n; }); }
  function geraet() { try { var g = JSON.parse(localStorage.getItem(GERAET) || 'null'); return g && g.bis > Date.now() ? g.token : undefined; } catch (e) { return undefined; } }
  function esc(s) { return A.esc(s); }

  if (!A.aktiv) { $('[data-kf-inaktiv]').hidden = false; $$('button', $('[data-kf-login]')).forEach(function (b) { b.disabled = true; }); return; }
  A.turnstileStart($('[data-turnstile]'));

  $('[data-kf-senden]').addEventListener('click', function () {
    var btn = this; btn.disabled = true; fehler('');
    A.turnstileToken().then(function (tok) { return A.anfrage('POST', '/api/kanzlei/login/anfordern', { json: { email: $('#kf-email').value.trim(), turnstile: tok } }); })
      .then(function (r) { schritt('code'); $('#kf-code').focus(); if (r.devCode) console.info('[lokal] Code:', r.devCode); })
      .catch(function (e) { A.turnstileReset(); fehler(A.meldung(e.code)); }).then(function () { btn.disabled = false; });
  });
  function nachCode(r) {
    if (r.schritt === 'fertig') return angemeldet(r);
    zwischen = r.zwischen; schritt('totp');
    var ein = r.schritt === 'totp_einrichten';
    $('[data-kf-einrichten]').hidden = !ein;
    if (ein) {
      $('[data-kf-secret]').textContent = r.secret.replace(/(.{4})/g, '$1 ').trim();
      var box = $('[data-kf-qr]'); box.innerHTML = '';
      if (window.qrcode) { var q = window.qrcode(0, 'M'); q.addData(r.otpauth); q.make(); var img = new Image(); img.src = q.createDataURL(6, 2); img.alt = 'QR-Code für die Authenticator-App'; box.appendChild(img); }
      var a = d.createElement('a'); a.href = r.otpauth; a.textContent = 'Auf diesem Gerät in der Authenticator-App öffnen'; a.className = 'small'; box.appendChild(d.createElement('br')); box.appendChild(a);
    }
    $('#kf-totp').focus();
  }
  function codePruefen(daten) {
    daten.geraet = geraet();
    return A.anfrage('POST', '/api/kanzlei/login/code', { json: daten }).then(nachCode);
  }
  $('[data-kf-code]').addEventListener('click', function () {
    fehler(''); codePruefen({ email: $('#kf-email').value.trim(), code: $('#kf-code').value.trim() }).catch(function (e) { fehler(A.meldung(e.code)); });
  });
  $('[data-kf-totp]').addEventListener('click', function () {
    fehler('');
    A.anfrage('POST', '/api/kanzlei/login/totp', { json: { zwischen: zwischen, code: $('#kf-totp').value.trim(), merken: $('#kf-merken').checked } })
      .then(angemeldet).catch(function (e) { fehler(A.meldung(e.code)); });
  });
  function angemeldet(r) {
    sitzung = r.sitzung;
    try { sessionStorage.setItem(SITZUNG, JSON.stringify({ t: r.sitzung, bis: r.gueltigBis })); } catch (e) { /* egal */ }
    if (r.geraet) try { localStorage.setItem(GERAET, JSON.stringify({ token: r.geraet, bis: r.geraetBis })); } catch (e) { /* egal */ }
    $('[data-kf-login]').hidden = true; $('[data-kf-app]').hidden = false;
    return liste();
  }
  function abgemeldet() {
    sitzung = null; stoppeErneuerung();
    try { sessionStorage.removeItem(SITZUNG); } catch (e) { /* egal */ }
    $('[data-kf-app]').hidden = true; $('[data-kf-login]').hidden = false; schritt('email');
  }
  function api(m, p, j) {
    return A.anfrage(m, p, { sitzung: sitzung, json: j }).catch(function (e) { if (e.status === 401) { abgemeldet(); } throw e; });
  }
  function belegStand(cl) {
    return (cl || []).filter(function (c) { return c.item !== 'sonstiges'; }).map(function (c) {
      var cls = c.status === 'hochgeladen' ? 'ok' : c.status === 'angefordert' ? 'warn' : 'err';
      return '<span class="badge ' + cls + '" title="' + esc(c.label + ': ' + c.status) + '">' + esc(c.label) + '</span>';
    }).join(' ');
  }
  function zeitraum(a) { return a.von === a.bis ? String(a.von) : a.von + '–' + a.bis; }
  function liste() {
    stoppeErneuerung();
    $('[data-kf-detail]').hidden = true; $('[data-kf-liste]').hidden = false;
    return api('GET', '/api/kanzlei/faelle').then(function (r) {
      $('[data-kf-name]').textContent = r.kanzlei || 'Kanzlei';
      $('[data-kf-meine]').innerHTML = r.meine.length ? r.meine.map(function (f) {
        return '<tr><td><strong>' + esc(f.id.slice(0, 8)) + '</strong></td><td>' + esc(f.antworten.anbieter) + '</td><td>' + zeitraum(f.antworten) + '</td><td>' + esc(A.VERLUST[f.antworten.verlust]) + '</td><td>' + belegStand(f.checkliste) + '</td><td><button type="button" class="btn btn--klein" data-kf-oeffnen="' + esc(f.id) + '">Öffnen</button></td></tr>';
      }).join('') : '<tr><td colspan="6" class="small">Sie haben noch keinen Fall übernommen.</td></tr>';
      $('[data-kf-offen]').innerHTML = r.offen.length ? r.offen.map(function (f) {
        var a = f.antworten;
        return '<tr><td><strong>' + esc(f.id.slice(0, 8)) + '</strong></td><td>' + esc(a.anbieter) + '</td><td>' + esc(A.SPIELART[a.spielart]) + '</td><td>' + zeitraum(a) + '</td><td>' + esc(A.VERLUST[a.verlust]) + '</td><td>' + esc(A.LAND[a.bundesland]) + '</td><td>' + belegStand(f.checkliste) + '</td><td><button type="button" class="btn btn--klein" data-kf-uebernehmen="' + esc(f.id) + '">Übernehmen</button></td></tr>';
      }).join('') : '<tr><td colspan="8" class="small">Gerade gibt es keine offenen Fälle.</td></tr>';
    }).catch(function (e) { fehler(A.meldung(e.code)); });
  }
  function stoppeErneuerung() { erneuerer.forEach(clearInterval); erneuerer = []; }
  function neuerLink(id, download) { return api('POST', '/api/kanzlei/dateien/' + id + '/link', { download: !!download }); }
  function oeffne(id) {
    fehler('');
    return api('GET', '/api/kanzlei/faelle/' + id).then(function (f) {
      var a = f.antworten, box = $('[data-kf-detail]');
      $('[data-kf-liste]').hidden = true; box.hidden = false;
      var html = '<button type="button" class="btn btn--klein btn--sek" data-kf-zurueck>← Zur Übersicht</button>' +
        '<h2>Fall ' + esc(f.id.slice(0, 8)) + '</h2><p>' + esc(a.anbieter) + ' · ' + esc(A.SPIELART[a.spielart]) + ' · ' + zeitraum(a) + ' · ' + esc(A.VERLUST[a.verlust]) + ' · ' + esc(A.LAND[a.bundesland]) + '</p>' +
        '<p>' + belegStand(f.checkliste) + '</p><h3>Belege</h3>';
      if (!f.belege.length) html += '<p class="small">Noch keine Belege hochgeladen.</p>';
      html += '<div class="beleg-liste">' + f.belege.map(function (b) {
        var bild = b.mime.indexOf('image/') === 0;
        return '<div class="beleg-karte"><div class="beleg-kopf"><h3>' + esc(b.downloadName) + '</h3><span class="small">' + esc(A.groesse(b.size)) + (b.umgewandelt ? ' · im Browser umgewandelt' : '') + '</span></div>' +
          '<p class="small">Original-Dateiname: ' + esc(b.name) + '</p>' +
          (bild ? '<img class="beleg-vorschau" alt="Vorschau ' + esc(b.downloadName) + '" data-kf-vorschau="' + esc(b.id) + '">' : '<p class="small">PDF: Vorschau im Browser folgt in einer späteren Phase. Bitte herunterladen und mit einem aktuellen PDF-Programm öffnen.</p>') +
          '<div class="knoepfe"><button type="button" class="btn btn--klein btn--sek" data-kf-download="' + esc(b.id) + '">Herunterladen</button></div></div>';
      }).join('') + '</div>';
      box.innerHTML = html;
      // Bild-Vorschau über kurzlebige Links, im Hintergrund alle 4 Minuten erneuert
      $$('[data-kf-vorschau]', box).forEach(function (img) {
        var id = img.getAttribute('data-kf-vorschau');
        var hole = function () { return neuerLink(id, false).then(function (r) { img.dataset.gueltigBis = r.gueltigBis; if (!img.src || !img.complete) img.src = r.url; img.dataset.url = r.url; }); };
        hole().catch(function (e) { fehler(A.meldung(e.code)); });
        erneuerer.push(setInterval(function () { hole().catch(function () { /* nächster Versuch */ }); }, LINK_ERNEUERN_MS));
        img.addEventListener('error', function () { if (img.dataset.url && img.src !== img.dataset.url) img.src = img.dataset.url; });
      });
    }).catch(function (e) { fehler(A.meldung(e.code)); });
  }
  d.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('button') : null;
    if (!t) return;
    if (t.hasAttribute('data-kf-uebernehmen')) {
      var id = t.getAttribute('data-kf-uebernehmen');
      if (!window.confirm('Fall ' + id.slice(0, 8) + ' exklusiv für Ihre Kanzlei übernehmen? Danach sehen Sie die Belege, andere Kanzleien sehen den Fall nicht mehr.')) return;
      api('POST', '/api/kanzlei/faelle/' + id + '/uebernehmen').then(function () { return oeffne(id); }).catch(function (e) { fehler(A.meldung(e.code)); liste(); });
    } else if (t.hasAttribute('data-kf-oeffnen')) oeffne(t.getAttribute('data-kf-oeffnen'));
    else if (t.hasAttribute('data-kf-zurueck')) liste();
    else if (t.hasAttribute('data-kf-download')) {
      neuerLink(t.getAttribute('data-kf-download'), true).then(function (r) { var a = d.createElement('a'); a.href = r.url; a.rel = 'noopener'; d.body.appendChild(a); a.click(); a.remove(); }).catch(function (e) { fehler(A.meldung(e.code)); });
    } else if (t.hasAttribute('data-kf-abmelden')) {
      api('POST', '/api/abmelden').catch(function () { /* egal */ }).then(abgemeldet);
    }
  });

  /* Start: Magic-Link oder laufende Sitzung */
  var h = new URLSearchParams(location.hash.slice(1));
  if (h.get('link') && h.get('e')) {
    history.replaceState(null, '', location.pathname);
    $('#kf-email').value = h.get('e');
    codePruefen({ email: h.get('e'), link: h.get('link') }).catch(function (e) { fehler(A.meldung(e.code)); schritt('email'); });
  } else {
    try { var s = JSON.parse(sessionStorage.getItem(SITZUNG) || 'null'); if (s && s.bis > Date.now()) angemeldet({ sitzung: s.t, gueltigBis: s.bis }); } catch (e) { /* neu anmelden */ }
  }
})();
