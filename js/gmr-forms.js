// GetMyRight – Warteliste (Brevo), Kanzlei-Registrierung (E-Mail) und Demo-Login
// Hinweis: Diese Website ist statisch (GitHub Pages). Es gibt kein eigenes Backend.
// - Warteliste: Nur EMAIL, FIRSTNAME und OPT_IN gehen an das Brevo-Formular (Double-Opt-in).
//   Optionale Fragebogen-Angaben werden NICHT automatisch gespeichert; sie können nur
//   per vorausgefüllter E-Mail an info@getmyright.de gesendet werden.
// - Kanzlei-Registrierung: öffnet eine vorausgefüllte E-Mail an info@getmyright.de.
// - Login: Demo-/Vorschau-Zugang ohne echte Authentifizierung.
(function () {
  'use strict';

  var CONTACT = 'info@getmyright.de';
  // Felder, die das Brevo-Formular serverseitig kennt (laut gehostetem Brevo-Formular)
  var BREVO_FIELDS = ['EMAIL', 'FIRSTNAME', 'OPT_IN', 'email_address_check', 'locale', 'html_type'];
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function setStatus(form, type, html) {
    var box = $('[data-gmr-status]', form) || form.nextElementSibling;
    if (!box || !box.hasAttribute('data-gmr-status')) return;
    box.hidden = false;
    box.className = 'gmr-status mt-4 rounded-lg border p-4 text-sm ' + (type === 'ok'
      ? 'border-emerald-700 bg-emerald-950/60 text-emerald-200'
      : 'border-rose-700 bg-rose-950/60 text-rose-200');
    box.innerHTML = html;
    box.setAttribute('role', type === 'ok' ? 'status' : 'alert');
  }

  function markInvalid(input, invalid) {
    if (!input) return;
    input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    input.style.borderColor = invalid ? '#ef4444' : '';
  }

  function collectExtras(form) {
    var lines = [];
    $all('[data-gmr-extra]', form).forEach(function (el) {
      var val = (el.value || '').trim();
      if (val) lines.push(el.getAttribute('data-gmr-extra') + ': ' + val);
    });
    return lines;
  }

  function mailtoLink(subject, body) {
    return 'mailto:' + CONTACT + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- Warteliste / Brevo ----------
  function bindBrevo(form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = form.elements.EMAIL;
      var name = form.elements.FIRSTNAME;
      var optin = form.elements.OPT_IN;
      var ok = true;

      var emailVal = email ? email.value.trim() : '';
      var emailBad = !EMAIL_RE.test(emailVal);
      markInvalid(email, emailBad); if (emailBad) ok = false;

      if (name && name.hasAttribute('required')) {
        var nameBad = !name.value.trim();
        markInvalid(name, nameBad); if (nameBad) ok = false;
      }
      if (optin && !optin.checked) { ok = false; markInvalid(optin, true); } else { markInvalid(optin, false); }

      if (!ok) {
        setStatus(form, 'err', 'Bitte füllen Sie alle Pflichtfelder aus (gültige E-Mail' + (name && name.hasAttribute('required') ? ', Name' : '') + ' und Einwilligung).');
        return;
      }

      var params = new URLSearchParams();
      BREVO_FIELDS.forEach(function (f) {
        var el = form.elements[f];
        if (!el) return;
        if (el.type === 'checkbox') { if (el.checked) params.append(f, el.value || '1'); }
        else params.append(f, el.value.trim());
      });

      var btn = $('button[type="submit"]', form) || $('button[form="' + form.id + '"]');
      var original = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Wird gesendet …'; }

      fetch(form.getAttribute('action'), {
        method: 'POST',
        body: params,
        headers: { 'Accept': 'application/json' }
      }).then(function (res) {
        return res.json().catch(function () { return { success: res.ok }; });
      }).then(function (data) {
        if (!data || data.success !== true) throw new Error('Brevo-Antwort ohne Erfolg');
        var extras = collectExtras(form);
        var html = '<p class="font-semibold">Fast geschafft – bitte bestätigen Sie Ihre E-Mail-Adresse.</p>' +
          '<p class="mt-1">Wir haben Ihre Anmeldung an unseren Newsletter-Dienst Brevo übermittelt. Sie erhalten in Kürze eine Bestätigungs-E-Mail (Double-Opt-in). Erst nach dem Klick auf den Link sind Sie auf der Warteliste.</p>';
        if (extras.length) {
          var body = 'Hallo GetMyRight-Team,\n\nich habe mich gerade für die Warteliste eingetragen und möchte folgende freiwillige Zusatzangaben ergänzen:\n\n' +
            'Name: ' + (name ? name.value.trim() : '') + '\nE-Mail: ' + emailVal + '\n' + extras.join('\n') + '\n\nViele Grüße';
          html += '<p class="mt-3">Ihre optionalen Zusatzangaben wurden <strong>nicht</strong> automatisch gespeichert. Wenn Sie möchten, können Sie sie uns per E-Mail senden:</p>' +
            '<p class="mt-2"><a class="inline-block rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-500" href="' +
            escapeHtml(mailtoLink('Warteliste – Zusatzangaben', body)) + '">Zusatzangaben per E-Mail senden</a></p>';
        }
        setStatus(form, 'ok', html);
        $all('input, select, textarea, button', form).forEach(function (el) { el.disabled = true; });
        if (btn) btn.textContent = 'Angemeldet';
      }).catch(function () {
        if (btn) { btn.disabled = false; btn.innerHTML = original; }
        setStatus(form, 'err', 'Die Anmeldung konnte gerade nicht übermittelt werden. Bitte versuchen Sie es später erneut oder schreiben Sie uns an <a class="underline" href="mailto:' + CONTACT + '">' + CONTACT + '</a>.');
      });
    });
  }

  // ---------- Kanzlei-Registrierung (E-Mail) ----------
  function bindKanzlei(form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = true;
      $all('[required]', form).forEach(function (el) {
        var bad = el.type === 'checkbox' ? !el.checked : (el.type === 'email' ? !EMAIL_RE.test(el.value.trim()) : !el.value.trim());
        markInvalid(el, bad); if (bad) ok = false;
      });
      if (!ok) { setStatus(form, 'err', 'Bitte füllen Sie alle Pflichtfelder aus und bestätigen Sie den Datenschutzhinweis.'); return; }
      var lines = [];
      $all('[data-gmr-field]', form).forEach(function (el) {
        var v = (el.value || '').trim();
        if (v) lines.push(el.getAttribute('data-gmr-field') + ': ' + v);
      });
      var body = 'Hallo GetMyRight-Team,\n\nwir möchten uns als Partnerkanzlei vormerken lassen:\n\n' + lines.join('\n') + '\n\nViele Grüße';
      var href = mailtoLink('Kanzlei-Registrierung GetMyRight', body);
      setStatus(form, 'ok', '<p class="font-semibold">Ihr E-Mail-Programm öffnet sich mit einer vorausgefüllten Nachricht.</p>' +
        '<p class="mt-1">Die Registrierung ist erst übermittelt, wenn Sie diese E-Mail absenden. Falls sich nichts öffnet: <a class="underline" href="' + escapeHtml(href) + '">E-Mail hier öffnen</a> oder direkt an ' + CONTACT + ' schreiben.</p>');
      window.location.href = href;
    });
  }

  // ---------- Demo-Login ----------
  function bindDemoLogin(btn) {
    btn.addEventListener('click', function () {
      var role = btn.getAttribute('data-gmr-demo-login');
      try { sessionStorage.setItem('gmr_demo_role', role); } catch (err) { /* ignorieren */ }
      window.location.href = role === 'kanzlei' ? 'kanzlei.html' : 'spieler.html';
    });
  }
  function bindDemoLogout(link) {
    link.addEventListener('click', function () {
      try { sessionStorage.removeItem('gmr_demo_role'); } catch (err) { /* ignorieren */ }
    });
  }

  // ---------- Registrierung: Rollenwahl ----------
  function bindRoleTabs() {
    var tabs = $all('[data-gmr-role-tab]');
    if (!tabs.length) return;
    function show(role) {
      tabs.forEach(function (t) {
        var active = t.getAttribute('data-gmr-role-tab') === role;
        t.setAttribute('aria-selected', active ? 'true' : 'false');
        t.classList.toggle('ring-2', active);
        t.classList.toggle('ring-emerald-500', active && role === 'spieler');
        t.classList.toggle('ring-violet-500', active && role === 'kanzlei');
      });
      $all('[data-gmr-role-panel]').forEach(function (p) {
        p.hidden = p.getAttribute('data-gmr-role-panel') !== role;
      });
    }
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        var role = t.getAttribute('data-gmr-role-tab');
        show(role);
        if (history.replaceState) history.replaceState(null, '', '#' + role);
      });
    });
    show(location.hash === '#kanzlei' ? 'kanzlei' : 'spieler');
  }

  document.addEventListener('DOMContentLoaded', function () {
    $all('form[data-gmr-brevo]').forEach(bindBrevo);
    $all('form[data-gmr-kanzlei]').forEach(bindKanzlei);
    $all('[data-gmr-demo-login]').forEach(bindDemoLogin);
    $all('[data-gmr-demo-logout]').forEach(bindDemoLogout);
    bindRoleTabs();
  });
})();
