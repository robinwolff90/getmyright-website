/* GetMyRight – Spieler: Fall zuerst, Konto später.
 * 1) fünf Fragen  2) Einwilligung (ein Bildschirm)  3) Belege-Checkliste mit Upload  4) E-Mail-Bestätigung (Code oder Link)
 * Nichts wird übertragen, solange GMR_CONFIG.evidenceEndpoint leer ist. */
(function () {
  'use strict';
  var d = document, A = window.GMRBelege, B = window.GMRBelegBild;
  if (!A || !B || !d.querySelector('[data-schritt]')) return;
  var SPEICHER = 'gmr-fall';
  var zustand = lade();
  var aktuellerFall = null;

  var BELEGE = [
    { item: 'kontoauszug', titel: 'Kontoauszüge', beispiel: 'Auszüge Ihres Girokontos oder Ihrer Kreditkarte, auf denen Zahlungen an den Anbieter zu sehen sind.',
      anleitung: 'Im Online-Banking unter „Postfach“ oder „Kontoauszüge“ als PDF speichern. Ein Auszug pro Monat genügt. Private Buchungen dürfen Sie schwärzen – Zahlungen an oder vom Anbieter müssen lesbar bleiben.' },
    { item: 'spielverlauf', titel: 'Spielverlauf beim Anbieter', beispiel: 'Übersicht Ihrer Einzahlungen, Auszahlungen und Spiele im Kundenkonto des Casinos.',
      anleitung: 'Im Kundenkonto unter „Transaktionen“ oder „Verlauf“ einen Screenshot oder ein PDF machen. Oder beim Kundendienst des Anbieters per E-Mail eine Datenauskunft nach Art. 15 DSGVO anfordern.' },
    { item: 'oasis', titel: 'OASIS-Auskunft', beispiel: 'Auskunft aus dem bundesweiten Spielersperrsystem OASIS, ob und seit wann Sie gesperrt sind.',
      anleitung: 'Die Selbstauskunft ist kostenlos und wird über die offizielle OASIS-Stelle beantragt. Die Antwort kommt meist per Post – ein Foto des Briefs genügt.' },
    { item: 'sonstiges', titel: 'Weitere Belege (optional)', beispiel: 'Zum Beispiel E-Mails des Anbieters oder Screenshots von Kontosperren.', anleitung: '' },
  ];
  var STATUS = { hochgeladen: ['ok', '✓ hochgeladen'], angefordert: ['warn', 'angefordert'], fehlt: ['err', 'fehlt'] };

  function lade() { try { return JSON.parse(localStorage.getItem(SPEICHER) || '{}'); } catch (e) { return {}; } }
  function speichere() { try { localStorage.setItem(SPEICHER, JSON.stringify(zustand)); } catch (e) { /* privat-Modus */ } }
  function $(s, w) { return (w || d).querySelector(s); }
  function $$(s, w) { return Array.prototype.slice.call((w || d).querySelectorAll(s)); }
  var fehlerBox = $('[data-fall-fehler]');
  function fehler(text) { fehlerBox.textContent = text; fehlerBox.hidden = !text; if (text) fehlerBox.scrollIntoView({ block: 'nearest' }); }
  function zeige(n) {
    fehler('');
    $$('[data-schritt]').forEach(function (el) { el.hidden = el.getAttribute('data-schritt') !== String(n); });
    $$('[data-schritt-anzeige]').forEach(function (el) {
      var k = Number(el.getAttribute('data-schritt-anzeige'));
      if (k === n) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
      el.classList.toggle('erledigt', k < n);
    });
    $('[data-login-bereich]').hidden = n !== 1;
    if (n === 2) A.turnstileStart($('[data-turnstile]'));
    var h = $('[data-schritt="' + n + '"] h2'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: false }); }
  }
  function beschaeftigt(btn, an, text) { if (!btn) return; if (an) { btn.dataset.text = btn.textContent; btn.textContent = text || 'Einen Moment …'; btn.disabled = true; } else { btn.textContent = btn.dataset.text || btn.textContent; btn.disabled = false; } }

  /* Jahresauswahl */
  var jahr = new Date().getFullYear();
  $$('[data-jahre]').forEach(function (sel) {
    sel.innerHTML = '<option value="">Bitte wählen</option>';
    for (var y = jahr; y >= 2000; y--) sel.insertAdjacentHTML('beforeend', '<option value="' + y + '">' + y + '</option>');
  });

  /* Vorbelegung aus dem Selbstcheck (/spieler/selbstcheck.html), einmalig */
  try {
    var vb = JSON.parse(sessionStorage.getItem('gmr_fall_prefill') || 'null');
    sessionStorage.removeItem('gmr_fall_prefill');
    if (vb) {
      if (vb.anbieter) $('#f-anbieter').value = String(vb.anbieter).slice(0, 80);
      if (vb.von) $('#f-von').value = String(vb.von);
      if (vb.bis) $('#f-bis').value = String(vb.bis);
      if (vb.verlust) $('#f-verlust').value = String(vb.verlust);
    }
  } catch (e) { /* ohne Vorbelegung weiter */ }

  if (!A.aktiv) { $('[data-fall-inaktiv]').hidden = false; $$('button', $('.bogen--form')).forEach(function (b) { b.disabled = true; }); return; }

  function antworten() {
    return { anbieter: $('#f-anbieter').value.trim(), spielart: $('#f-spielart').value, von: Number($('#f-von').value), bis: Number($('#f-bis').value), verlust: $('#f-verlust').value, bundesland: $('#f-land').value };
  }
  $('[data-weiter="1"]').addEventListener('click', function () {
    var a = antworten();
    if (!a.anbieter) return fehler(A.meldung('anbieter_fehlt'));
    if (!a.spielart) return fehler(A.meldung('spielart_ungueltig'));
    if (!a.von || !a.bis || a.von > a.bis) return fehler(A.meldung('zeitraum_ungueltig'));
    if (!a.verlust) return fehler(A.meldung('verlust_ungueltig'));
    if (!a.bundesland) return fehler(A.meldung('bundesland_ungueltig'));
    zeige(2);
  });
  $('[data-zurueck="1"]').addEventListener('click', function () { zeige(1); });
  $('[data-weiter="2"]').addEventListener('click', function () {
    var btn = this;
    if (!$('#f-einwilligung').checked) return fehler(A.meldung('einwilligung_fehlt'));
    beschaeftigt(btn, true, 'Fall wird angelegt …');
    A.turnstileToken().then(function (tok) {
      return A.anfrage('POST', '/api/spieler/fall', { json: { antworten: antworten(), einwilligung: true, einwilligungVersion: A.EINWILLIGUNG_VERSION, turnstile: tok } });
    }).then(function (r) {
      zustand = { fallId: r.fallId, sitzung: r.sitzung }; speichere();
      return ladeFall();
    }).then(function () { zeige(3); })
      .catch(function (e) { A.turnstileReset(); fehler(A.meldung(e.code)); })
      .then(function () { beschaeftigt(btn, false); });
  });

  /* Checkliste */
  function renderCheckliste(ziel, fall, bearbeitbar) {
    var stand = {}; (fall.checkliste || []).forEach(function (c) { stand[c.item] = c; });
    var html = '';
    BELEGE.forEach(function (b) {
      var c = stand[b.item] || { status: b.item === 'sonstiges' ? '' : 'fehlt' };
      var dateien = (fall.belege || []).filter(function (f) { return f.item === b.item; });
      if (!bearbeitbar && b.item === 'sonstiges' && !dateien.length) return;
      var st = STATUS[c.status];
      html += '<div class="beleg-karte" data-item="' + b.item + '"><div class="beleg-kopf"><h3>' + A.esc(b.titel) + '</h3>' + (st ? '<span class="badge ' + st[0] + '">' + st[1] + '</span>' : '') + '</div>';
      html += '<p class="small">' + A.esc(b.beispiel) + '</p>';
      if (b.anleitung && bearbeitbar) html += '<details><summary>So bekommen Sie den Beleg</summary><p class="small">' + A.esc(b.anleitung) + '</p></details>';
      if (dateien.length) {
        html += '<ul class="beleg-dateien">';
        dateien.forEach(function (f) {
          html += '<li><span>' + A.esc(f.name) + ' · ' + A.groesse(f.size) + (f.umgewandelt ? ' · umgewandelt' : '') + '</span>' +
            (bearbeitbar && fall.status !== 'uebernommen' ? '<button type="button" class="btn btn--klein btn--sek" data-loeschen="' + f.id + '">Entfernen</button>' : '') + '</li>';
        });
        html += '</ul>';
      }
      if (bearbeitbar && fall.status !== 'geschlossen') {
        var id = (ziel.hasAttribute('data-checkliste-status') ? 's-' : 'd-') + b.item;
        html += '<div class="beleg-aktionen">' +
          '<label class="btn btn--klein" for="' + id + '-kamera">Foto aufnehmen</label><input class="sr" id="' + id + '-kamera" type="file" accept="image/*" capture="environment" data-datei="' + b.item + '">' +
          '<label class="btn btn--klein btn--sek" for="' + id + '-wahl">Datei oder Foto wählen</label><input class="sr" id="' + id + '-wahl" type="file" accept="application/pdf,image/*,.heic,.heif" multiple data-datei="' + b.item + '">' +
          '</div><div class="beleg-fortschritt" data-fortschritt="' + b.item + '" aria-live="polite"></div>';
        if (b.item !== 'sonstiges' && !dateien.length) html += '<label class="wahl"><input type="checkbox" data-angefordert="' + b.item + '"' + (c.status === 'angefordert' ? ' checked' : '') + '> <span>Habe ich schon angefordert, kommt später</span></label>';
      }
      html += '</div>';
    });
    ziel.innerHTML = html;
  }
  function ladeFall() {
    return A.anfrage('GET', '/api/spieler/faelle', { sitzung: zustand.sitzung }).then(function (r) {
      var f = (r.faelle || []).filter(function (x) { return x.id === zustand.fallId; })[0] || (r.faelle || [])[0];
      if (!f) throw Object.assign(new Error('kein_fall'), { code: 'nicht_angemeldet' });
      aktuellerFall = f; zustand.fallId = f.id; speichere();
      renderCheckliste($('[data-checkliste]'), f, true);
      renderStatus(f);
      return f;
    });
  }
  function renderStatus(f) {
    var t = $('[data-status-text]');
    if (f.status === 'uebernommen') t.textContent = (f.kanzlei || 'Eine Partnerkanzlei') + ' hat Ihren Fall übernommen. Die Kanzlei meldet sich bei Ihnen. Fehlende Belege können Sie hier weiter hochladen.';
    else if (f.status === 'offen') t.textContent = 'Ihr Fall ist eingereicht. Partnerkanzleien sehen jetzt nur Ihre fünf Antworten – ohne Namen, E-Mail oder Belege. Sobald eine Kanzlei übernimmt, sehen Sie es hier.';
    else t.textContent = 'Ihr Fall ist angelegt, aber die E-Mail-Adresse ist noch nicht bestätigt.';
    renderCheckliste($('[data-checkliste-status]'), f, true);
  }

  function beiDatei(input) {
    var item = input.getAttribute('data-datei'), files = Array.prototype.slice.call(input.files || []);
    input.value = '';
    var box = d.querySelector('[data-fortschritt="' + item + '"]'); // im sichtbaren Schritt
    $$('[data-fortschritt="' + item + '"]').forEach(function (el) { if (el.offsetParent) box = el; });
    var kette = Promise.resolve(), meldungen = [];
    files.forEach(function (file) {
      kette = kette.then(function () {
        box.innerHTML = '<span>' + A.esc(file.name) + ' wird vorbereitet …</span>';
        return B.bereite(file).then(function (p) {
          box.innerHTML = '<span>' + A.esc(p.name) + '</span><progress max="100" value="0"></progress>';
          var bar = $('progress', box);
          return A.hochladen('/api/spieler/fall/' + zustand.fallId + '/belege', zustand.sitzung, p.blob,
            { 'X-Beleg-Art': item, 'X-Dateiname': encodeURIComponent(p.name), 'X-Umgewandelt': p.umgewandelt ? '1' : '0' },
            function (v) { bar.value = Math.round(v * 100); }).then(function () { if (p.hinweis) meldungen.push(p.hinweis); });
        }).catch(function (e) { meldungen.push(A.esc(file.name) + ': ' + (e.meldung || A.meldung(e.code))); });
      });
    });
    kette.then(ladeFall).then(function () {
      $$('[data-fortschritt="' + item + '"]').forEach(function (el) { el.innerHTML = meldungen.map(function (m) { return '<p class="small">' + m + '</p>'; }).join(''); });
    }).catch(function (e) { fehler(A.meldung(e.code)); });
  }
  d.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.matches && t.matches('[data-datei]')) beiDatei(t);
    if (t.matches && t.matches('[data-angefordert]')) {
      A.anfrage('POST', '/api/spieler/fall/' + zustand.fallId + '/checkliste', { sitzung: zustand.sitzung, json: { item: t.getAttribute('data-angefordert'), angefordert: t.checked } })
        .then(ladeFall).catch(function (e) { fehler(A.meldung(e.code)); });
    }
  });
  d.addEventListener('click', function (ev) {
    var t = ev.target.closest && ev.target.closest('[data-loeschen]');
    if (!t) return;
    A.anfrage('DELETE', '/api/spieler/fall/' + zustand.fallId + '/belege/' + t.getAttribute('data-loeschen'), { sitzung: zustand.sitzung })
      .then(ladeFall).catch(function (e) { fehler(A.meldung(e.code)); });
  });
  $('[data-weiter="3"]').addEventListener('click', function () { zeige(4); $('#f-email').focus(); });

  /* E-Mail am Ende */
  $('[data-code-senden]').addEventListener('click', function () {
    var btn = this, email = $('#f-email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fehler(A.meldung('email_ungueltig'));
    beschaeftigt(btn, true, 'Wird gesendet …');
    A.anfrage('POST', '/api/spieler/fall/' + zustand.fallId + '/bestaetigung', { sitzung: zustand.sitzung, json: { email: email } })
      .then(function (r) {
        $('[data-code-schritt]').hidden = false; $('#f-code').focus(); fehler('');
        if (r.devCode) console.info('[lokal] Code:', r.devCode);
      }).catch(function (e) { fehler(A.meldung(e.code)); }).then(function () { beschaeftigt(btn, false); btn.textContent = 'Code erneut schicken'; });
  });
  function bestaetige(daten) {
    return A.anfrage('POST', '/api/spieler/bestaetigen', { json: daten }).then(function (r) {
      zustand = { fallId: r.fallId, sitzung: r.sitzung }; speichere();
      return ladeFall();
    }).then(function () { zeige(5); });
  }
  $('[data-code-pruefen]').addEventListener('click', function () {
    var btn = this; beschaeftigt(btn, true);
    bestaetige({ email: $('#f-email').value.trim(), code: $('#f-code').value.trim() })
      .catch(function (e) { fehler(A.meldung(e.code)); }).then(function () { beschaeftigt(btn, false); });
  });

  /* Späterer Login */
  $('[data-login-senden]').addEventListener('click', function () {
    var btn = this, st = $('[data-login-status]'); beschaeftigt(btn, true);
    A.turnstileStart($('[data-turnstile]'));
    A.turnstileToken().then(function (tok) { return A.anfrage('POST', '/api/spieler/login/anfordern', { json: { email: $('#l-email').value.trim(), turnstile: tok } }); })
      .then(function (r) { $('[data-login-code]').hidden = false; st.textContent = 'Wenn zu dieser Adresse ein Fall gehört, ist ein Code unterwegs.'; if (r.devCode) console.info('[lokal] Code:', r.devCode); })
      .catch(function (e) { st.textContent = A.meldung(e.code); }).then(function () { beschaeftigt(btn, false); });
  });
  function login(daten) {
    return A.anfrage('POST', '/api/spieler/login', { json: daten }).then(function (r) { zustand = { sitzung: r.sitzung }; speichere(); return ladeFall(); }).then(function () { zeige(5); });
  }
  $('[data-login-pruefen]').addEventListener('click', function () {
    login({ email: $('#l-email').value.trim(), code: $('#l-code').value.trim() }).catch(function (e) { $('[data-login-status]').textContent = A.meldung(e.code); });
  });
  $('[data-abmelden]').addEventListener('click', function () {
    A.anfrage('POST', '/api/abmelden', { sitzung: zustand.sitzung }).catch(function () { /* egal */ }).then(function () { zustand = {}; speichere(); location.reload(); });
  });

  /* Start: Magic-Link aus der E-Mail oder bestehende Sitzung */
  var h = new URLSearchParams(location.hash.slice(1));
  if (h.get('link') && h.get('e')) {
    history.replaceState(null, '', location.pathname);
    var daten = { email: h.get('e'), link: h.get('link') };
    (h.get('z') === 'spieler_login' ? login(daten) : bestaetige(daten)).catch(function (e) { zeige(1); fehler(A.meldung(e.code)); });
  } else if (zustand.sitzung) {
    ladeFall().then(function (f) { zeige(f.bestaetigt ? 5 : 3); }).catch(function () { zustand = {}; speichere(); zeige(1); });
  } else {
    zeige(1);
  }
})();
