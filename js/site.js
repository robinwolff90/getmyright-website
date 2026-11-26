/* GetMyRight – minimales Vanilla-JS: Menü, Vorschau-Formulare, "Was die Kanzlei sieht", Lesehilfen. Keine Übertragung von Daten. */
(function () {
  'use strict';
  var d = document;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Menü */
  var mb = d.querySelector('[data-menue]');
  var nav = d.getElementById('hauptnav');
  if (mb && nav) {
    mb.addEventListener('click', function () {
      var open = nav.classList.toggle('offen');
      mb.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    d.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('offen')) {
        nav.classList.remove('offen'); mb.setAttribute('aria-expanded', 'false'); mb.focus();
      }
    });
  }

  /* Inhaltsverzeichnis: auf schmalen Bildschirmen eingeklappt */
  var toc = d.querySelector('details.inhalt');
  if (toc && window.matchMedia('(max-width: 1000px)').matches) { toc.removeAttribute('open'); }

  /* Signatur: Was die Kanzlei sieht */
  var es = d.querySelector('[data-einschub]');
  if (es) {
    var block = es.closest('[data-einschub-block]') || d;
    var sw = block.querySelector('[data-einschub-schalter]');
    var status = block.querySelector('[data-einschub-status]');
    var personen = es.querySelectorAll('.person');
    var manuell = false;
    var setZ = function (z) {
      es.setAttribute('data-zustand', z);
      if (sw) sw.setAttribute('aria-checked', z === 'ein' ? 'true' : 'false');
      if (status) status.setAttribute('data-zustand', z);
      for (var i = 0; i < personen.length; i++) { personen[i].setAttribute('aria-hidden', z === 'ein' ? 'true' : 'false'); }
    };
    es.parentNode.classList.remove('einschub-ohnejs');
    if (sw) sw.hidden = false;
    setZ(reduce ? 'ein' : 'offen');
    if (sw) sw.addEventListener('click', function () {
      manuell = true;
      setZ(es.getAttribute('data-zustand') === 'ein' ? 'offen' : 'ein');
    });
    if (!reduce && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (en) {
        if (en[0].isIntersecting && !manuell) {
          window.setTimeout(function () { if (!manuell) setZ('ein'); }, 650);
          io.disconnect();
        }
      }, { threshold: 0.65 });
      io.observe(es);
    } else { setZ('ein'); }
  }

  /* Formulare */
  var MSG = {
    text: 'Bitte füllen Sie dieses Feld aus.',
    email: 'Bitte geben Sie eine gültige E-Mail-Adresse ein, z. B. name@beispiel.de.',
    check: 'Bitte bestätigen Sie dieses Feld, um fortzufahren.',
    min: 'Bitte verwenden Sie mindestens 10 Zeichen.',
    gleich: 'Die beiden Passwörter stimmen nicht überein.'
  };
  function fehlerEl(f) {
    var host = f.closest('.feld') || f.closest('.wahl') || f.parentNode;
    var id = (f.id || f.name || 'f') + '-fehler';
    var el = d.getElementById(id);
    if (!el) {
      el = d.createElement('p'); el.className = 'fehlertext'; el.id = id;
      if (host.classList.contains('wahl')) { (host.closest('.einwilligung') || host).appendChild(el); }
      else { host.appendChild(el); }
    }
    return el;
  }
  function setFehler(f, text) {
    var el = fehlerEl(f);
    if (text) {
      el.textContent = text; f.setAttribute('aria-invalid', 'true'); f.setAttribute('aria-describedby', el.id);
      var eb = f.closest('.einwilligung'); if (eb) eb.classList.add('fehler');
    } else {
      el.textContent = ''; f.removeAttribute('aria-invalid');
      var eb2 = f.closest('.einwilligung'); if (eb2) eb2.classList.remove('fehler');
    }
  }
  function pruefe(f, form) {
    if (f.disabled || f.closest('fieldset:disabled')) return true;
    var t = '';
    if (f.type === 'checkbox') { if (f.required && !f.checked) t = f.getAttribute('data-msg') || MSG.check; }
    else if (f.type === 'file') { if (f.required && !(f.files && f.files.length)) t = f.getAttribute('data-msg') || MSG.text; }
    else {
      var v = (f.value || '').trim();
      if (f.required && !v) t = f.getAttribute('data-msg') || MSG.text;
      else if (v && f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) t = MSG.email;
      else if (v && f.minLength > 0 && v.length < f.minLength) t = MSG.min;
      else if (v && f.hasAttribute('data-gleich')) {
        var o = form.querySelector('[name="' + f.getAttribute('data-gleich') + '"]');
        if (o && o.value !== f.value) t = MSG.gleich;
      }
    }
    setFehler(f, t);
    return !t;
  }
  function pruefeForm(form) {
    var felder = form.querySelectorAll('input,select,textarea');
    var erstes = null, n = 0;
    for (var i = 0; i < felder.length; i++) {
      if (!pruefe(felder[i], form)) { n++; if (!erstes) erstes = felder[i]; }
    }
    var sum = form.querySelector('[data-fehlersumme]');
    if (sum) { sum.textContent = n ? (n === 1 ? 'Bitte prüfen Sie 1 Angabe.' : 'Bitte prüfen Sie ' + n + ' Angaben.') : ''; }
    if (erstes) erstes.focus();
    return n === 0;
  }
  function live(form) {
    form.addEventListener('input', function (e) { if (e.target.getAttribute('aria-invalid') === 'true') pruefe(e.target, form); });
    form.addEventListener('change', function (e) { if (e.target.getAttribute('aria-invalid') === 'true') pruefe(e.target, form); });
    form.setAttribute('novalidate', '');
  }
  /* Startseite: echter GET nach spieler/warteliste.html */
  var hero = d.querySelector('form[data-hero]');
  if (hero) {
    live(hero);
    hero.addEventListener('submit', function (e) { if (!pruefeForm(hero)) e.preventDefault(); });
  }
  /* Echte Warteliste (getmyright.de): Validierung hier, Versand in /js/gmr-spieler-warteliste.js */
  var echt = d.querySelector('form[data-gmr-spieler-warteliste]');
  if (echt) {
    live(echt);
    echt.addEventListener('submit', function (e) { e.preventDefault(); if (!pruefeForm(echt)) { var o = echt.querySelector('[data-bestaetigung]'); if (o) o.hidden = true; } });
  }
  /* Vorschau-Formulare: nichts wird gesendet */
  var forms = d.querySelectorAll('form[data-vorschau]');
  Array.prototype.forEach.call(forms, function (form) {
    live(form);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = pruefeForm(form);
      var out = form.querySelector('[data-bestaetigung]');
      if (!ok) { if (out) { out.hidden = true; } return; }
      if (out) {
        out.hidden = false;
        out.innerHTML = '<p><strong>' + (form.getAttribute('data-ok-titel') || 'Eingaben geprüft.') + '</strong> In dieser Vorschau wurden keine Daten übertragen. Mit dem späteren Anschluss des Backends würde die Eingabe hier verarbeitet.</p>';
        out.setAttribute('tabindex', '-1'); out.focus();
      }
    });
  });

  /* Sprung zum Formular: Fokus aufs erste Feld */
  Array.prototype.forEach.call(d.querySelectorAll('a[href="#eintragen"]'), function (a) {
    a.addEventListener('click', function () {
      var f = d.getElementById('h-name');
      if (f) window.setTimeout(function () { f.focus({ preventScroll: true }); }, reduce ? 0 : 600);
    });
  });

  /* Anmeldelink (Vorschau): prüft nur die E-Mail-Adresse */
  Array.prototype.forEach.call(d.querySelectorAll('button[data-magic]'), function (b) {
    b.addEventListener('click', function () {
      var form = b.closest('form'), em = form.querySelector('input[type=email]'), out = form.querySelector('[data-bestaetigung]');
      if (!pruefe(em, form)) { em.focus(); if (out) out.hidden = true; return; }
      out.hidden = false;
      out.innerHTML = '<p><strong>Anmeldelink angefordert.</strong> In dieser Vorschau wurde keine E-Mail verschickt und keine Daten übertragen.</p>';
    });
  });

  /* Warteliste: Vorbelegung aus GET */
  var wl = d.querySelector('form[data-warteliste]');
  if (wl && window.URLSearchParams) {
    var p = new URLSearchParams(window.location.search);
    var set = function (n, v) { var el = wl.querySelector('[name="' + n + '"]'); if (el && v) el.value = v; };
    set('FIRSTNAME', (p.get('FIRSTNAME') || '').slice(0, 200));
    set('EMAIL', (p.get('EMAIL') || '').slice(0, 254));
    if (p.get('OPT_IN') === '1') { var c = wl.querySelector('[name="OPT_IN"]'); if (c) c.checked = true; }
  }

  /* Art.-9-Schranke */
  var a9 = d.querySelector('[data-art9-toggle]');
  if (a9) {
    var sets = d.querySelectorAll('fieldset[data-art9]');
    var hint = d.querySelector('[data-art9-hinweis]');
    var upd = function () {
      for (var i = 0; i < sets.length; i++) { sets[i].disabled = !a9.checked; }
      if (hint) hint.hidden = a9.checked;
    };
    a9.addEventListener('change', upd); upd();
  }
  var oas = d.querySelectorAll('input[name="oasis"]');
  var fol = d.querySelector('[data-oasis-folge]');
  if (oas.length && fol) {
    Array.prototype.forEach.call(oas, function (r) { r.addEventListener('change', function () { fol.hidden = r.value !== 'Ja'; }); });
  }
  Array.prototype.forEach.call(d.querySelectorAll('[data-ueberspringen]'), function (b) {
    b.addEventListener('click', function () {
      var fs = b.closest('fieldset');
      Array.prototype.forEach.call(fs.querySelectorAll('input,select,textarea'), function (el) {
        if (el.type === 'checkbox' || el.type === 'radio') el.checked = false; else el.value = '';
      });
      if (fol && fs.contains(fol)) fol.hidden = true;
      b.textContent = 'Übersprungen';
      window.setTimeout(function () { b.textContent = 'Frage überspringen'; }, 1800);
    });
  });
  /* 2FA: Mobilnummer nur bei SMS */
  var tf = d.querySelectorAll('input[name="twofa"]');
  var ph = d.querySelector('[data-telefon-wrap]');
  if (tf.length && ph) {
    Array.prototype.forEach.call(tf, function (r) { r.addEventListener('change', function () { ph.hidden = r.value !== 'sms' || !r.checked; }); });
  }

  /* Upload: lokale Prüfung von Name, Größe, Typ */
  var uf = d.querySelector('input[type=file][data-upload]');
  if (uf) {
    var liste = d.querySelector('[data-dateiliste]');
    var erlaubt = /\.(zip|csv|pdf|xlsx|xls|json|txt|png|jpg|jpeg)$/i;
    uf.addEventListener('change', function () {
      liste.textContent = '';
      Array.prototype.forEach.call(uf.files, function (f) {
        var li = d.createElement('li');
        var okT = erlaubt.test(f.name), okG = f.size <= 250 * 1024 * 1024;
        li.textContent = f.name + ' · ' + (f.size / 1048576).toFixed(1).replace('.', ',') + ' MB · ' + (okT && okG ? 'zulässig' : (!okT ? 'Dateityp nicht erlaubt' : 'größer als 250 MB'));
        liste.appendChild(li);
      });
    });
  }

  /* Dashboard-Vorschau: filtern und reservieren (nur lokal, nicht gespeichert) */
  var tb = d.querySelector('[data-faelle]');
  if (tb) {
    var q = d.querySelector('[data-filter-q]'), st = d.querySelector('[data-filter-status]'), li2 = d.querySelector('[data-filter-lizenz]'), cnt = d.querySelector('[data-anzahl]');
    var rows = tb.querySelectorAll('tbody tr'), res = d.querySelector('[data-reservierungen]');
    var filt = function () {
      var n = 0, qq = (q.value || '').toLowerCase();
      Array.prototype.forEach.call(rows, function (r) {
        var show = (!qq || r.textContent.toLowerCase().indexOf(qq) > -1) && (!st.value || r.getAttribute('data-status') === st.value) && (!li2.value || r.getAttribute('data-lizenz') === li2.value);
        r.hidden = !show; if (show) n++;
      });
      cnt.textContent = n;
    };
    [q, st, li2].forEach(function (el) { el.addEventListener('input', filt); el.addEventListener('change', filt); });
    var gesetzt = {};
    var zeige = function () {
      var ids = Object.keys(gesetzt);
      res.innerHTML = ids.length ? '<ul class="clean">' + ids.map(function (i) { return '<li><strong>' + i + '</strong> · reserviert (Vorschau)</li>'; }).join('') + '</ul>' : '<p class="leer">Noch keine Reservierung. In dieser Vorschau wird nichts gespeichert.</p>';
    };
    zeige();
    tb.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-reserviere]'); if (!b) return;
      var id = b.getAttribute('data-reserviere');
      if (gesetzt[id]) { delete gesetzt[id]; b.textContent = 'Reservieren'; b.classList.remove('btn--sek'); b.setAttribute('aria-pressed', 'false'); }
      else { gesetzt[id] = 1; b.textContent = 'Reserviert'; b.classList.add('btn--sek'); b.setAttribute('aria-pressed', 'true'); }
      zeige();
    });
  }

  /* Datenschutz: lokale Browser-Daten löschen */
  var wipe = d.querySelector('[data-lokal-loeschen]');
  if (wipe) {
    var out = d.querySelector('[data-lokal-status]');
    wipe.addEventListener('click', function () {
      var n = 0;
      try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('gmr_') === 0) { localStorage.removeItem(k); n++; } }); } catch (e) {}
      try { sessionStorage.removeItem('gmr_session'); } catch (e) {}
      try { if (window.indexedDB) indexedDB.deleteDatabase('gmr-secure'); } catch (e) {}
      out.hidden = false;
      out.textContent = 'Erledigt. Auf diesem Gerät sind keine GetMyRight-Daten mehr gespeichert' + (n ? ' (' + n + ' Einträge entfernt).' : '.');
    });
  }
})();
