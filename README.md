# GetMyRight Plattform

Eine moderne Plattform zur Vermittlung von Rechtsfällen zwischen Spielern und Kanzleien.

## Projektübersicht

GetMyRight ist eine Webanwendung, die drei Hauptbereiche umfasst:
1. **Spieler-Portal** - Für Endnutzer zur Verfolgung ihres Falles
2. **Kanzlei-Dashboard** - Für Rechtsanwälte zur Claim- und Bearbeitung von Fällen
3. **Admin-Bereich** - Für Plattformbetreiber zur Verwaltung der Systeme

## Technologie-Stack

- HTML5, CSS3, JavaScript (ES6+)
- Responsives Design für alle Geräte
- Keine externen Framework-Abhängigkeiten

## Projektstruktur

```
getmyright/
├── index.html
├── spieler.html
├── kanzlei.html
├── admin.html
├── css/
│   ├── styles.css
│   └── responsive.css
├── js/
│   ├── main.js
│   ├── spieler.js
│   ├── kanzlei.js
│   └── admin.js
├── assets/
│   ├── images/
│   └── documents/
└── README.md
```

## Setup-Anleitung

1. **Lokales Setup**
   - Laden Sie alle Dateien herunter
   - Öffnen Sie `index.html` in Ihrem Browser

2. **Server-Setup**
   - Platzieren Sie alle Dateien in Ihrem Webserver-Verzeichnis
   - Stellen Sie sicher, dass der Webserver statische Dateien ausliefern kann

3. **Konfiguration**
   - Passen Sie die Kontaktdaten in den HTML-Dateien an
   - Aktualisieren Sie die Domainnamen in den Links

## Bereitstellung

### Option 1: Statisches Hosting
- GitHub Pages
- Netlify
- Vercel
- Firebase Hosting

### Option 2: Traditionelles Webhosting
- Apache
- Nginx
- IIS

## Wichtige Funktionen

### Spieler-Portal
- Fallstatus-Einsehen
- Fallverlauf
- Fall-Zurückziehen-Funktion

### Kanzlei-Dashboard
- Fall-Liste mit Filtern
- Claim-Funktion
- Fallannahme/-ablehnung
- Dokumenten-Download

### Admin-Bereich
- Fall-Übersicht
- Manuelle Entsperrung
- Kanzleimanagement
- Feldkonfiguration

## Entwicklung

### Lokaler Entwicklungsserver
Wenn Sie Node.js installiert haben, können Sie einen lokalen Server starten:

```bash
npx serve
```

Oder mit Python:

```bash
python -m http.server 8000
```

## Wartung

### Updates
1. Neue Funktionen können durch Hinzufügen von HTML, CSS und JavaScript implementiert werden
2. Die bestehenden Dateien können direkt bearbeitet werden
3. Bei größeren Änderungen empfehlen wir das Erstellen von Backups

### Sicherheit
- Halten Sie die Software auf dem neuesten Stand
- Überprüfen Sie regelmäßig die Zugriffsrechte
- Sichern Sie regelmäßig alle Daten

## Support

Für technischen Support wenden Sie sich bitte an:
info@getmyright.de

## Lizenz

Copyright (c) 2026 GetMyRight. Alle Rechte vorbehalten.