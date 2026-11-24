# Wartelisten-Proxy (Cloudflare Worker)

Deployt als `gmr-waitlist` → `https://gmr-waitlist.getmyright.workers.dev/waitlist` (nur POST, nur Origin getmyright.de).

Prüft serverseitig: Origin, Größe, Rate-Limit (RL_IP 3/60 s je IPv4 bzw. IPv6-/64, RL_GLOBAL 60/60 s, plus isolat-lokales Limit),
Honeypot (`hp`/`email_address_check`), Zeitfalle (`t` ≥ 3000 ms), E-Mail-Format, optional Turnstile-Siteverify.
Leitet nur EMAIL, FIRSTNAME, OPT_IN an Brevo weiter. Speichert und loggt nichts.

## Secrets (nie ins Repo)
- `BREVO_FORM_URL` – gesetzt.
- `TURNSTILE_SECRET` – noch nicht gesetzt (Turnstile-Widget fehlt, siehe unten).

## Turnstile aktivieren
1. Cloudflare-Dashboard → Turnstile → Widget hinzufügen: Name „GetMyRight Warteliste“, Hostnamen `getmyright.de`, `www.getmyright.de`, Modus „Managed“.
   (Per API braucht das die Berechtigung „Turnstile Sites Write“ / `challenge-widgets.write`.)
2. Secret Key als Worker-Secret setzen: `wrangler secret put TURNSTILE_SECRET` (oder Dashboard → Worker → Einstellungen → Variablen → Secret).
3. Sitekey (öffentlich) in `js/gmr-config.js` → `turnstileSiteKey` eintragen. CSP auf `spieler/warteliste.html` und
   `spieler/registrierung.html` erlaubt `https://challenges.cloudflare.com` bereits (script-src, frame-src).
Reihenfolge: erst Secret im Worker, dann Sitekey im Frontend – sonst ist ein Token Pflicht, das der Worker nicht prüfen kann (er prüft nur, wenn das Secret gesetzt ist).

## Wichtig
Die alte Brevo-Formular-URL steht in der öffentlichen Git-Historie und bleibt direkt aufrufbar. Nach dem Merge in Brevo ein neues
Formular anlegen (bzw. das alte deaktivieren), die neue URL nur als Worker-Secret `BREVO_FORM_URL` hinterlegen.

## Lokal deployen (alternativ zum Connector)
`npx wrangler deploy` in diesem Ordner (wrangler.toml enthält Name und Ratelimit-Bindings).
