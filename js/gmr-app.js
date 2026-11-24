/* GetMyRight – Frontend-Logik (statische Website, kein eigener Server)
 * - Beim Seitenaufruf werden KEINE Cookies, KEIN localStorage/sessionStorage/IndexedDB und KEINE Drittanbieter genutzt.
 * - Formulare liegen in <fieldset data-gmr-js-only disabled> und werden erst hier freigeschaltet (kein GET-Leak ohne JS).
 * - Warteliste: nur EMAIL, FIRSTNAME, OPT_IN gehen per HTTPS an Brevo (Double-Opt-in). Drei getrennte Einwilligungen
 *   (Warteliste, Updates, Art. 9). Sensible Fragen sind bis zur Art.-9-Einwilligung gesperrt. Optionale Angaben werden
 *   mit AES-GCM (256 Bit, Web Crypto API) lokal verschlüsselt; per E-Mail geht nur eine Referenz-ID (nach Transport-Hinweis).
 * - Login/Registrierung/2FA: Vorschau-Konten lokal, AES-GCM-verschlüsselt (PBKDF2-Hash, TOTP-Prüfung im Browser).
 * - Upload: keine automatische Schwärzung; optionale Selbstschwärzung privater Zeilen durch den Spieler (GMRSelfRedact).
 * - Google-Login: nur aktiv, wenn in /js/gmr-config.js eine Client-ID hinterlegt ist (dann CSP erweitern).
 */
(function () {
  'use strict';
  var CFG = window.GMR_CONFIG || {};
  var CONTACT = CFG.contactEmail || 'info@getmyright.de';
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var enc = new TextEncoder(), dec = new TextDecoder();
  var HOME = { spieler: '/spieler/portal.html', kanzlei: '/kanzlei/dashboard.html', betreiber: '/admin.html#uebersicht' };

  function go(t) { var parts = t.split('#'); if (parts[0] === location.pathname) { if (parts[1]) location.hash = parts[1]; location.reload(); } else location.href = t; }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function status(box, type, html) {
    if (!box) return;
    box.className = 'status note ' + (type || '');
    box.setAttribute('role', type === 'err' ? 'alert' : 'status');
    box.innerHTML = html;
    box.hidden = false;
  }
  function invalid(el, bad) { if (el) el.setAttribute('aria-invalid', bad ? 'true' : 'false'); return bad; }
  function mailto(subject, body) { return 'mailto:' + CONTACT + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body); }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
  function sess(v) { try { if (v === undefined) return JSON.parse(sessionStorage.getItem('gmr_session') || 'null'); if (v === null) sessionStorage.removeItem('gmr_session'); else sessionStorage.setItem('gmr_session', JSON.stringify(v)); } catch (e) { return null; } }
  function b64(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
  function unb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function rnd(n) { return crypto.getRandomValues(new Uint8Array(n)); }
  function hasCrypto() { return !!(window.crypto && crypto.subtle); }

  /* ---------- Navigation ---------- */
  function initNav() {
    $$('[data-gmr-nav-toggle]').forEach(function (btn) {
      var nav = document.getElementById(btn.getAttribute('aria-controls'));
      btn.addEventListener('click', function () {
        var open = nav.classList.toggle('open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });
    var here = location.pathname.replace(/index\.html$/, '');
    $$('.nav a').forEach(function (a) {
      var p = a.getAttribute('href').replace(/index\.html$/, '');
      if (p === here) a.setAttribute('aria-current', 'page');
    });
  }

  /* ---------- Gerätespezifischer AES-GCM-Schlüssel (nicht extrahierbar, IndexedDB) ---------- */
  var openDbs = [];
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('gmr-secure', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('keys'); };
      r.onsuccess = function () { openDbs.push(r.result); res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbGet(db, k) { return new Promise(function (res, rej) { var t = db.transaction('keys').objectStore('keys').get(k); t.onsuccess = function () { res(t.result); }; t.onerror = function () { rej(t.error); }; }); }
  function idbPut(db, k, v) { return new Promise(function (res, rej) { var t = db.transaction('keys', 'readwrite').objectStore('keys').put(v, k); t.onsuccess = function () { res(); }; t.onerror = function () { rej(t.error); }; }); }
  var deviceKeyP = null;
  function deviceKey() {
    if (deviceKeyP) return deviceKeyP;
    deviceKeyP = idb().then(function (db) {
      return idbGet(db, 'device-aes').then(function (k) {
        if (k) return k;
        return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']).then(function (nk) {
          return idbPut(db, 'device-aes', nk).then(function () { return nk; });
        });
      });
    });
    return deviceKeyP;
  }
  function passKey(pass, salt) {
    return crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function encryptJSON(obj, pass) {
    var iv = rnd(12), salt = rnd(16);
    return (pass ? passKey(pass, salt) : deviceKey()).then(function (key) {
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(JSON.stringify(obj)));
    }).then(function (ct) {
      return { v: 1, alg: 'AES-GCM-256', mode: pass ? 'passphrase-pbkdf2' : 'device-key', iv: b64(iv), salt: pass ? b64(salt) : null, ct: b64(ct), savedAt: new Date().toISOString() };
    });
  }
  function decryptJSON(rec, pass) {
    var keyP = rec.mode === 'passphrase-pbkdf2' ? passKey(pass || '', unb64(rec.salt)) : deviceKey();
    return keyP.then(function (key) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, key, unb64(rec.ct)); })
      .then(function (pt) { return JSON.parse(dec.decode(pt)); });
  }

  /* ---------- Passwort-Hash (PBKDF2) ---------- */
  function hashPw(pw, saltB64) {
    var salt = saltB64 ? unb64(saltB64) : rnd(16);
    return crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']).then(function (k) {
      return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt, iterations: 210000, hash: 'SHA-256' }, k, 256);
    }).then(function (bits) { return { hash: b64(bits), salt: b64(salt) }; });
  }
  /* ---------- Vorschau-Konten: AES-GCM-verschlüsselt, Speicherschlüssel nur mit SHA-256 der E-Mail ---------- */
  function sha256hex(s) {
    return crypto.subtle.digest('SHA-256', enc.encode(s)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('').slice(0, 32);
    });
  }
  function accKey(role, email) { return sha256hex(String(email).trim().toLowerCase()).then(function (h) { return 'gmr_acc_' + role + '_' + h; }); }
  function legacyAccKey(role, email) { return 'gmr_acc_' + role + '_' + String(email).trim().toLowerCase(); }
  function saveAcc(acc) {
    return Promise.all([accKey(acc.role, acc.email), encryptJSON(acc)]).then(function (r) {
      store(r[0], r[1]);
      try { localStorage.removeItem(legacyAccKey(acc.role, acc.email)); } catch (e) { /* ignorieren */ }
      return acc;
    });
  }
  function loadAcc(role, email) {
    return accKey(role, email).then(function (k) {
      var rec = store(k);
      if (rec && rec.ct) return decryptJSON(rec).catch(function () { return null; });
      var legacy = store(legacyAccKey(role, email)); // Migration aus älterer Klartext-Vorschau
      if (legacy && legacy.hash) { legacy.role = legacy.role || role; return saveAcc(legacy); }
      return null;
    });
  }
  /* E-Mail-Button erst nach ausdrücklicher Bestätigung des Transport-Hinweises aktivieren */
  function gateMailto(ack, a, hrefFn) {
    if (!ack || !a) return;
    function upd() {
      if (ack.checked) { a.href = hrefFn(); a.hidden = false; a.removeAttribute('aria-disabled'); }
      else { a.removeAttribute('href'); a.hidden = true; a.setAttribute('aria-disabled', 'true'); }
    }
    ack.addEventListener('change', upd); upd();
  }
  var MAIL_ACK_TEXT = 'Mir ist bekannt, dass E-Mails unverschlüsselt über meinen E-Mail-Anbieter an ' + CONTACT + ' übertragen und dort im Postfach von Spacemail (Spaceship Inc., USA) gespeichert werden.';

  /* ---------- TOTP (RFC 6238, HMAC-SHA1, 30 s) ---------- */
  var B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function b32enc(u) { var bits = 0, val = 0, out = ''; for (var i = 0; i < u.length; i++) { val = (val << 8) | u[i]; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
  function b32dec(s) { s = s.replace(/=+$/, '').toUpperCase(); var bits = 0, val = 0, out = []; for (var i = 0; i < s.length; i++) { var x = B32.indexOf(s[i]); if (x < 0) continue; val = (val << 5) | x; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return new Uint8Array(out); }
  function totp(secret, step) {
    var ctr = Math.floor(Date.now() / 30000) + (step || 0), buf = new ArrayBuffer(8), dv = new DataView(buf);
    dv.setUint32(0, Math.floor(ctr / 4294967296)); dv.setUint32(4, ctr >>> 0);
    return crypto.subtle.importKey('raw', b32dec(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']).then(function (k) {
      return crypto.subtle.sign('HMAC', k, buf);
    }).then(function (sig) {
      var h = new Uint8Array(sig), o = h[h.length - 1] & 15;
      var code = ((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1000000;
      return ('000000' + code).slice(-6);
    });
  }
  function verifyTotp(secret, code) {
    return Promise.all([totp(secret, -1), totp(secret, 0), totp(secret, 1)]).then(function (c) { return c.indexOf(code) >= 0; });
  }
  function smsCode() { var n = new Uint32Array(1); crypto.getRandomValues(n); return ('000000' + (n[0] % 1000000)).slice(-6); }

  /* 2FA-Einrichtung (gemeinsam für Registrierung und Einstellungen) */
  function setup2fa(panel, method, phone, label, done) {
    var box = $('[data-gmr-2fa-box]', panel) || panel;
    var secret = method === 'app' ? b32enc(rnd(20)) : null;
    var code = method === 'sms' ? smsCode() : null;
    var html = '<h4>Zwei-Faktor-Bestätigung einrichten</h4>';
    if (method === 'app') {
      var uri = 'otpauth://totp/GetMyRight:' + encodeURIComponent(label) + '?secret=' + secret + '&issuer=GetMyRight&digits=6&period=30';
      html += '<p class="small">Fügen Sie in Ihrer Authenticator-App (z. B. Google Authenticator, Microsoft Authenticator, Aegis) ein Konto per Schlüssel hinzu und geben Sie anschließend den 6-stelligen Code ein.</p>' +
        '<p class="secret" data-gmr-secret>' + esc(secret.replace(/(.{4})/g, '$1 ').trim()) + '</p><p class="small">Einrichtungs-URI: <span class="secret">' + esc(uri) + '</span></p>';
    } else {
      html += '<p class="small">Vorschau: Ein echter SMS-Versand an ' + esc(phone || 'Ihre Nummer') + ' erfordert einen Server-Endpunkt (otpEndpoint). Bis dahin wird der Einmalcode hier angezeigt:</p><p class="secret" data-gmr-preview-code>' + code + '</p>';
    }
    html += '<div class="field"><label for="' + panel.id + '-code">6-stelliger Code</label><input id="' + panel.id + '-code" class="code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" data-gmr-2fa-input></div>' +
      '<div class="btn-row"><button type="button" class="btn" data-gmr-2fa-verify>Code bestätigen</button></div><div class="status" data-gmr-2fa-status></div>';
    box.innerHTML = html; box.hidden = false; panel.hidden = false;
    var input = $('[data-gmr-2fa-input]', box), st = $('[data-gmr-2fa-status]', box);
    $('[data-gmr-2fa-verify]', box).addEventListener('click', function () {
      var v = (input.value || '').replace(/\D/g, '');
      if (v.length !== 6) { invalid(input, true); status(st, 'err', 'Bitte geben Sie einen 6-stelligen Code ein.'); return; }
      (method === 'app' ? verifyTotp(secret, v) : Promise.resolve(v === code)).then(function (ok) {
        invalid(input, !ok);
        if (!ok) { status(st, 'err', 'Der Code ist nicht korrekt oder abgelaufen. Bitte erneut versuchen.'); return; }
        status(st, 'ok', 'Zwei-Faktor-Bestätigung erfolgreich eingerichtet.');
        done({ method: method, secret: secret, phone: phone || '' });
      });
    });
  }

  /* ---------- Google-Login (OAuth / Google Identity Services) ---------- */
  function initGoogle() {
    $$('[data-gmr-google]').forEach(function (btn) {
      var role = btn.getAttribute('data-gmr-google');
      var st = document.getElementById(btn.getAttribute('aria-describedby')) || btn.parentNode.querySelector('[data-gmr-google-status]');
      btn.addEventListener('click', function () {
        if (!CFG.googleClientId) {
          status(st, 'warn', '<strong>Google-Login ist vorbereitet, aber noch nicht freigeschaltet.</strong> Für die Anmeldung mit Google benötigt GetMyRight eine OAuth-Client-ID aus der Google Cloud Console sowie einen Server-Endpunkt, der das Google-ID-Token prüft. Bis dahin nutzen Sie bitte die Anmeldung mit E-Mail und Passwort.');
          return;
        }
        loadGsi().then(function () {
          google.accounts.id.initialize({ client_id: CFG.googleClientId, callback: function (r) { googleDone(r, role, st); }, ux_mode: 'popup', auto_select: false });
          google.accounts.id.prompt(function (n) {
            if (n && n.isNotDisplayed && n.isNotDisplayed()) status(st, 'warn', 'Google konnte die Anmeldung nicht anzeigen (' + esc(n.getNotDisplayedReason()) + '). Bitte Pop-ups/Drittanbieter-Anmeldung erlauben.');
          });
        }).catch(function () { status(st, 'err', 'Der Google-Anmeldedienst konnte nicht geladen werden. Bitte später erneut versuchen.'); });
      });
    });
  }
  var gsiP = null;
  function loadGsi() {
    if (gsiP) return gsiP;
    gsiP = new Promise(function (res, rej) { var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    return gsiP;
  }
  function googleDone(resp, role, st) {
    var payload = {};
    try { payload = JSON.parse(decodeURIComponent(escape(atob(resp.credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch (e) { /* ignorieren */ }
    function finish(verified) {
      sess({ role: role, email: payload.email || '', name: payload.name || '', via: 'google', verified: verified, at: Date.now() });
      status(st, 'ok', 'Angemeldet mit Google' + (verified ? '' : ' (Vorschau – Token noch nicht serverseitig geprüft)') + '. Sie werden weitergeleitet …');
      setTimeout(function () { go(HOME[role]); }, 700);
    }
    if (!CFG.authEndpoint) return finish(false);
    fetch(CFG.authEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ credential: resp.credential, role: role }) })
      .then(function (r) { if (!r.ok) throw new Error(); finish(true); })
      .catch(function () { status(st, 'err', 'Die Google-Anmeldung konnte serverseitig nicht bestätigt werden.'); });
  }

  /* ---------- Magic-Link (passwortloser Schnellzugang) ---------- */
  function initMagic() {
    $$('[data-gmr-magic]').forEach(function (btn) {
      var role = btn.getAttribute('data-gmr-magic');
      var form = btn.closest('.card').querySelector('form[data-gmr-login]');
      var st = btn.closest('.card').querySelector('[data-gmr-magic-status]');
      btn.addEventListener('click', function () {
        var email = form.elements.email;
        if (invalid(email, !EMAIL_RE.test(email.value.trim()))) { status(st, 'err', 'Bitte geben Sie oben Ihre E-Mail-Adresse ein, um einen Anmeldelink zu erhalten.'); email.focus(); return; }
        if (!CFG.magicLinkEndpoint) { status(st, 'warn', '<strong>Magic-Link ist vorbereitet, aber noch nicht aktiv.</strong> Für den Versand zeitlich begrenzter Anmeldelinks per E-Mail wird ein Server-Endpunkt benötigt. Bis dahin melden Sie sich bitte mit E-Mail und Passwort an.'); return; }
        fetch(CFG.magicLinkEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.value.trim(), role: role }) })
          .then(function (r) { if (!r.ok) throw new Error(); status(st, 'ok', 'Falls ein Konto existiert, haben wir Ihnen einen Anmeldelink gesendet. Er ist 15 Minuten gültig.'); })
          .catch(function () { status(st, 'err', 'Der Anmeldelink konnte gerade nicht versendet werden. Bitte später erneut versuchen.'); });
      });
    });
  }

  /* ---------- Registrierung ---------- */
  function initRegister() {
    $$('form[data-gmr-register]').forEach(function (form) {
      var role = form.getAttribute('data-gmr-register');
      var st = $('[data-gmr-status]', form.parentNode) || $('[data-gmr-status]', form);
      var phoneWrap = $('[data-gmr-phone-wrap]', form);
      $$('input[name="twofa"]', form).forEach(function (r) {
        r.addEventListener('change', function () { if (phoneWrap) phoneWrap.hidden = form.elements.twofa.value !== 'sms'; });
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!hasCrypto()) { status(st, 'err', 'Ihr Browser unterstützt die benötigte Verschlüsselung (Web Crypto) nicht. Bitte nutzen Sie einen aktuellen Browser.'); return; }
        var el = form.elements, bad = false, msgs = [];
        $$('[required]', form).forEach(function (f) {
          var b = f.type === 'checkbox' ? !f.checked : (f.type === 'email' ? !EMAIL_RE.test(f.value.trim()) : !f.value.trim());
          if (invalid(f, b)) bad = true;
        });
        if (bad) msgs.push('Bitte füllen Sie alle Pflichtfelder korrekt aus und bestätigen Sie die Einwilligungen.');
        if (el.password && el.password.value.length < 10) { invalid(el.password, true); bad = true; msgs.push('Das Passwort muss mindestens 10 Zeichen lang sein.'); }
        if (el.password2 && el.password2.value !== el.password.value) { invalid(el.password2, true); bad = true; msgs.push('Die Passwörter stimmen nicht überein.'); }
        var method = el.twofa ? el.twofa.value || 'none' : 'none';
        var phone = el.phone ? el.phone.value.trim() : '';
        if (method === 'sms' && !/^\+?[0-9 ()\/-]{7,}$/.test(phone)) { invalid(el.phone, true); bad = true; msgs.push('Für SMS-Codes benötigen wir eine gültige Mobilnummer.'); }
        if (bad) { status(st, 'err', msgs.join('<br>')); return; }
        var email = el.email.value.trim().toLowerCase();
        var extras = {};
        $$('[data-gmr-field]', form).forEach(function (f) { var v = (f.value || '').trim(); if (v) extras[f.getAttribute('data-gmr-field')] = v; });
        hashPw(el.password.value).then(function (h) {
          var acc = { role: role, email: email, name: (el.name ? el.name.value.trim() : extras['Ansprechpartner'] || ''), hash: h.hash, salt: h.salt, twofa: { method: 'none' }, created: new Date().toISOString() };
          function save() {
            saveAcc(acc).then(finish).catch(function () { status(st, 'err', 'Das Vorschau-Konto konnte nicht verschlüsselt gespeichert werden. Bitte nutzen Sie einen aktuellen Browser.'); });
          }
          function finish() {
            var html = '<strong>Vorschau-Konto angelegt.</strong> Sie können sich jetzt auf diesem Gerät anmelden.' + (acc.twofa.method !== 'none' ? ' Zwei-Faktor-Bestätigung ist aktiv (' + (acc.twofa.method === 'app' ? 'Authenticator-App' : 'SMS') + ').' : '') +
              ' <a href="' + (role === 'betreiber' ? '/admin.html' : 'login.html') + '">Zur Anmeldung</a>';
            if (role === 'kanzlei') {
              var lines = Object.keys(extras).map(function (k) { return k + ': ' + extras[k]; });
              lines.unshift('E-Mail: ' + email);
              var body = 'Hallo GetMyRight-Team,\n\nwir möchten uns als Partnerkanzlei für den Software-Zugang vormerken lassen:\n\n' + lines.join('\n') + '\n2FA-Wunsch: ' + method + '\n\nViele Grüße';
              encryptJSON({ type: 'kanzlei-vormerkung', email: email, data: extras, twofa: method }).then(function (rec) {
                var list = store('gmr_kanzlei_vormerkungen') || []; list.push(rec); store('gmr_kanzlei_vormerkungen', list);
              }).catch(function (er) { if (window.console) console.warn('Lokale Verschlüsselung nicht möglich', er && er.name); });
              html += '<br><br><strong>Vormerkung übermitteln:</strong> Ihre Angaben wurden AES-GCM-verschlüsselt lokal gespeichert. An unser Team gelangen sie erst, wenn Sie die vorbereitete E-Mail senden.' +
                '<label class="choice" style="margin-top:10px"><input type="checkbox" data-gmr-mail-ack> <span>' + esc(MAIL_ACK_TEXT) + '</span></label><div class="btn-row"><a class="btn accent" data-gmr-mailto hidden>Vormerkung per E-Mail senden</a></div>';
            }
            if (role === 'spieler' && el.brevo && el.brevo.checked) {
              brevoSend({ EMAIL: email, FIRSTNAME: acc.name, OPT_IN: '1' }, form).then(function () {
                status($('[data-gmr-brevo-status]', form.parentNode), 'ok', 'Zusätzlich für Start-Informationen eingetragen – bitte bestätigen Sie die E-Mail von Brevo (Double-Opt-in).');
              }).catch(function (er) {
                status($('[data-gmr-brevo-status]', form.parentNode), 'warn', er && er.brevo ? sendErrText(er) + ' Sie können sich jederzeit über die Warteliste eintragen.' : 'Die Eintragung für Start-Informationen ist gerade nicht erreichbar. Sie können sich jederzeit über die Warteliste eintragen.');
              });
            }
            status(st, 'ok', html);
            if (role === 'kanzlei') gateMailto($('[data-gmr-mail-ack]', st), $('[data-gmr-mailto]', st), function () { return mailto('Kanzlei-Vormerkung GetMyRight', body); });
            $$('input, select, textarea, button[type=submit]', form).forEach(function (f) { f.disabled = true; });
          }
          if (method === 'none') return save();
          var panel = $('[data-gmr-2fa-setup]', form.parentNode);
          status(st, '', 'Fast fertig: Bitte richten Sie jetzt Ihre Zwei-Faktor-Bestätigung ein.');
          setup2fa(panel, method, phone, email, function (tf) { acc.twofa = tf; save(); });
        });
      });
    });
  }


  /* ---------- Login ---------- */
  function initLogin() {
    $$('form[data-gmr-login]').forEach(function (form) {
      var role = form.getAttribute('data-gmr-login');
      var st = $('[data-gmr-status]', form.parentNode) || $('[data-gmr-status]', form);
      var step = $('[data-gmr-2fa-step]', form.parentNode);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!hasCrypto()) { status(st, 'err', 'Ihr Browser unterstützt die benötigte Verschlüsselung nicht.'); return; }
        var email = form.elements.email, pw = form.elements.password;
        var b1 = invalid(email, !EMAIL_RE.test(email.value.trim())), b2 = invalid(pw, !pw.value);
        if (b1 || b2) { status(st, 'err', 'Bitte geben Sie eine gültige E-Mail-Adresse und Ihr Passwort ein.'); return; }
        loadAcc(role, email.value.trim()).then(function (acc) {
          if (!acc) { invalid(pw, true); status(st, 'err', 'E-Mail oder Passwort falsch.'); return; }
          return hashPw(pw.value, acc.salt).then(function (h) {
            if (h.hash !== acc.hash) { invalid(pw, true); status(st, 'err', 'E-Mail oder Passwort falsch.'); return; }
            var method = acc.twofa && acc.twofa.method !== 'none' ? acc.twofa.method : (form.elements.force2fa && form.elements.force2fa.checked ? 'sms' : 'none');
            function done() {
              sess({ role: role, email: acc.email, name: acc.name, via: 'passwort', twofa: method, at: Date.now() });
              status(st, 'ok', 'Anmeldung erfolgreich. Sie werden weitergeleitet …');
              setTimeout(function () { go(HOME[role]); }, 600);
            }
            if (method === 'none') return done();
            var code = method === 'sms' ? smsCode() : null;
            step.hidden = false;
            $('[data-gmr-2fa-hint]', step).innerHTML = method === 'app' ? 'Bitte geben Sie den aktuellen 6-stelligen Code aus Ihrer Authenticator-App ein.' :
              'Vorschau ohne SMS-Versand: Ihr Einmalcode lautet <span class="secret" data-gmr-preview-code>' + code + '</span>';
            var input = $('[data-gmr-2fa-input]', step), sst = $('[data-gmr-2fa-status]', step), btn = $('[data-gmr-2fa-verify]', step);
            input.focus();
            btn.onclick = function () {
              var v = (input.value || '').replace(/\D/g, '');
              if (v.length !== 6) { invalid(input, true); status(sst, 'err', 'Bitte geben Sie einen 6-stelligen Code ein.'); return; }
              (method === 'app' ? verifyTotp(acc.twofa.secret, v) : Promise.resolve(v === code)).then(function (ok) {
                invalid(input, !ok);
                if (!ok) { status(sst, 'err', 'Der Code ist nicht korrekt oder abgelaufen.'); return; }
                status(sst, 'ok', 'Code bestätigt.'); done();
              });
            };
            status(st, '', 'Passwort bestätigt – bitte schließen Sie die Zwei-Faktor-Bestätigung ab.');
          });
        }).catch(function () { status(st, 'err', 'Die lokale Anmeldung ist in diesem Browser nicht möglich.'); });
      });
    });
  }

  /* ---------- Sitzung, Abmelden, 2FA-Einstellungen (nur mit aktiver Sitzung) ---------- */
  function initSession() {
    var s = sess();
    $$('[data-gmr-session]').forEach(function (box) {
      var role = box.getAttribute('data-gmr-session');
      if (s && s.role === role) box.innerHTML = 'Angemeldet als <strong>' + esc(s.name || s.email) + '</strong> (' + (s.via === 'google' ? 'Google' : 'E-Mail & Passwort') + (s.twofa && s.twofa !== 'none' ? ', mit 2FA' : '') + ').';
      else box.innerHTML = 'Sie sehen die Demo-Ansicht ohne Anmeldung. <a href="' + ({ spieler: '/spieler/login.html', kanzlei: '/kanzlei/login.html', betreiber: '/admin.html' }[role]) + '">Anmelden</a>';
    });
    $$('[data-gmr-logout]').forEach(function (a) { a.addEventListener('click', function () { sess(null); }); });
    $$('[data-gmr-2fa-settings]').forEach(function (wrap) {
      var role = wrap.getAttribute('data-gmr-2fa-settings');
      var toggle = $('[data-gmr-2fa-toggle]', wrap), sel = $('[data-gmr-2fa-method]', wrap), st = $('[data-gmr-2fa-state]', wrap), panel = $('[data-gmr-2fa-setup]', wrap), hint = $('[data-gmr-2fa-login-hint]', wrap);
      function lock(msg) {
        toggle.disabled = true; sel.disabled = true; toggle.checked = false; if (panel) panel.hidden = true;
        st.innerHTML = '<span class="badge warn">Anmeldung erforderlich</span>';
        if (hint) { hint.hidden = false; if (msg) hint.textContent = msg; }
        wrap.setAttribute('data-gmr-2fa-locked', 'true');
      }
      lock();
      if (!(s && s.role === role && s.email) || !hasCrypto()) return;
      loadAcc(role, s.email).then(function (acc) {
        if (!acc) { lock('Für diese Sitzung ist auf diesem Gerät kein Vorschau-Konto gespeichert. Die 2FA-Einstellungen sind daher nicht verfügbar.'); return; }
        var cur = acc.twofa || { method: 'none' };
        toggle.disabled = false; sel.disabled = false; if (hint) hint.hidden = true; wrap.removeAttribute('data-gmr-2fa-locked');
        function show() { st.innerHTML = cur.method === 'none' ? '<span class="badge warn">2FA aus</span>' : '<span class="badge ok">2FA aktiv · ' + (cur.method === 'app' ? 'Authenticator-App' : 'SMS') + '</span>'; toggle.checked = cur.method !== 'none'; }
        function persist() { acc.twofa = cur; show(); saveAcc(acc); }
        show();
        toggle.addEventListener('change', function () {
          if (!toggle.checked) { cur = { method: 'none' }; panel.hidden = true; persist(); return; }
          setup2fa(panel, sel.value, sel.value === 'sms' ? 'Ihre hinterlegte Nummer' : '', acc.email, function (tf) { cur = tf; persist(); });
        });
      }).catch(function () { lock(); });
    });
  }

  /* ---------- Warteliste-Versand (über eigenen Worker → Brevo) ---------- */
  var PAGE_T0 = Date.now(), MIN_FILL = CFG.minFillMs || 3000, lastSend = 0, inFlight = false, tsLoad = null;
  function loadTurnstile() {
    if (!CFG.turnstileSiteKey) return Promise.resolve(null);
    if (tsLoad) return tsLoad;
    tsLoad = new Promise(function (res, rej) {
      if (window.turnstile) return res(window.turnstile);
      var sc = document.createElement('script');
      sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      sc.async = true; sc.onload = function () { res(window.turnstile); }; sc.onerror = function () { tsLoad = null; rej(new Error('turnstile')); };
      document.head.appendChild(sc);
    });
    return tsLoad;
  }
  function initTurnstile(form) {
    var box = $('[data-gmr-turnstile]', form);
    if (!box || !CFG.turnstileSiteKey) return;
    loadTurnstile().then(function (ts) { if (ts && !box.getAttribute('data-ts-id')) box.setAttribute('data-ts-id', ts.render(box, { sitekey: CFG.turnstileSiteKey, theme: 'light', language: 'de', appearance: 'interaction-only' })); })
      .catch(function () { box.textContent = 'Der Spam-Schutz konnte nicht geladen werden. Bitte laden Sie die Seite neu.'; });
  }
  function turnstileToken(form) {
    var box = form && $('[data-gmr-turnstile]', form);
    if (!CFG.turnstileSiteKey || !box || !window.turnstile) return '';
    return window.turnstile.getResponse(box.getAttribute('data-ts-id')) || '';
  }
  function turnstileReset(form) { var box = form && $('[data-gmr-turnstile]', form); if (box && window.turnstile && box.getAttribute('data-ts-id')) try { window.turnstile.reset(box.getAttribute('data-ts-id')); } catch (e) { /* ignorieren */ } }
  /* Zeitfalle: Formulare, die schneller als MIN_FILL nach dem Laden abgeschickt werden, gelten als Bot */
  function tooFast() { return Date.now() - PAGE_T0 < MIN_FILL; }
  function honeypotHit(form) { return !!$$('input.hp', form).filter(function (f) { return f.value; }).length; }
  function brevoSend(fields, form) {
    var err;
    if (!CFG.waitlistEndpoint) { err = new Error('config'); err.brevo = { error: 'not_configured' }; return Promise.reject(err); }
    if (inFlight || Date.now() - lastSend < 30000) { err = new Error('throttle'); err.throttle = true; return Promise.reject(err); }
    var params = new URLSearchParams();
    Object.keys(fields).forEach(function (k) { params.append(k, fields[k]); });
    params.append('hp', form && honeypotHit(form) ? 'x' : '');
    params.append('t', String(Date.now() - PAGE_T0));
    var tok = turnstileToken(form); if (tok) params.append('cf-turnstile-response', tok);
    if (CFG.turnstileSiteKey && !tok) { err = new Error('captcha'); err.brevo = { error: 'captcha' }; return Promise.reject(err); }
    inFlight = true;
    return fetch(CFG.waitlistEndpoint, { method: 'POST', body: params, headers: { 'Accept': 'application/json' }, credentials: 'omit', mode: 'cors' })
      .then(function (r) { return r.json().catch(function () { return { success: false, error: 'http_' + r.status }; }); })
      .then(function (d) { inFlight = false; turnstileReset(form); if (!d || d.success !== true) { var er = new Error('brevo'); er.brevo = d || {}; throw er; } lastSend = Date.now(); return d; },
        function (e) { inFlight = false; turnstileReset(form); throw e; });
  }
  function sendErrText(er) {
    var c = er && er.brevo && er.brevo.error;
    if (er && er.throttle) return 'Ihre Anmeldung wird bereits verarbeitet bzw. wurde gerade gesendet. Bitte warten Sie einen Moment, bevor Sie es erneut versuchen.';
    if (c === 'too_fast') return 'Das ging etwas zu schnell. Bitte prüfen Sie Ihre Angaben und senden Sie das Formular in ein paar Sekunden erneut.';
    if (c === 'rate_limited') return 'Gerade gehen sehr viele Anmeldungen ein. Bitte versuchen Sie es in einer Minute erneut.';
    if (c === 'captcha') return 'Bitte bestätigen Sie kurz den Spam-Schutz und senden Sie das Formular erneut.';
    return 'Die Anmeldung konnte nicht verarbeitet werden. Bitte prüfen Sie Ihre E-Mail-Adresse oder schreiben Sie uns an ' + esc(CONTACT) + '.';
  }

  /* ---------- Warteliste (Lead-First, getrennte Einwilligungen) ---------- */
  var CONSENT_VERSION = 'warteliste-2026-11-20';
  /* Art.-9-basierte Vorab-Einstufung NUR mit ausdrücklicher Einwilligung (sonst neutraler Basis-Status) */
  function leadQuality(data, art9) {
    if (!art9) return { leadQuality: 'basis', statusFlag: 'Warteliste (Basis)' };
    var oasis = data.oasis_sperre;
    var opt = Object.keys(data).filter(function (k) { return data[k] && k !== 'oasis_sperre'; }).length;
    if (oasis) return { leadQuality: 'stark', statusFlag: 'vollständig' };
    return opt ? { leadQuality: 'schwach', statusFlag: 'Daten fehlen' } : { leadQuality: 'schwach', statusFlag: 'kontaktieren' };
  }
  function collectQ(form) {
    var out = {};
    $$('[data-gmr-q]', form).forEach(function (f) {
      if (f.matches(':disabled')) return; // gesperrte (Art.-9-)Felder werden nie erfasst
      var k = f.getAttribute('data-gmr-q');
      if (f.type === 'radio') { if (f.checked) out[k] = f.value; }
      else if (f.type === 'checkbox') { if (f.checked) out[k] = (out[k] ? out[k] + ', ' : '') + f.value; }
      else { var v = (f.value || '').trim(); if (v) out[k] = v; }
    });
    return out;
  }
  function refId() {
    var d = new Date(), p = function (n) { return ('0' + n).slice(-2); };
    return 'GMR-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + b32enc(rnd(5)).slice(0, 6);
  }
  var LABELS = { oasis_sperre: 'OASIS-Spielersperre', gespielt_trotz_sperre: 'Während aktiver Sperre weitergespielt', oasis_notiz: 'Notiz zur Sperre', telefon: 'Telefon', kontaktweg: 'Bevorzugter Kontaktweg', wohnsitz_de: 'Wohnsitz in Deutschland im Spielzeitraum', bundesland: 'Bundesland', spielart: 'Glücksspiel-Art', anbieter: 'Anbieter', lizenzsitz: 'Lizenzsitz (falls bekannt)', zeitraum_von: 'Spielzeitraum von', zeitraum_bis: 'Spielzeitraum bis', verlust: 'Geschätzter Netto-Verlust', einzahlung_1000: 'Einzahlungen > 1.000 €/Monat bei einem Anbieter', rechtsschutz: 'Rechtsschutzversicherung', insolvenz: 'Insolvenzverfahren', anwalt: 'Bereits Anwalt/Prozessfinanzierer beauftragt', belege: 'Belege/Kontoauszüge', notiz: 'Weitere Hinweise' };
  /* Nur für die lokale Anzeige im eigenen Browser */
  function summaryLines(rec) {
    var l = [];
    if (rec.refId) l.push('Referenz-ID: ' + rec.refId);
    l.push('Name: ' + rec.name, 'E-Mail: ' + rec.email);
    l.push('Status: ' + (rec.consentArt9 ? 'Vorab-Einstufung ' + rec.leadQuality + ' (' + rec.statusFlag + ')' : (rec.statusFlag || 'Warteliste (Basis)')));
    if (rec.consentVersion) l.push('Einwilligungen: Warteliste ja · Updates ' + (rec.consentUpdates ? 'ja' : 'nein') + ' · Art. 9 ' + (rec.consentArt9 ? 'ja' : 'nein') + ' (' + rec.consentVersion + ')');
    Object.keys(rec.answers || {}).forEach(function (k) { l.push((LABELS[k] || k) + ': ' + rec.answers[k]); });
    return l;
  }
  /* E-Mail-Text: niemals Art.-9-Angaben oder Einstufung – nur Referenz-ID und Vorname */
  function waitlistMailBody(rec) {
    var first = String(rec.name || '').trim().split(/\s+/)[0] || '';
    return 'Hallo GetMyRight-Team,\n\nich habe mich für die Warteliste eingetragen.\n\nReferenz-ID: ' + rec.refId + '\nVorname: ' + first +
      '\n\nMeine optionalen Detailangaben bleiben verschlüsselt lokal in meinem Browser gespeichert, bis ein EU-Backend bzw. ein sicherer Upload verfügbar ist.\n\nViele Grüße\n' + first;
  }
  function initWaitlist() {
    $$('form[data-gmr-waitlist]').forEach(function (form) {
      var st = $('[data-gmr-status]', form.parentNode);
      var result = $('[data-gmr-result]', form.parentNode);
      var follow = $('[data-gmr-oasis-follow]', form);
      var art9 = form.elements.optin_art9, notice = $('[data-gmr-art9-notice]', form);
      function clearFs(fs) { $$('input, select, textarea', fs).forEach(function (f) { if (f.type === 'radio' || f.type === 'checkbox') f.checked = false; else f.value = ''; }); }
      function syncArt9() {
        var on = !!(art9 && art9.checked);
        $$('fieldset[data-gmr-art9]', form).forEach(function (fs) { fs.disabled = !on; if (!on) { clearFs(fs); fs.classList.remove('skipped'); } });
        if (!on && follow) follow.hidden = true;
        if (notice) {
          notice.className = 'note small ' + (on ? 'ok' : 'warn');
          notice.innerHTML = on ? '<strong>Sensible Fragen freigeschaltet.</strong> Die Abschnitte 3, 7, 8 und 9 sind jetzt ausfüllbar – weiterhin freiwillig und überspringbar. Wenn Sie den Haken wieder entfernen, werden Ihre Eingaben dort gelöscht.'
            : '<strong>Sensible Fragen gesperrt:</strong> Die Fragen zu OASIS-Sperre, Verlusten, Insolvenz und Belegen (Abschnitte 3, 7, 8 und 9) werden erst freigeschaltet, wenn Sie oben die freiwillige Einwilligung für sensible Angaben (Art. 9 DSGVO) erteilen. Für die Warteliste ist das nicht nötig.';
        }
      }
      if (art9) art9.addEventListener('change', syncArt9);
      syncArt9();
      $$('input[name="oasis"]', form).forEach(function (r) { r.addEventListener('change', function () { if (follow) follow.hidden = r.value !== 'Ja' || !r.checked; }); });
      $$('[data-gmr-skip]', form).forEach(function (b) {
        b.addEventListener('click', function () {
          var fs = b.closest('fieldset');
          clearFs(fs);
          fs.classList.add('skipped'); b.textContent = 'Übersprungen ✓';
          var nx = fs.nextElementSibling; if (nx && nx.scrollIntoView) nx.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var el = form.elements;
        if (honeypotHit(form)) { status(st, 'ok', 'Danke! Bitte bestätigen Sie den Link in der E-Mail.'); return; } // Honeypot: Bot still abweisen
        if (tooFast()) { status(st, 'err', 'Das ging etwas zu schnell. Bitte prüfen Sie Ihre Angaben und senden Sie das Formular in ein paar Sekunden erneut.'); return; }
        if (inFlight) return; // Doppel-Absenden verhindern
        var b = [invalid(el.FIRSTNAME, !el.FIRSTNAME.value.trim()), invalid(el.EMAIL, !EMAIL_RE.test(el.EMAIL.value.trim())), invalid(el.OPT_IN, !el.OPT_IN.checked)];
        if (b.indexOf(true) >= 0) { status(st, 'err', 'Bitte geben Sie Ihren Namen und eine gültige E-Mail-Adresse an und setzen Sie den Haken für die Warteliste. Alle weiteren Angaben und Einwilligungen sind freiwillig.'); el[b[0] ? 'FIRSTNAME' : b[1] ? 'EMAIL' : 'OPT_IN'].focus(); return; }
        var now = new Date().toISOString();
        var art9On = !!(el.optin_art9 && el.optin_art9.checked), updOn = !!(el.optin_updates && el.optin_updates.checked);
        var answers = collectQ(form);
        var q = leadQuality(answers, art9On);
        var rec = { type: 'warteliste', refId: refId(), name: el.FIRSTNAME.value.trim(), email: el.EMAIL.value.trim(), answers: answers, leadQuality: q.leadQuality, statusFlag: q.statusFlag,
          consentVersion: CONSENT_VERSION, consentWaitlistAt: now, consentUpdates: updOn, consentUpdatesAt: updOn ? now : null, consentArt9: art9On, consentArt9At: art9On ? now : null };
        var btn = $('button[type=submit]', form); btn.disabled = true; btn.textContent = 'Wird sicher übermittelt …';
        var pass = el.passphrase ? el.passphrase.value : '';
        var sendErr = null;
        var brevoP = brevoSend({ EMAIL: rec.email, FIRSTNAME: rec.name, OPT_IN: '1' }, form).then(function () { return 'ok'; }).catch(function (er) { sendErr = er; return er && (er.brevo || er.throttle) ? 'rejected' : 'network'; });
        var saveP = hasCrypto() ? encryptJSON(rec, pass).then(function (c) { var list = store('gmr_waitlist_records') || []; list.push(c); store('gmr_waitlist_records', list); return c; }).catch(function () { return null; }) : Promise.resolve(null);
        Promise.all([brevoP, saveP]).then(function (r) {
          var brevo = r[0], saved = r[1];
          if (brevo === 'rejected') {
            btn.disabled = false; btn.textContent = 'Kostenlos auf die Warteliste';
            status(st, 'err', sendErrText(sendErr));
            return;
          }
          var badge = !rec.consentArt9 ? '<span class="badge ok">Warteliste (Basis)</span>' : rec.leadQuality === 'stark' ? '<span class="badge ok">Angaben vollständig</span>' : rec.statusFlag === 'Daten fehlen' ? '<span class="badge warn">Daten fehlen – gerne ergänzen</span>' : '<span class="badge warn">Wir melden uns per E-Mail</span>';
          var rows = summaryLines(rec).map(function (x) { var i = x.indexOf(': '); return '<tr><th>' + esc(x.slice(0, i)) + '</th><td>' + esc(x.slice(i + 2)) + '</td></tr>'; }).join('');
          status(st, brevo === 'ok' ? 'ok' : 'warn', brevo === 'ok'
            ? '<strong>Danke, ' + esc(rec.name) + ' – fast geschafft!</strong> Name und E-Mail wurden verschlüsselt per HTTPS an Brevo übermittelt. Bitte bestätigen Sie den Link in der E-Mail (Double-Opt-in), erst dann sind Sie auf der Warteliste.'
            : '<strong>Brevo ist gerade nicht erreichbar.</strong> Ihre Angaben sind lokal verschlüsselt gesichert. Sie können uns optional eine Kurzmitteilung mit Ihrer Referenz-ID senden – so geht Ihre Anfrage nicht verloren.');
          result.hidden = false;
          $('[data-gmr-result-badge]', result).innerHTML = badge;
          $('[data-gmr-result-table]', result).innerHTML = rows;
          var ack = $('[data-gmr-mail-ack]', result), m = $('[data-gmr-result-mailto]', result), body = waitlistMailBody(rec);
          ack.checked = false;
          gateMailto(ack, m, function () { return mailto('Warteliste – Referenz ' + rec.refId, body); });
          $('[data-gmr-result-saved]', result).textContent = saved ? 'Lokal gespeichert: AES-GCM 256 Bit (' + (saved.mode === 'passphrase-pbkdf2' ? 'mit Ihrer Passphrase' : 'gerätegebundener, nicht exportierbarer Schlüssel') + '), ' + new Date(saved.savedAt).toLocaleString('de-DE') + '.' : 'Lokale Verschlüsselung in diesem Browser nicht verfügbar – es wurde nichts lokal gespeichert.';
          form.dataset.lead = JSON.stringify({ leadQuality: rec.leadQuality, statusFlag: rec.statusFlag });
          $$('input, select, textarea, button', form).forEach(function (f) { f.disabled = true; });
          btn.textContent = 'Eingetragen';
          result.scrollIntoView && result.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
    });
    // Lokale Kopie verwalten
    $$('[data-gmr-local]').forEach(function (wrap) {
      var out = $('[data-gmr-local-out]', wrap);
      function list() { return store('gmr_waitlist_records') || []; }
      $('[data-gmr-local-show]', wrap).addEventListener('click', function () {
        var l = list(); if (!l.length) { status(out, '', 'Auf diesem Gerät sind keine lokal verschlüsselten Angaben gespeichert.'); return; }
        var last = l[l.length - 1], pass = '';
        if (last.mode === 'passphrase-pbkdf2') { pass = window.prompt('Passphrase zum Entschlüsseln:') || ''; }
        decryptJSON(last, pass).then(function (d) { status(out, 'ok', '<strong>Entschlüsselt (nur in diesem Browser):</strong><pre style="white-space:pre-wrap;margin:8px 0 0">' + esc(summaryLines(d).join('\n')) + '</pre>'); })
          .catch(function () { status(out, 'err', 'Entschlüsselung fehlgeschlagen (falsche Passphrase oder anderer Browser/anderes Gerät).'); });
      });
      $('[data-gmr-local-export]', wrap).addEventListener('click', function () {
        var blob = new Blob([JSON.stringify(list(), null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = url; a.download = 'getmyright-angaben-verschluesselt.json'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        status(out, '', 'Export erstellt (verschlüsselt, ' + list().length + ' Eintrag/Einträge).');
      });
      $('[data-gmr-local-delete]', wrap).addEventListener('click', function () { store('gmr_waitlist_records', null); status(out, 'ok', 'Alle lokal gespeicherten Angaben wurden von diesem Gerät gelöscht. Alle übrigen lokalen Daten löschen Sie in der <a href="/datenschutz.html#d17">Datenschutzerklärung</a>.'); });
    });
  }

  /* ---------- Kopieren ---------- */
  function initCopy() {
    $$('[data-gmr-copy]').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = b.getAttribute('data-gmr-copy'), orig = b.textContent;
        var ok = function () { b.textContent = 'Kopiert ✓'; setTimeout(function () { b.textContent = orig; }, 1600); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, function () { b.textContent = t; });
        else b.textContent = t;
      });
    });
  }

  /* ---------- Upload (Kanal 2) – KEINE automatische Schwärzung ---------- */
  var ALLOWED = ['zip', 'csv', 'pdf', 'xlsx', 'xls', 'json', 'txt', 'png', 'jpg', 'jpeg'];
  var TEXT_EXT = ['csv', 'txt', 'json'];
  var MAX_PICK_ROWS = 2000;
  function extOf(f) { return (f.name.split('.').pop() || '').toLowerCase(); }
  function isText(f) { return TEXT_EXT.indexOf(extOf(f)) >= 0; }
  function fmtMb(b) { return (b / 1048576).toFixed(b < 10485760 ? 2 : 1).replace('.', ',') + ' MB'; }
  /* Blob-URLs erzeugter Vorschau-Kopien verwalten und freigeben */
  var blobUrls = [];
  function trackUrl(u) { blobUrls.push(u); return u; }
  function revokeUrl(u) { if (!u) return; try { URL.revokeObjectURL(u); } catch (e) { /* ignorieren */ } blobUrls = blobUrls.filter(function (x) { return x !== u; }); }
  function revokeAll() { blobUrls.slice().forEach(revokeUrl); }
  window.addEventListener('pagehide', revokeAll);
  window.GMRDebug = { blobCount: function () { return blobUrls.length; } };

  /* Optionale Selbstschwärzung: Spieler wählt selbst private Zeilen ohne Glücksspielbezug */
  function renderPicker(box, label, text, onResult) {
    var SR = window.GMRSelfRedact;
    if (!SR) { box.innerHTML = '<p class="note warn small">Das Selbstschwärzungs-Werkzeug ist nicht verfügbar.</p>'; return; }
    var rows = SR.rows(text), shown = rows.filter(function (r) { return !r.empty; }).slice(0, MAX_PICK_ROWS);
    var trs = shown.map(function (r) {
      var lock = r.gambling || r.header;
      var badge = r.gambling ? '<span class="badge ok">Glücksspielbezug – bleibt im Klartext</span>' : r.header ? '<span class="badge">Kopfzeile</span>' : '';
      return '<tr' + (r.gambling ? ' data-gmr-gambling-row' : '') + '><td><input type="checkbox" data-row="' + r.index + '"' + (lock ? ' disabled' : '') + ' aria-label="Zeile ' + (r.index + 1) + ' selbst schwärzen"></td><td><code style="white-space:pre-wrap;word-break:break-word">' + esc(r.text) + '</code></td><td>' + badge + '</td></tr>';
    }).join('');
    box.innerHTML = '<div class="card" style="margin-top:12px" data-gmr-picker><h4 style="margin-top:0">' + esc(label) + '</h4>' +
      '<p class="small">Optional: Markieren Sie nur private Buchungen ohne Glücksspielbezug (z. B. Alltagseinkäufe, Bestellungen). Ein- und Auszahlungen zum bzw. vom Casino oder Wettanbieter sind gesperrt und bleiben lesbar.' + (rows.length > shown.length ? ' Angezeigt werden die ersten ' + MAX_PICK_ROWS + ' Zeilen.' : '') + '</p>' +
      '<div class="table-wrap" style="max-height:340px;overflow:auto"><table><thead><tr><th>Schwärzen</th><th>Zeile</th><th>Hinweis</th></tr></thead><tbody>' + trs + '</tbody></table></div>' +
      '<div class="btn-row"><button type="button" class="btn ghost" data-gmr-apply>Kopie mit meinen Schwärzungen erstellen</button></div><div class="status" data-gmr-picker-out style="margin-top:10px"></div></div>';
    var out = $('[data-gmr-picker-out]', box);
    $('[data-gmr-apply]', box).addEventListener('click', function () {
      var idx = $$('input[data-row]:checked', box).map(function (c) { return +c.getAttribute('data-row'); });
      if (!idx.length) { status(out, 'warn', 'Keine Zeile ausgewählt – die Datei bleibt unverändert. Die Selbstschwärzung ist freiwillig.'); return; }
      var res = SR.apply(text, idx);
      onResult(res, out);
    });
  }

  function initUpload() {
    var form = $('form[data-gmr-upload]'); if (!form) return;
    var max = (CFG.maxUploadMb || 250) * 1048576;
    var input = form.elements.files, list = $('[data-gmr-file-list]', form.parentNode), st = $('[data-gmr-status]', form.parentNode), bar = $('[data-gmr-progress]', form.parentNode), banner = $('[data-gmr-upload-mode]');
    var report = $('[data-gmr-redact-report]', form.parentNode);
    if (banner) status(banner, CFG.uploadEndpoint ? 'ok' : 'warn', CFG.uploadEndpoint ? '<strong>Upload aktiv.</strong> Dateien werden verschlüsselt per HTTPS an unseren Upload-Dienst übertragen.' :
      '<strong>Hinweis zum Upload-Kanal:</strong> Der Server für große Dateien wird gerade angebunden. Diese Seite prüft Dateityp und Größe bereits lokal, <strong>überträgt aber noch keine Datei an einen Server</strong>. Kleinere Dateien können Sie nach der Prüfung und Bestätigung der Hinweise per E-Mail senden (Kanal 1).');
    function check() {
      var files = Array.prototype.slice.call(input.files || []), rows = [], ok = [], bad = 0;
      files.forEach(function (f) {
        var ext = extOf(f), err = '';
        if (ALLOWED.indexOf(ext) < 0) err = 'Dateityp .' + ext + ' nicht erlaubt';
        else if (f.size > max) err = 'größer als ' + (CFG.maxUploadMb || 250) + ' MB';
        else if (f.size === 0) err = 'Datei ist leer';
        if (err) bad++; else ok.push(f);
        rows.push('<tr><td>' + esc(f.name) + '</td><td>' + fmtMb(f.size) + '</td><td>' + (err ? '<span class="badge err">' + esc(err) + '</span>' : '<span class="badge ok">geprüft</span>') + '</td></tr>');
      });
      list.innerHTML = rows.length ? '<div class="table-wrap"><table><thead><tr><th>Datei</th><th>Größe</th><th>Prüfung</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' : '';
      return { ok: ok, bad: bad, all: files.length };
    }
    input.addEventListener('change', function () { revokeAll(); if (report) report.innerHTML = ''; check(); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var r = check(), el = form.elements;
      var b1 = invalid(el.email, !EMAIL_RE.test(el.email.value.trim())), b2 = invalid(el.consent, !el.consent.checked), b3 = invalid(el.plaintext_ack, !el.plaintext_ack.checked), b4 = invalid(input, !r.all);
      if (b1 || b2 || b3 || b4) { status(st, 'err', 'Bitte wählen Sie mindestens eine Datei, geben Sie Ihre E-Mail-Adresse an, erteilen Sie die Einwilligung und bestätigen Sie, dass casino-relevante Buchungen lesbar sind.'); return; }
      if (r.bad) { status(st, 'err', r.bad + ' Datei(en) erfüllen die Vorgaben nicht (erlaubt: ' + ALLOWED.join(', ').toUpperCase() + ', max. ' + (CFG.maxUploadMb || 250) + ' MB je Datei). Bitte entfernen oder ersetzen.'); return; }
      revokeAll();
      var texts = r.ok.filter(isText), hasBinary = r.ok.some(function (f) { return !isText(f); });
      // Dateiinhalt wird erst jetzt (nach Einwilligung) und nur bei gewünschter Selbstschwärzung gelesen
      if (report) {
        if (el.selfredact && el.selfredact.checked && texts.length) {
          report.innerHTML = '<h4 style="margin-top:14px">Optionale Selbstschwärzung</h4><div data-gmr-pickers></div>';
          var holder = $('[data-gmr-pickers]', report);
          texts.forEach(function (f) {
            var box = document.createElement('div'); holder.appendChild(box);
            f.text().then(function (txt) {
              var url = null;
              renderPicker(box, f.name, txt, function (res, out) {
                revokeUrl(url);
                var nf = new File([res.text], f.name.replace(/(\.[^.]+)$/, '_selbstgeschwaerzt$1'), { type: f.type || 'text/plain' });
                url = trackUrl(URL.createObjectURL(nf));
                status(out, 'ok', '<strong>' + res.redacted + ' private Zeile(n) von Ihnen geschwärzt.</strong> Glücksspielzeilen und die Originaldatei bleiben unverändert. <a href="' + url + '" download="' + esc(nf.name) + '" data-gmr-redacted>Selbst geschwärzte Kopie herunterladen</a>');
              });
            });
          });
        } else {
          report.innerHTML = '<p class="small" style="margin-top:12px" data-gmr-no-redaction>Keine Schwärzung: Ihre Dateien bleiben unverändert. GetMyRight schwärzt nichts automatisch.</p>';
        }
      }
      bar.hidden = false; bar.value = 0;
      if (!CFG.uploadEndpoint) {
        var i = 0, n = r.ok.length;
        (function next() {
          if (i >= n) {
            status(st, 'warn', '<strong>' + n + ' Datei(en) lokal geprüft – es wurde nichts an einen Server übertragen.</strong> Der Upload-Server ist noch nicht freigeschaltet; große Dateien bitte aufbewahren, wir melden uns, sobald der Upload aktiv ist.' +
              '<div class="card cream" style="margin-top:12px" data-gmr-mail-section><h4 style="margin-top:0">Kanal 1: kleinere Dateien per E-Mail (optional)</h4><p class="small">Hängen Sie die Dateien selbst an die vorbereitete E-Mail an. Casino-relevante Buchungen müssen lesbar bleiben; private Buchungen ohne Glücksspielbezug dürfen Sie vorher selbst schwärzen.' + (hasBinary ? ' <strong>PDF-, Bild-, XLSX- und ZIP-Dateien wurden nicht geschwärzt.</strong>' : '') + '</p>' +
              '<label class="choice"><input type="checkbox" data-gmr-mail-ack> <span>' + (hasBinary ? 'Mir ist bekannt, dass PDF/Bild-Dateien nicht automatisch geschwärzt wurden und E-Mails unverschlüsselt über Spacemail (USA) laufen' : 'Mir ist bekannt, dass meine Dateien nicht automatisch geschwärzt werden und E-Mails unverschlüsselt über Spacemail (USA) laufen') + ' – über meinen E-Mail-Anbieter an ' + esc(CONTACT) + ', gespeichert im Postfach der Spaceship Inc. Die Unterlagen können Angaben zu meinem Spielverhalten enthalten (Art. 9 DSGVO).</span></label>' +
              '<div class="btn-row"><a class="btn" data-gmr-upload-mailto hidden>E-Mail an ' + esc(CONTACT) + ' vorbereiten</a></div></div>');
            var email = el.email.value.trim();
            gateMailto($('[data-gmr-mail-ack]', st), $('[data-gmr-upload-mailto]', st), function () {
              return mailto('Unterlagen für GetMyRight', 'Hallo GetMyRight-Team,\n\nanbei ' + n + ' Datei(en) als Unterlagen zu meiner Wartelisten-Anmeldung.\nE-Mail der Anmeldung: ' + email + '\n\nCasino-relevante Buchungen (Ein- und Auszahlungen, Datum, Betrag, Zahlungsdienstleister/Empfänger) sind ungeschwärzt lesbar.\n\nViele Grüße');
            });
            return;
          }
          i++; bar.value = Math.round(i / n * 100); setTimeout(next, 120);
        })();
        return;
      }
      var fd = new FormData(); fd.append('email', el.email.value.trim()); fd.append('note', el.note ? el.note.value : '');
      r.ok.forEach(function (f) { fd.append('files', f, f.name); });
      var xhr = new XMLHttpRequest(); xhr.open('POST', CFG.uploadEndpoint);
      xhr.upload.onprogress = function (ev) { if (ev.lengthComputable) bar.value = Math.round(ev.loaded / ev.total * 100); };
      xhr.onload = function () { if (xhr.status >= 200 && xhr.status < 300) status(st, 'ok', 'Upload abgeschlossen. Vielen Dank – Ihre Dateien sind sicher bei uns eingegangen.'); else status(st, 'err', 'Upload fehlgeschlagen (Status ' + xhr.status + '). Bitte erneut versuchen.'); };
      xhr.onerror = function () { status(st, 'err', 'Verbindung zum Upload-Dienst fehlgeschlagen. Bitte erneut versuchen.'); };
      xhr.send(fd);
    });
  }
  /* Portal: optionale Selbstschwärzung für eingefügten Text */
  function initRedactTool() {
    $$('[data-gmr-redact-tool]').forEach(function (w) {
      var ta = $('textarea', w), out = $('[data-gmr-redact-out]', w), picker = $('[data-gmr-row-picker]', w);
      $('[data-gmr-redact-run]', w).addEventListener('click', function () {
        if (!ta.value.trim()) { status(out, 'err', 'Bitte fügen Sie zuerst einen Text ein, z. B. Zeilen aus einem CSV-Umsatzexport.'); return; }
        out.hidden = true;
        renderPicker(picker, 'Zeilen auswählen', ta.value, function (res) {
          status(out, 'ok', '<strong>' + res.redacted + ' private Zeile(n) von Ihnen geschwärzt</strong> – Zeilen mit Glücksspielbezug bleiben im Klartext.<pre style="white-space:pre-wrap;margin:8px 0 0" data-gmr-redact-result>' + esc(res.text) + '</pre>');
        });
      });
    });
  }

  /* ---------- Alle lokalen Browser-Daten löschen (§ 25 TDDDG / Art. 17 DSGVO) ---------- */
  function initWipe() {
    $$('[data-gmr-wipe-local]').forEach(function (btn) {
      var out = $('[data-gmr-wipe-status]');
      btn.addEventListener('click', function () {
        var n = 0;
        try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('gmr_') === 0 || k.indexOf('gmr-') === 0) { localStorage.removeItem(k); n++; } }); } catch (e) { /* ignorieren */ }
        try { Object.keys(sessionStorage).forEach(function (k) { if (k.indexOf('gmr') === 0) { sessionStorage.removeItem(k); n++; } }); } catch (e) { /* ignorieren */ }
        openDbs.forEach(function (d) { try { d.close(); } catch (e) { /* ignorieren */ } }); openDbs = []; deviceKeyP = null;
        function done(ok) { status(out, ok ? 'ok' : 'warn', ok ? '<strong>Erledigt.</strong> ' + n + ' lokale Einträge (localStorage/sessionStorage) sowie die IndexedDB-Datenbank „gmr-secure“ mit dem Geräteschlüssel wurden von diesem Gerät gelöscht.' : 'Die lokalen Einträge wurden gelöscht; die IndexedDB „gmr-secure“ konnte nicht entfernt werden. Bitte löschen Sie die Websitedaten in Ihren Browser-Einstellungen.'); }
        if (!window.indexedDB) return done(true);
        var rq = indexedDB.deleteDatabase('gmr-secure');
        rq.onsuccess = function () { done(true); };
        rq.onerror = function () { done(false); };
        rq.onblocked = function () { status(out, 'warn', 'Lokale Einträge gelöscht. Der Geräteschlüssel wird entfernt, sobald andere geöffnete GetMyRight-Tabs geschlossen sind.'); };
      });
    });
  }
  /* Formulare erst mit JavaScript freischalten (Art.-9-Fieldsets bleiben einwilligungsgebunden) */
  function initJsOnly() { $$('fieldset[data-gmr-js-only]').forEach(function (fs) { fs.disabled = false; }); }

  /* ---------- Kanzlei-Dashboard: Filter & Reservierung (Claim) ---------- */
  function initDashboard() {
    var table = $('[data-gmr-cases]'); if (!table) return;
    var q = $('[data-gmr-filter-q]'), fs = $('[data-gmr-filter-status]'), fl = $('[data-gmr-filter-lic]'), count = $('[data-gmr-count]'), claimsBox = $('[data-gmr-claims]');
    var s = sess(), firm = s && s.role === 'kanzlei' ? (s.name || s.email) : 'Ihre Kanzlei (Vorschau)';
    function claims() { return store('gmr_claims') || {}; }
    function render() {
      var c = claims(), term = (q.value || '').toLowerCase().trim(), n = 0;
      $$('tbody tr', table).forEach(function (tr) {
        var id = tr.getAttribute('data-id');
        var show = (!term || tr.textContent.toLowerCase().indexOf(term) >= 0) && (!fs.value || tr.getAttribute('data-status') === fs.value) && (!fl.value || tr.getAttribute('data-lic') === fl.value);
        tr.hidden = !show; if (show) n++;
        var cell = $('[data-claim-cell]', tr);
        cell.innerHTML = c[id] ? '<span class="badge ok">Reserviert</span> <button type="button" class="btn ghost" style="padding:5px 10px;font-size:.82rem" data-release="' + id + '">Freigeben</button>'
          : '<button type="button" class="btn" style="padding:6px 12px;font-size:.85rem" data-claim="' + id + '">Reservieren</button>';
      });
      count.textContent = n;
      var ids = Object.keys(c);
      claimsBox.innerHTML = ids.length ? '<ul class="clean">' + ids.map(function (id) { return '<li>' + esc(id) + ' – reserviert am ' + esc(new Date(c[id].at).toLocaleString('de-DE')) + ' für ' + esc(c[id].firm) + '</li>'; }).join('') + '</ul>' : '<p class="small">Noch keine Datensätze reserviert.</p>';
    }
    table.addEventListener('click', function (e) {
      var t = e.target, c = claims();
      if (t.getAttribute('data-claim')) { c[t.getAttribute('data-claim')] = { at: Date.now(), firm: firm }; store('gmr_claims', c); render(); }
      if (t.getAttribute('data-release')) { delete c[t.getAttribute('data-release')]; store('gmr_claims', c); render(); }
    });
    [q, fs, fl].forEach(function (x) { x.addEventListener('input', render); x.addEventListener('change', render); });
    render();
  }

  document.addEventListener('DOMContentLoaded', function () {
    initJsOnly(); $$('form').forEach(initTurnstile); initNav(); initGoogle(); initMagic(); initRegister(); initLogin(); initSession(); initWaitlist(); initCopy(); initUpload(); initDashboard(); initRedactTool(); initWipe();
  });
})();
