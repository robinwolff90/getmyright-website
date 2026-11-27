# Beleg-Worker (Phase 1) – `gmr-evidence`

**Status: nur Code auf dem Feature-Branch `upload-phase1`. Nichts ist deployt, kein Bucket und keine Datenbank angelegt.**

Sichere Beweis-Uploads für getmyright.de nach Robins Entscheidungen vom 27.11.2026:

- Kein Ende-zu-Ende im Dezember (Claim-Modell: beim Upload steht noch keine Kanzlei fest).
- Cloudflare Worker + R2 (Zuständigkeit **EU**) + D1 (Zuständigkeit **EU**).
- Verschlüsselung auf dem Server mit selbst verwaltetem Schlüssel: pro Datei ein eigener AES-256-GCM-Schlüssel,
  gewickelt mit `MASTER_KEY` (Umschlag-Verschlüsselung). In R2 liegt nur Chiffrat. E-Mail, Dateiname und
  TOTP-Secret liegen in D1 ebenfalls nur verschlüsselt.
- Fall zuerst, Konto später: fünf Fragen → Einwilligung → Belege-Checkliste → E-Mail am Ende.
- Login per 6-stelligem Code **und** Magic-Link (Link funktioniert auch im Browser der Mail-App).
- Kanzleien: E-Mail-Code + **Pflicht-TOTP**, „Gerät 30 Tage merken“ (widerrufbares Geräte-Token).
- Claim: genau eine Kanzlei übernimmt (atomar), erst danach sieht sie Belege. Andere Kanzleien nie.
- Kurzlebige, signierte Links (5 Min., an Kanzlei + Sitzung gebunden, Abmelden macht sie ungültig);
  das Frontend erneuert sie im Hintergrund alle 4 Minuten.
- Nur PDF/JPEG/PNG (Prüfung der Dateisignatur), max. 10 MB. HEIC→JPEG und Verkleinern passieren im Browser
  (`/js/gmr-beleg-bild.js`).
- Turnstile (Widget im Modus „interaction-only“/unsichtbar), Rate-Limits, Audit-Log ohne Inhalte.
- Cron: unbestätigte Entwürfe nach 7 Tagen samt Dateien löschen.

## Frontend

| Seite | Zweck |
|---|---|
| `/spieler/fall.html` | Spieler: Fall anlegen, Belege hochladen, E-Mail bestätigen, Status |
| `/kanzlei/faelle.html` | Kanzlei: Login mit 2FA, offene Fälle, Übernehmen, Belege ansehen/herunterladen |

Beide Seiten sind `noindex` und zeigen „Noch nicht freigeschaltet“, solange `evidenceEndpoint` in
`/js/gmr-config.js` leer ist. Sie sind nirgends verlinkt.

## Lokal testen (nichts geht an Cloudflare)

```bash
cd workers/evidence
npm install
npm test                       # Unit- + Integrationstests (wrangler dev lokal, Miniflare-R2/D1)
node test/e2e-server.mjs       # Worker :8787 + Seite :8080, dann im Browser http://127.0.0.1:8080/spieler/fall.html
# Browser-Test (Playwright, Python): cd test/browser && python make_files.py && python e2e.py
```

Lokal werden Codes in der Browser-Konsole bzw. im Worker-Log ausgegeben (`MAIL_MODE=log`, `DEV_EXPOSE_CODES=1`).
Diese Schalter wirken nur bei Aufrufen über `localhost`/`127.0.0.1`.

## Live-Gang (erst nach Freigabe durch Robin)

1. Datenschutz-Prüfung: Cloudflare als Anbieter akzeptiert? Datenschutzerklärung, AVV, ggf. DSFA.
2. `npx wrangler r2 bucket create gmr-belege --jurisdiction eu`
3. `npx wrangler d1 create gmr-belege --jurisdiction eu` → ID in `wrangler.toml`, dann `npx wrangler d1 execute gmr-belege --remote --file schema.sql`
4. Schlüssel: `node scripts/schluessel-erzeugen.mjs` → `wrangler secret put MASTER_KEY` / `HMAC_KEY`; MASTER_KEY zusätzlich offline sicher verwahren.
5. Turnstile-Widget (unsichtbar) für getmyright.de → `wrangler secret put TURNSTILE_SECRET`, Sitekey in `gmr-config.js`.
6. Brevo-Key nur mit Transaktions-Mail-Recht → `wrangler secret put BREVO_API_KEY`.
7. Kanzleien anlegen: `node scripts/kanzlei-anlegen.mjs "<Name>" <email>` → SQL mit `wrangler d1 execute --remote`.
8. `npx wrangler deploy`, dann `evidenceEndpoint` in `gmr-config.js` eintragen und Feature-Branch nach Review mergen.

Hinweis Free-Plan: Workers Free erlaubt 10 ms CPU pro Anfrage. Verschlüsselung großer Dateien kann darüber
liegen; dann wäre Workers Paid (5 US-$/Monat) nötig – nur nach Freigabe.
