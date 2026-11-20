/* GetMyRight – Frontend-Logik (statische Website, kein eigener Server)
 * - Warteliste: EMAIL, FIRSTNAME, OPT_IN gehen per HTTPS an Brevo (Double-Opt-in).
 *   Optionale Fragebogen-Angaben werden mit AES-GCM (256 Bit, Web Crypto API) lokal im Browser
 *   verschlüsselt gespeichert und nur per E-Mail-Button aktiv an das Team gesendet.
 * - Login/Registrierung/2FA: Vorschau-Konten lokal auf diesem Gerät (PBKDF2-Hash, TOTP-Prüfung im Browser).
 * - Google-Login: nur aktiv, wenn in /js/gmr-config.js eine Client-ID hinterlegt ist.
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
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('gmr-secure', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('keys'); };
      r.onsuccess = function () { res(r.result); };
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
  function accKey(role, email) { return 'gmr_acc_' + role + '_' + email.toLowerCase(); }

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
            store(accKey(role, email), acc);
            var html = '<strong>Vorschau-Konto angelegt.</strong> Sie können sich jetzt auf diesem Gerät anmelden.' + (acc.twofa.method !== 'none' ? ' Zwei-Faktor-Bestätigung ist aktiv (' + (acc.twofa.method === 'app' ? 'Authenticator-App' : 'SMS') + ').' : '') +
              ' <a href="' + (role === 'betreiber' ? '/admin.html' : 'login.html') + '">Zur Anmeldung</a>';
            if (role === 'kanzlei') {
              var lines = Object.keys(extras).map(function (k) { return k + ': ' + extras[k]; });
              lines.unshift('E-Mail: ' + email);
              var body = 'Hallo GetMyRight-Team,\n\nwir möchten uns als Partnerkanzlei für den Software-Zugang vormerken lassen:\n\n' + lines.join('\n') + '\n2FA-Wunsch: ' + method + '\n\nViele Grüße';
              encryptJSON({ type: 'kanzlei-vormerkung', email: email, data: extras, twofa: method }).then(function (rec) {
                var list = store('gmr_kanzlei_vormerkungen') || []; list.push(rec); store('gmr_kanzlei_vormerkungen', list);
              }).catch(function (er) { if (window.console) console.warn('Lokale Verschlüsselung nicht möglich', er && er.name); });
              html += '<br><br><strong>Vormerkung übermitteln:</strong> Ihre Angaben wurden AES-GCM-verschlüsselt lokal gespeichert. An unser Team gelangen sie erst, wenn Sie die vorbereitete E-Mail senden. <div class="btn-row"><a class="btn accent" data-gmr-mailto href="' + esc(mailto('Kanzlei-Vormerkung GetMyRight', body)) + '">Vormerkung per E-Mail senden</a></div>';
            }
            if (role === 'spieler' && el.brevo && el.brevo.checked) {
              brevoSend({ EMAIL: email, FIRSTNAME: acc.name, OPT_IN: '1' }).then(function () {
                status($('[data-gmr-brevo-status]', form.parentNode), 'ok', 'Zusätzlich für Start-Informationen eingetragen – bitte bestätigen Sie die E-Mail von Brevo (Double-Opt-in).');
              }).catch(function () {
                status($('[data-gmr-brevo-status]', form.parentNode), 'warn', 'Die Eintragung für Start-Informationen ist gerade nicht erreichbar. Sie können sich jederzeit über die Warteliste eintragen.');
              });
            }
            status(st, 'ok', html);
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
        var acc = store(accKey(role, email.value.trim()));
        if (!acc) { status(st, 'warn', 'Für diese E-Mail-Adresse gibt es auf diesem Gerät noch kein Vorschau-Konto. ' + (role === 'betreiber' ? 'Legen Sie unten ein Vorschau-Konto an.' : '<a href="registrierung.html">Jetzt registrieren</a>')); return; }
        hashPw(pw.value, acc.salt).then(function (h) {
          if (h.hash !== acc.hash) { invalid(pw, true); status(st, 'err', 'E-Mail-Adresse oder Passwort ist nicht korrekt.'); return; }
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
      });
    });
  }

  /* ---------- Sitzung, Abmelden, 2FA-Einstellungen ---------- */
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
      var toggle = $('[data-gmr-2fa-toggle]', wrap), sel = $('[data-gmr-2fa-method]', wrap), st = $('[data-gmr-2fa-state]', wrap), panel = $('[data-gmr-2fa-setup]', wrap);
      var acc = s && s.role === role && s.email ? store(accKey(role, s.email)) : null;
      var cur = acc ? acc.twofa : (store('gmr_2fa_pref_' + role) || { method: 'none' });
      function show() { st.innerHTML = cur.method === 'none' ? '<span class="badge warn">2FA aus</span>' : '<span class="badge ok">2FA aktiv · ' + (cur.method === 'app' ? 'Authenticator-App' : 'SMS') + '</span>'; toggle.checked = cur.method !== 'none'; }
      function persist() { if (acc) { acc.twofa = cur; store(accKey(role, acc.email), acc); } else store('gmr_2fa_pref_' + role, cur); show(); }
      show();
      toggle.addEventListener('change', function () {
        if (!toggle.checked) { cur = { method: 'none' }; panel.hidden = true; persist(); return; }
        setup2fa(panel, sel.value, sel.value === 'sms' ? 'Ihre hinterlegte Nummer' : '', acc ? acc.email : 'vorschau@' + role, function (tf) { cur = tf; persist(); });
      });
    });
  }

  /* ---------- Brevo ---------- */
  function brevoSend(fields) {
    var params = new URLSearchParams();
    Object.keys(fields).forEach(function (k) { params.append(k, fields[k]); });
    params.append('email_address_check', ''); params.append('locale', 'de'); params.append('html_type', 'simple');
    return fetch(CFG.brevoAction, { method: 'POST', body: params, headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json().catch(function () { return { success: r.ok }; }); })
      .then(function (d) { if (!d || d.success !== true) { var er = new Error('brevo'); er.brevo = d; throw er; } return d; });
  }

  /* ---------- Warteliste (Lead-First) ---------- */
  function leadQuality(data) {
    var oasis = data.oasis_sperre;
    var opt = Object.keys(data).filter(function (k) { return data[k] && k !== 'oasis_sperre'; }).length;
    if (oasis) return { leadQuality: 'stark', statusFlag: 'vollständig' };
    return opt ? { leadQuality: 'schwach', statusFlag: 'Daten fehlen' } : { leadQuality: 'schwach', statusFlag: 'kontaktieren' };
  }
  function collectQ(form) {
    var out = {};
    $$('[data-gmr-q]', form).forEach(function (f) {
      var k = f.getAttribute('data-gmr-q');
      if (f.type === 'radio') { if (f.checked) out[k] = f.value; }
      else if (f.type === 'checkbox') { if (f.checked) out[k] = (out[k] ? out[k] + ', ' : '') + f.value; }
      else { var v = (f.value || '').trim(); if (v) out[k] = v; }
    });
    return out;
  }
  var LABELS = { oasis_sperre: 'OASIS-Spielersperre', gespielt_trotz_sperre: 'Während aktiver Sperre weitergespielt', oasis_notiz: 'Notiz zur Sperre', telefon: 'Telefon', kontaktweg: 'Bevorzugter Kontaktweg', wohnsitz_de: 'Wohnsitz in Deutschland im Spielzeitraum', bundesland: 'Bundesland', spielart: 'Glücksspiel-Art', anbieter: 'Anbieter', lizenzsitz: 'Lizenzsitz (falls bekannt)', zeitraum_von: 'Spielzeitraum von', zeitraum_bis: 'Spielzeitraum bis', verlust: 'Geschätzter Netto-Verlust', einzahlung_1000: 'Einzahlungen > 1.000 €/Monat bei einem Anbieter', rechtsschutz: 'Rechtsschutzversicherung', insolvenz: 'Insolvenzverfahren', anwalt: 'Bereits Anwalt/Prozessfinanzierer beauftragt', belege: 'Belege/Kontoauszüge', notiz: 'Weitere Hinweise' };
  function summaryLines(rec) {
    var l = ['Name: ' + rec.name, 'E-Mail: ' + rec.email, 'Lead-Einstufung: ' + rec.leadQuality + ' (' + rec.statusFlag + ')'];
    Object.keys(rec.answers).forEach(function (k) { l.push((LABELS[k] || k) + ': ' + rec.answers[k]); });
    return l;
  }
  function initWaitlist() {
    $$('form[data-gmr-waitlist]').forEach(function (form) {
      var st = $('[data-gmr-status]', form.parentNode);
      var result = $('[data-gmr-result]', form.parentNode);
      var follow = $('[data-gmr-oasis-follow]', form);
      $$('input[name="oasis"]', form).forEach(function (r) { r.addEventListener('change', function () { if (follow) follow.hidden = r.value !== 'Ja' || !r.checked; }); });
      $$('[data-gmr-skip]', form).forEach(function (b) {
        b.addEventListener('click', function () {
          var fs = b.closest('fieldset');
          $$('input, select, textarea', fs).forEach(function (f) { if (f.type === 'radio' || f.type === 'checkbox') f.checked = false; else f.value = ''; });
          fs.classList.add('skipped'); b.textContent = 'Übersprungen ✓';
          var nx = fs.nextElementSibling; if (nx && nx.scrollIntoView) nx.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var el = form.elements;
        if (el.email_address_check && el.email_address_check.value) return; // Honeypot
        var b = [invalid(el.FIRSTNAME, !el.FIRSTNAME.value.trim()), invalid(el.EMAIL, !EMAIL_RE.test(el.EMAIL.value.trim())), invalid(el.OPT_IN, !el.OPT_IN.checked)];
        if (b.indexOf(true) >= 0) { status(st, 'err', 'Bitte geben Sie Ihren Namen und eine gültige E-Mail-Adresse an und bestätigen Sie die Einwilligung. Alle weiteren Fragen sind freiwillig.'); el[b[0] ? 'FIRSTNAME' : b[1] ? 'EMAIL' : 'OPT_IN'].focus(); return; }
        var answers = collectQ(form);
        var q = leadQuality(answers);
        var rec = { type: 'warteliste', name: el.FIRSTNAME.value.trim(), email: el.EMAIL.value.trim(), answers: answers, leadQuality: q.leadQuality, statusFlag: q.statusFlag, consent: { opt_in: true, at: new Date().toISOString() } };
        var btn = $('button[type=submit]', form); btn.disabled = true; btn.textContent = 'Wird sicher übermittelt …';
        var pass = el.passphrase ? el.passphrase.value : '';
        var brevoP = brevoSend({ EMAIL: rec.email, FIRSTNAME: rec.name, OPT_IN: '1' }).then(function () { return 'ok'; }).catch(function (er) { return er && er.brevo ? 'rejected' : 'network'; });
        var saveP = hasCrypto() ? encryptJSON(rec, pass).then(function (c) { var list = store('gmr_waitlist_records') || []; list.push(c); store('gmr_waitlist_records', list); return c; }).catch(function () { return null; }) : Promise.resolve(null);
        Promise.all([brevoP, saveP]).then(function (r) {
          var brevo = r[0], saved = r[1];
          if (brevo === 'rejected') {
            btn.disabled = false; btn.textContent = 'Kostenlos auf die Warteliste';
            status(st, 'err', 'Brevo hat die Anmeldung abgelehnt (z. B. ungültige oder bereits eingetragene E-Mail-Adresse). Bitte prüfen Sie Ihre Eingabe oder schreiben Sie an <a href="mailto:' + CONTACT + '">' + CONTACT + '</a>.');
            return;
          }
          var body = 'Hallo GetMyRight-Team,\n\nich habe mich für die Warteliste eingetragen. Hier meine freiwilligen Angaben:\n\n' + summaryLines(rec).join('\n') + '\n\nViele Grüße\n' + rec.name;
          var badge = rec.leadQuality === 'stark' ? '<span class="badge ok">Angaben vollständig</span>' : rec.statusFlag === 'Daten fehlen' ? '<span class="badge warn">Daten fehlen – gerne ergänzen</span>' : '<span class="badge warn">Wir melden uns per E-Mail</span>';
          var rows = summaryLines(rec).map(function (x) { var i = x.indexOf(': '); return '<tr><th>' + esc(x.slice(0, i)) + '</th><td>' + esc(x.slice(i + 2)) + '</td></tr>'; }).join('');
          status(st, brevo === 'ok' ? 'ok' : 'warn', brevo === 'ok'
            ? '<strong>Danke, ' + esc(rec.name) + ' – fast geschafft!</strong> Name und E-Mail wurden verschlüsselt per HTTPS an Brevo übermittelt. Bitte bestätigen Sie den Link in der E-Mail (Double-Opt-in), erst dann sind Sie auf der Warteliste.'
            : '<strong>Brevo ist gerade nicht erreichbar.</strong> Ihre Angaben sind lokal gesichert. Bitte senden Sie sie uns per E-Mail-Button – so geht Ihre Anfrage nicht verloren.');
          result.hidden = false;
          $('[data-gmr-result-badge]', result).innerHTML = badge;
          $('[data-gmr-result-table]', result).innerHTML = rows;
          var m = $('[data-gmr-result-mailto]', result); m.href = mailto('Warteliste – freiwillige Angaben', body);
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
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'getmyright-angaben-verschluesselt.json'; document.body.appendChild(a); a.click(); a.remove();
        status(out, '', 'Export erstellt (verschlüsselt, ' + list().length + ' Eintrag/Einträge).');
      });
      $('[data-gmr-local-delete]', wrap).addEventListener('click', function () { store('gmr_waitlist_records', null); status(out, 'ok', 'Alle lokal gespeicherten Angaben wurden von diesem Gerät gelöscht.'); });
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

  /* ---------- Upload (Kanal 2) ---------- */
  var ALLOWED = ['zip', 'csv', 'pdf', 'xlsx', 'xls', 'json', 'txt', 'png', 'jpg', 'jpeg'];
  function fmtMb(b) { return (b / 1048576).toFixed(b < 10485760 ? 2 : 1).replace('.', ',') + ' MB'; }
  function initUpload() {
    var form = $('form[data-gmr-upload]'); if (!form) return;
    var max = (CFG.maxUploadMb || 250) * 1048576;
    var input = form.elements.files, list = $('[data-gmr-file-list]', form.parentNode), st = $('[data-gmr-status]', form.parentNode), bar = $('[data-gmr-progress]', form.parentNode), banner = $('[data-gmr-upload-mode]');
    if (banner) status(banner, CFG.uploadEndpoint ? 'ok' : 'warn', CFG.uploadEndpoint ? '<strong>Upload aktiv.</strong> Dateien werden verschlüsselt per HTTPS an unseren Upload-Dienst übertragen.' :
      '<strong>Hinweis zum Upload-Kanal:</strong> Der Server für große Dateien wird gerade angebunden. Diese Seite prüft Dateityp und Größe bereits lokal, <strong>überträgt aber noch keine Datei an einen Server</strong>. Kleinere Dateien senden Sie bis dahin bitte per E-Mail an <a href="mailto:' + CONTACT + '">' + CONTACT + '</a>.');
    function check() {
      var files = Array.prototype.slice.call(input.files || []), rows = [], ok = [], bad = 0;
      files.forEach(function (f) {
        var ext = (f.name.split('.').pop() || '').toLowerCase(), err = '';
        if (ALLOWED.indexOf(ext) < 0) err = 'Dateityp .' + ext + ' nicht erlaubt';
        else if (f.size > max) err = 'größer als ' + (CFG.maxUploadMb || 250) + ' MB';
        else if (f.size === 0) err = 'Datei ist leer';
        if (err) bad++; else ok.push(f);
        rows.push('<tr><td>' + esc(f.name) + '</td><td>' + fmtMb(f.size) + '</td><td>' + (err ? '<span class="badge err">' + esc(err) + '</span>' : '<span class="badge ok">geprüft</span>') + '</td></tr>');
      });
      list.innerHTML = rows.length ? '<div class="table-wrap"><table><thead><tr><th>Datei</th><th>Größe</th><th>Prüfung</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' : '';
      return { ok: ok, bad: bad, all: files.length };
    }
    input.addEventListener('change', check);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var r = check(), el = form.elements;
      var b1 = invalid(el.email, !EMAIL_RE.test(el.email.value.trim())), b2 = invalid(el.consent, !el.consent.checked), b3 = invalid(input, !r.all);
      if (b1 || b2 || b3) { status(st, 'err', 'Bitte wählen Sie mindestens eine Datei, geben Sie Ihre E-Mail-Adresse an und bestätigen Sie den Datenschutzhinweis.'); return; }
      if (r.bad) { status(st, 'err', r.bad + ' Datei(en) erfüllen die Vorgaben nicht (erlaubt: ' + ALLOWED.join(', ').toUpperCase() + ', max. ' + (CFG.maxUploadMb || 250) + ' MB je Datei). Bitte entfernen oder ersetzen.'); return; }
      bar.hidden = false; bar.value = 0;
      prepareFiles(r.ok, el.redact && el.redact.checked, $('[data-gmr-redact-report]', form.parentNode)).then(function (files) { r.ok = files; send(); });
      function send() {
      if (!CFG.uploadEndpoint) {
        var i = 0, n = r.ok.length;
        (function next() {
          if (i >= n) {
            status(st, 'warn', '<strong>' + n + ' Datei(en) lokal erfolgreich geprüft – es wurde noch nichts an einen Server übertragen.</strong> Der Upload-Server ist noch nicht freigeschaltet. Für kleinere Dateien nutzen Sie bitte Kanal 1: <a href="' + esc(mailto('Unterlagen für GetMyRight', 'Hallo GetMyRight-Team,\n\nanbei meine Unterlagen (' + r.ok.map(function (f) { return f.name; }).join(', ') + ').\n\nE-Mail im Konto: ' + el.email.value.trim() + '\n\nViele Grüße')) + '">E-Mail an ' + CONTACT + '</a>. Große Dateien bitte aufbewahren – wir melden uns, sobald der Upload aktiv ist.');
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
      xhr.onload = function () { if (xhr.status >= 200 && xhr.status < 300) status(st, 'ok', 'Upload abgeschlossen. Vielen Dank – Ihre Dateien sind sicher bei uns eingegangen.'); else status(st, 'err', 'Upload fehlgeschlagen (Status ' + xhr.status + '). Bitte erneut versuchen oder Kanal 1 nutzen.'); };
      xhr.onerror = function () { status(st, 'err', 'Verbindung zum Upload-Dienst fehlgeschlagen. Bitte erneut versuchen oder Kanal 1 nutzen.'); };
      xhr.send(fd);
      }
    });
  }
  /* Textbasierte Dateien (CSV/TXT/JSON) vor dem Upload teilmaskieren */
  var TEXT_EXT = ['csv', 'txt', 'json'];
  function prepareFiles(files, doRedact, report) {
    if (!doRedact || !window.GMRRedactor) return Promise.resolve(files);
    var rows = [];
    return Promise.all(files.map(function (f) {
      var ext = (f.name.split('.').pop() || '').toLowerCase();
      if (TEXT_EXT.indexOf(ext) < 0) { rows.push('<tr><td>' + esc(f.name) + '</td><td colspan="2"><span class="badge warn">nicht automatisch maskierbar (' + ext.toUpperCase() + ')</span></td></tr>'); return Promise.resolve(f); }
      return f.text().then(function (txt) {
        var res = window.GMRRedactor.redact(txt);
        var nf = new File([res.text], f.name.replace(/(\.[^.]+)$/, '_maskiert$1'), { type: f.type || 'text/plain' });
        var url = URL.createObjectURL(nf);
        rows.push('<tr><td>' + esc(f.name) + '</td><td>' + res.counts.karte + ' Karten · ' + res.counts.iban + ' IBAN · ' + res.counts.transaktion + ' Transaktions-/Buchungskennungen</td><td><a href="' + url + '" download="' + esc(nf.name) + '" data-gmr-redacted>maskierte Kopie</a></td></tr>');
        return nf;
      });
    })).then(function (out) {
      if (report) report.innerHTML = '<h4 style="margin-top:14px">Teilmaskierung</h4><div class="table-wrap"><table><thead><tr><th>Datei</th><th>Maskiert</th><th>Ergebnis</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
      return out;
    });
  }
  function initRedactTool() {
    $$('[data-gmr-redact-tool]').forEach(function (w) {
      var ta = $('textarea', w), out = $('[data-gmr-redact-out]', w);
      $('[data-gmr-redact-run]', w).addEventListener('click', function () {
        if (!ta.value.trim()) { status(out, 'err', 'Bitte fügen Sie zuerst einen Text ein, z. B. Zeilen aus einem CSV-Umsatzexport.'); return; }
        var r = window.GMRRedactor.redact(ta.value);
        status(out, 'ok', '<strong>' + r.total + ' Kennung(en) teilmaskiert</strong> (' + r.counts.karte + ' Karten, ' + r.counts.iban + ' IBAN, ' + r.counts.transaktion + ' Transaktions-/Buchungskennungen, ' + r.counts.name + ' Namen gekürzt, ' + r.counts.adresse + ' Adressen entfernt).<pre style="white-space:pre-wrap;margin:8px 0 0" data-gmr-redact-result>' + esc(r.text) + '</pre>');
      });
    });
  }

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
    initNav(); initGoogle(); initMagic(); initRegister(); initLogin(); initSession(); initWaitlist(); initCopy(); initUpload(); initDashboard(); initRedactTool();
  });
})();
