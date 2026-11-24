/* GetMyRight – zentrale Konfiguration (statische Website auf GitHub Pages)
 *
 * googleClientId: OAuth-2.0-Client-ID aus der Google Cloud Console (Typ "Webanwendung",
 *   autorisierter JavaScript-Ursprung: https://getmyright.de). Leer = Google-Login nicht aktiv;
 *   die Seiten zeigen dann einen ehrlichen Hinweis statt eines Fake-Logins.
 *   WICHTIG (DSGVO/CSP): Solange googleClientId leer ist, sind https://accounts.google.com und
 *   https://*.googleusercontent.com bewusst NICHT in der Content-Security-Policy (<meta>-Tag
 *   in allen HTML-Seiten). Wird eine Client-ID eingetragen, diese Ursprünge
 *   wieder in script-src, style-src, img-src, connect-src und frame-src aufnehmen und den
 *   Zwei-Klick-Hinweis am Google-Button beibehalten (Google wird erst nach Klick geladen).
 *   GA4/Consent-Mode (noch nicht live): Beim Freischalten von googletagmanager.com zusätzlich
 *   in script-src https://www.googletagmanager.com, in img-src https://*.google-analytics.com
 *   und https://*.googletagmanager.com sowie in connect-src https://*.google-analytics.com,
 *   https://*.analytics.google.com und https://*.googletagmanager.com aufnehmen. Der bestehende
 *   Analytics-Patch muss danach auf die aktuelle CSP-Zeile neu aufgesetzt werden.
 * authEndpoint: HTTPS-Endpunkt eines Backends, das das Google-ID-Token serverseitig prüft
 *   (z. B. POST { credential, role }). Ohne Backend bleibt der Google-Login eine Vorschau.
 * uploadEndpoint: HTTPS-Endpunkt für große Dateien (z. B. vorsignierte S3-/R2-URL-Ausgabe oder Backend).
 *   Leer = Dateien werden nur lokal geprüft, aber NICHT übertragen.
 * maxUploadMb: maximale Dateigröße pro Datei in MB für den Upload-Kanal.
 * magicLinkEndpoint: Backend-Endpunkt, der einen zeitlich begrenzten Anmeldelink per E-Mail versendet
 *   (passwortloser Schnellzugang). Leer = Funktion vorbereitet, aber nicht aktiv.
 * otpEndpoint: optionaler Backend-Endpunkt für echten SMS-Versand von Einmalcodes.
 */
window.GMR_CONFIG = {
  googleClientId: "",
  authEndpoint: "",
  otpEndpoint: "",
  magicLinkEndpoint: "",
  uploadEndpoint: "",
  maxUploadMb: 250,
  contactEmail: "info@getmyright.de",
  /* Warteliste: Anmeldungen gehen an den eigenen Cloudflare-Worker (Missbrauchsschutz: Rate-Limit, Honeypot,
   * Zeitfalle, optional Turnstile), der nur EMAIL, FIRSTNAME, OPT_IN an Brevo (Double-Opt-in) weiterreicht.
   * Die Brevo-Formular-URL liegt ausschließlich als Worker-Secret vor. Code: /workers/waitlist/ */
  waitlistEndpoint: "https://gmr-waitlist.getmyright.workers.dev/waitlist",
  /* Cloudflare-Turnstile-Sitekey (öffentlich). Leer = kein Captcha-Widget; Worker prüft dann nur Rate-Limit/Honeypot/Zeitfalle.
   * Wird ein Sitekey eingetragen, muss im Worker das Secret TURNSTILE_SECRET gesetzt sein. */
  turnstileSiteKey: "",
  minFillMs: 3000
};
