# Bereitstellung der GetMyRight-Plattform auf GitHub

## Schritt 1: Repository erstellen

1. Melden Sie sich bei GitHub an (https://github.com)
2. Klicken Sie oben rechts auf das Plus-Symbol (+) neben Ihrem Profilbild
3. Wählen Sie "New repository"
4. Geben Sie folgende Informationen ein:
   - Repository name: `getmyright-website`
   - Description: `GetMyRight Plattform für Rechtsfall-Vermittlung`
   - Public (lassen Sie es auf Public)
   - Deaktivieren Sie "Initialize this repository with a README"
5. Klicken Sie auf "Create repository"

## Schritt 2: Dateien vorbereiten

Alle notwendigen Dateien befinden sich bereits in Ihrem aktuellen Arbeitsverzeichnis:
- `index.html` (Hauptseite)
- `getmyright-index.html`, `getmyright-spieler.html`, `getmyright-kanzlei.html`, `getmyright-admin.html`
- `css/` Ordner mit Stylesheets
- `js/` Ordner mit JavaScript-Dateien
- `assets/` Ordner mit Bildern

## Schritt 3: Dateien über die GitHub-Weboberfläche hochladen

1. Gehen Sie auf Ihre Repository-Seite: https://github.com/robinwolff90/getmyright-website
2. Klicken Sie auf den grünen Button "Add file"
3. Wählen Sie "Upload files"
4. Ziehen Sie alle Dateien und Ordner in den Upload-Bereich:
   - `index.html`
   - `getmyright-index.html`
   - `getmyright-spieler.html`
   - `getmyright-kanzlei.html`
   - `getmyright-admin.html`
   - `css/` Ordner
   - `js/` Ordner
   - `assets/` Ordner
   - `README.md`
   - `DEPLOYMENT_GUIDE.md`
5. Scrollen Sie nach unten und klicken Sie auf "Commit changes"

## Schritt 4: GitHub Pages aktivieren

1. Gehen Sie zur Repository-Einstellungsseite:
   https://github.com/robinwolff90/getmyright-website/settings

2. Scrollen Sie zum Abschnitt "Pages" (ganz unten im linken Menü)

3. In der "Source"-Sektion:
   - Wählen Sie "Deploy from a branch"
   - Branch: "main"
   - Folder: "/ (root)"
   - Klicken Sie auf "Save"

4. Ihre Website ist jetzt unter folgender URL verfügbar:
   https://robinwolff90.github.io/getmyright-website/

## Schritt 5: Domain verknüpfen

1. Bleiben Sie in den "Pages"-Einstellungen

2. Im Abschnitt "Custom domain":
   - Geben Sie Ihre Spaceship-Domain ein (z.B. getmyright.de)
   - Klicken Sie auf "Save"

## Schritt 6: DNS-Einträge in Spaceship konfigurieren

1. Melden Sie sich bei Ihrem Spaceship-Konto an

2. Wählen Sie Ihre Domain aus

3. Gehen Sie zu den DNS-Einstellungen

4. Fügen Sie folgende DNS-Einträge hinzu:

```
Typ: CNAME
Name: www
Wert: robinwolff90.github.io

Typ: A
Name: @
Wert: 185.199.108.153

Typ: A
Name: @
Wert: 185.199.109.153

Typ: A
Name: @
Wert: 185.199.110.153

Typ: A
Name: @
Wert: 185.199.111.153
```

## Schritt 7: HTTPS-Zertifikat aktivieren

GitHub Pages stellt automatisch ein kostenloses SSL-Zertifikat bereit. 
Dies geschieht automatisch nach einigen Minuten bis Stunden nach der Domain-Verknüpfung.

## Troubleshooting

### Wenn die Website nicht aufrufbar ist:
1. Warten Sie 5-10 Minuten und versuchen Sie es erneut
2. Überprüfen Sie die DNS-Einträge in Spaceship
3. Stellen Sie sicher, dass GitHub Pages aktiviert ist

### Wenn das Zertifikat nicht funktioniert:
1. Gehen Sie zu Settings > Pages
2. Entfernen Sie die Domain und fügen Sie sie erneut hinzu
3. Warten Sie 10-15 Minuten

### Häufige Probleme:
- DNS-Änderungen benötigen bis zu 48 Stunden zur weltweiten Propagation
- Groß-/Kleinschreibung bei DNS-Einträgen beachten
- Leerzeichen in DNS-Namen vermeiden

## Wichtige URLs

- Repository: https://github.com/robinwolff90/getmyright-website
- Website (temporär): https://robinwolff90.github.io/getmyright-website/
- Website (nach DNS): https://IHRE-SPACESHIP-DOMAIN.de

## Nächste Schritte

Nach erfolgreicher Einrichtung können Sie:
1. Den Inhalt der HTML-Dateien anpassen
2. Das Design in den CSS-Dateien verfeinern
3. Die JavaScript-Funktionalitäten erweitern
4. Weitere Seiten hinzufügen

## Support

Für technischen Support:
- GitHub: https://support.github.com
- GitHub Community: https://github.community