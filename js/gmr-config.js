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
  brevoAction: "https://3304f71f.sibforms.com/serve/MUIFAPRrtlgGOSav-TZEYvwxWoDfrRU0h-FW866IBAxNbwrcT9qdorM53pYAVRR_LIN_auUSrK7Gws7Kf3LsH_caNtFOpb_AMmLfja7j26qYVn2-73m07Doifd5UHweqOfrg1WU4Y4pM_v68QCNZHoBI9QQKtDD0khiYLHZQ6ca94bE-aCyjqPcVOKuAQenYv7E7VWM6GkKOXmnl7A=="
};
