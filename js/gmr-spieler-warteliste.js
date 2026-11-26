/* GetMyRight – Anschluss der Spieler-Warteliste (spieler/warteliste.html) an den eigenen Cloudflare-Worker.
 * Übertragen werden ausschließlich EMAIL, FIRSTNAME, OPT_IN sowie die Schutzfelder t (Zeitfalle), hp/email_address_check
 * (Honeypot) und cf-turnstile-response. Alle freiwilligen Zusatzfragen bleiben im Browser und werden NICHT gesendet.
 * Endpunkt und Turnstile-Sitekey kommen aus /js/gmr-config.js. Validierung und Fehlermeldungen: /js/site.js. */
(function () {
  'use strict';
  var d = document, CFG = window.GMR_CONFIG || {};
  var form = d.querySelector('form[data-gmr-spieler-warteliste]');
  if (!form) return;
  var T0 = Date.now(), MIN_FILL = CFG.minFillMs || 3000, inFlight = false, lastSend = 0, tsId = null;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var box = form.querySelector('[data-gmr-turnstile]');
  var out = form.querySelector('[data-bestaetigung]');
  var btn = form.querySelector('button[type=submit]');
  var btnText = btn ? btn.textContent : '';

  function zeige(ok, html) {
    if (!out) return;
    out.hidden = false;
    out.classList.toggle('bestaetigung--fehler', !ok);
    out.innerHTML = html;
    out.setAttribute('tabindex', '-1'); out.focus();
  }
  function ladeTurnstile() {
    if (!CFG.turnstileSiteKey || !box) return;
    var render = function () { if (window.turnstile && tsId === null) tsId = window.turnstile.render(box, { sitekey: CFG.turnstileSiteKey, theme: 'light', language: 'de', appearance: 'interaction-only' }); };
    if (window.turnstile) return render();
    var sc = d.createElement('script');
    sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    sc.async = true; sc.onload = render;
    d.head.appendChild(sc);
  }
  function token() { return (CFG.turnstileSiteKey && window.turnstile && tsId !== null) ? (window.turnstile.getResponse(tsId) || '') : ''; }
  function reset() { if (window.turnstile && tsId !== null) try { window.turnstile.reset(tsId); } catch (e) { /* ignorieren */ } }
  ladeTurnstile();

  var MELDUNG = {
    too_fast: 'Das ging etwas zu schnell. Bitte senden Sie das Formular in ein paar Sekunden erneut.',
    captcha: 'Die Sicherheitsprüfung ist noch nicht abgeschlossen. Bitte warten Sie einen Moment und senden Sie erneut.',
    rate_limited: 'Gerade kommen sehr viele Anfragen. Bitte versuchen Sie es in einer Minute erneut.',
    invalid: 'Bitte geben Sie Ihren Namen und eine gültige E-Mail-Adresse an und setzen Sie den Haken für die Warteliste.'
  };

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var el = form.elements;
    var hp = Array.prototype.some.call(form.querySelectorAll('input.hp'), function (f) { return !!f.value; });
    if (hp) { zeige(true, '<p><strong>Danke!</strong> Bitte bestätigen Sie den Link in der E-Mail.</p>'); return; }
    var name = (el.FIRSTNAME.value || '').trim(), mail = (el.EMAIL.value || '').trim();
    if (!name || !EMAIL_RE.test(mail) || !el.OPT_IN.checked) return; // site.js zeigt die Feldfehler an
    if (inFlight) return;
    if (Date.now() - lastSend < 30000) { zeige(false, '<p>Ihre Eintragung wurde bereits gesendet. Bitte prüfen Sie Ihr Postfach.</p>'); return; }
    if (Date.now() - T0 < MIN_FILL) { zeige(false, '<p>' + MELDUNG.too_fast + '</p>'); return; }
    if (!CFG.waitlistEndpoint) { zeige(false, '<p>Die Warteliste ist gerade nicht erreichbar. Bitte schreiben Sie uns an ' + (CFG.contactEmail || 'info@getmyright.de') + '.</p>'); return; }
    var tok = token();
    if (CFG.turnstileSiteKey && !tok) { zeige(false, '<p>' + MELDUNG.captcha + '</p>'); return; }
    var p = new URLSearchParams();
    p.append('EMAIL', mail); p.append('FIRSTNAME', name); p.append('OPT_IN', '1');
    p.append('email_address_check', ''); p.append('hp', ''); p.append('t', String(Date.now() - T0));
    if (tok) p.append('cf-turnstile-response', tok);
    inFlight = true; if (btn) { btn.disabled = true; btn.textContent = 'Wird sicher übermittelt …'; }
    fetch(CFG.waitlistEndpoint, { method: 'POST', body: p, headers: { 'Accept': 'application/json' }, credentials: 'omit', mode: 'cors' })
      .then(function (r) { return r.json().catch(function () { return { success: false, error: 'http_' + r.status }; }); })
      .then(function (res) {
        if (res && res.success === true) {
          lastSend = Date.now();
          zeige(true, '<p><strong>Fast geschafft!</strong> Wir haben Ihnen eine E-Mail geschickt. Bitte bestätigen Sie darin den Link, erst dann stehen Sie auf der Warteliste. Ihre freiwilligen Zusatzangaben wurden nicht übertragen.</p>');
        } else {
          zeige(false, '<p>' + (MELDUNG[res && res.error] || 'Die Eintragung hat leider nicht geklappt. Bitte versuchen Sie es später erneut oder schreiben Sie an ' + (CFG.contactEmail || 'info@getmyright.de') + '.') + '</p>');
        }
      }, function () { zeige(false, '<p>Keine Verbindung zur Warteliste. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.</p>'); })
      .then(function () { inFlight = false; reset(); if (btn) { btn.disabled = false; btn.textContent = btnText; } });
  });
})();
