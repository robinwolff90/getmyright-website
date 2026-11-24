/* GetMyRight – Wartelisten-Proxy (Cloudflare Worker)
 * Nimmt Anmeldungen von https://getmyright.de entgegen, prüft Missbrauchsschutz serverseitig
 * und leitet nur EMAIL, FIRSTNAME, OPT_IN an das Brevo-Formular weiter.
 * Secrets (nur als Worker-Secret, nie im Repo):
 *   BREVO_FORM_URL   – Brevo-Formular-Endpunkt (sibforms.com/serve/...)
 *   TURNSTILE_SECRET – optional; sobald gesetzt, ist ein gültiges Turnstile-Token Pflicht
 * Bindings: RL_IP (ratelimit, 3/60 s je IP), RL_GLOBAL (ratelimit, 60/60 s gesamt)
 * Es wird nichts gespeichert oder geloggt (keine E-Mail-Adressen in Logs).
 */
const ALLOWED_ORIGINS = ['https://getmyright.de', 'https://www.getmyright.de'];
const ALLOWED_HOSTNAMES = ['getmyright.de', 'www.getmyright.de'];
const MIN_FILL_MS = 3000;
const EMAIL_RE = /^[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[^\s@<>()"',;]{2,}$/;

function cors(origin) {
  const h = { 'Vary': 'Origin', 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (ALLOWED_ORIGINS.includes(origin)) { h['Access-Control-Allow-Origin'] = origin; h['Access-Control-Allow-Methods'] = 'POST, OPTIONS'; h['Access-Control-Allow-Headers'] = 'Content-Type'; h['Access-Control-Max-Age'] = '600'; }
  return h;
}
// Zusätzliches, isolat-lokales Limit (ergänzt die verteilte, nur ungefähre Ratelimit-Binding)
const MEM = new Map();
function memLimited(key, limit, windowMs) {
  const now = Date.now(), e = MEM.get(key);
  if (MEM.size > 5000) MEM.clear();
  if (!e || now - e.t > windowMs) { MEM.set(key, { t: now, n: 1 }); return false; }
  e.n++; return e.n > limit;
}
// IPv6-Clients rotieren Adressen innerhalb ihres /64-Netzes → Limit pro /64 statt pro Einzeladresse
function clientKey(ip) {
  if (!ip || ip.indexOf(':') < 0) return ip || 'unknown';
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail !== undefined && tail ? tail.split(':') : [];
  const full = tail !== undefined ? h.concat(Array(8 - h.length - t.length).fill('0'), t) : h;
  return full.slice(0, 4).map((x) => x.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}
const json = (obj, status, origin) => new Response(JSON.stringify(obj), { status, headers: cors(origin) });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: ALLOWED_ORIGINS.includes(origin) ? 204 : 403, headers: cors(origin) });
    if (url.pathname !== '/waitlist') return json({ success: false, error: 'not_found' }, 404, origin);
    if (request.method !== 'POST') return json({ success: false, error: 'method' }, 405, origin);
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ success: false, error: 'origin' }, 403, origin);
    const len = Number(request.headers.get('Content-Length') || 0);
    if (len > 8192) return json({ success: false, error: 'too_large' }, 413, origin);

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown', ck = clientKey(ip);
    if (env.RL_GLOBAL) { const g = await env.RL_GLOBAL.limit({ key: 'global' }); if (!g.success) return json({ success: false, error: 'rate_limited' }, 429, origin); }
    if (memLimited('ip:' + ck, 3, 60000)) return json({ success: false, error: 'rate_limited' }, 429, origin);
    if (env.RL_IP) { const r = await env.RL_IP.limit({ key: 'ip:' + ck }); if (!r.success) return json({ success: false, error: 'rate_limited' }, 429, origin); }

    let form;
    try { form = await request.formData(); } catch (e) { return json({ success: false, error: 'bad_request' }, 400, origin); }
    const get = (k) => String(form.get(k) || '').trim();
    const email = get('EMAIL').toLowerCase(), first = get('FIRSTNAME').replace(/[\u0000-\u001f\u007f<>]/g, '').slice(0, 60);
    const hp = get('hp') + get('email_address_check'), elapsed = Number(get('t') || 0);

    // Honeypot / Zeitfalle: still verwerfen (Bot bekommt keine Rückmeldung, woran es lag)
    if (hp) return json({ success: true }, 200, origin);
    if (!(elapsed >= MIN_FILL_MS)) return json({ success: false, error: 'too_fast' }, 400, origin);
    if (!EMAIL_RE.test(email) || email.length > 254 || !first || get('OPT_IN') !== '1') return json({ success: false, error: 'invalid' }, 400, origin);

    if (env.TURNSTILE_SECRET) {
      const token = get('cf-turnstile-response');
      if (!token || token.length > 2048) return json({ success: false, error: 'captcha' }, 400, origin);
      const body = new FormData(); body.append('secret', env.TURNSTILE_SECRET); body.append('response', token); body.append('remoteip', ip);
      let v = {};
      try { v = await (await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body })).json(); } catch (e) { return json({ success: false, error: 'captcha_unavailable' }, 503, origin); }
      if (!v.success || (v.hostname && !ALLOWED_HOSTNAMES.includes(v.hostname))) return json({ success: false, error: 'captcha' }, 400, origin);
    }

    if (!env.BREVO_FORM_URL) return json({ success: false, error: 'not_configured' }, 503, origin);
    const p = new URLSearchParams({ EMAIL: email, FIRSTNAME: first, OPT_IN: '1', email_address_check: '', locale: 'de', html_type: 'simple' });
    try {
      const r = await fetch(env.BREVO_FORM_URL, { method: 'POST', body: p, headers: { 'Accept': 'application/json' } });
      let d = null; try { d = await r.json(); } catch (e) { d = { success: r.ok }; }
      // Neutral antworten (keine Aussage, ob eine Adresse schon eingetragen ist)
      return d && d.success === true ? json({ success: true }, 200, origin) : json({ success: false, error: 'rejected' }, 400, origin);
    } catch (e) {
      return json({ success: false, error: 'upstream' }, 502, origin);
    }
  }
};
