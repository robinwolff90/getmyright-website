# GetMyRight – Website

Statische Website für **getmyright.de** (GitHub Pages, `CNAME`).

## Struktur

| Bereich | Pfad | Inhalt |
|---|---|---|
| Neutraler Einstieg | `/` | Startseite, `impressum.html`, `datenschutz.html`, `agb.html` |
| Mandantenbereich | `/spieler/` | Übersicht & Erklärvideo, `warteliste.html`, `kontoauszuege.html`, `upload.html`, `hilfe.html`, `login.html`, `registrierung.html`, `portal.html` |
| Anwaltsbereich | `/kanzlei/` | Übersicht & Erklärvideo, `login.html`, `registrierung.html`, `dashboard.html` |
| Betrieb | `/admin.html` | Betreiberzugang (noindex) |

Spieler- und Kanzleibereich haben eigene Header/Footer und verlinken sich nicht gegenseitig.
Alte Adressen (`spieler.html`, `kanzlei.html`, `warteliste.html` …) leiten auf die neue Struktur weiter.

## Konfiguration

`js/gmr-config.js`: `googleClientId`, `authEndpoint`, `otpEndpoint`, `uploadEndpoint`, `maxUploadMb`, Brevo-Formular.
Bei neuen Endpunkten die Content-Security-Policy (`connect-src`) in den HTML-Köpfen ergänzen.

## Technik

- `css/gmr.css` – Designsystem (Fraunces/Outfit, Cream/Navy/Terracotta)
- `js/gmr-app.js` – Formulare, Login, 2FA (TOTP), Google-Login-Hook, Warteliste (Brevo + AES-GCM lokal), Upload, Dashboard
- `js/gmr-redactor.js` – optionale Selbstschwärzung privater Buchungszeilen durch den Spieler (keine automatische Schwärzung; Glücksspielzeilen bleiben im Klartext)
- `assets/fonts/` – lokal eingebundene Schriften Fraunces & Outfit (SIL OFL 1.1, keine Google-Fonts-Verbindung)
