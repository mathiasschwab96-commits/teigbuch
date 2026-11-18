# Teigbuch – Pizza & Brot

Installierbare Web-App (PWA) für Teigrezepte mit Bäckerprozenten, mehrstufiger Teigführung,
Backplaner mit Timer und Backtagebuch. Läuft offline, ohne Server, ohne Konto. Alle Daten bleiben auf dem Handy.

## Funktionen

| Bereich | Was es kann |
|---|---|
| **Rezepte** | Vorlagen (Napoletana mit Biga, Poolish, Lievito Madre, NY Style, Sauerteigbrot) oder leer starten. Editor in 7 Schritten. |
| **Teigberechnung** | Bäckerprozente. Hydration ⇄ Wassermenge und Öl % ⇄ g in beide Richtungen. Mehlmischungen, Verlustzuschlag, Menge nach Teiglingen oder nach Mehl. |
| **Temperaturen** | Pro Schritt eine Soll-Temperatur. Während des Backens lassen sich Teig- (nach dem Kneten), Raum- und Kühlschranktemperatur notieren; die Werte landen automatisch im Tagebuch. |
| **Vorteige** | Biga, Poolish, Sauerteig/Levain, Lievito Madre (fest, mit Madre-Anteil und -Hydration), eigener Vorteig. Mehrere Vorteige gleichzeitig möglich. Mehl und Wasser des Vorteigs werden automatisch vom Hauptteig abgezogen. |
| **Teigführung** | Schritte mit Dauer und Ort (RT / Kühlschrank / Warm / Ofen), z. B. Biga 2 h RT, dann 24 h Kühlschrank. Schritte können parallel laufen. Wiederholte Erinnerungen (Dehnen & Falten 4× alle 30 min). Ablauf-Vorschlag auf Knopfdruck. |
| **Backen planen** | „Jetzt starten“ zeigt sofort, wann gebacken wird. „Backen um …“ rechnet rückwärts die Startzeit aus. Warnt vor Schritten in der Nacht, und 🪄 passt die Kühlschrankzeiten automatisch an. Pro Backtag lassen sich Hydration und Menge ändern. |
| **Timer** | Countdown bis zum nächsten Schritt, Ton, Vibration und Benachrichtigung. Dazu „Erledigt“, ±15 min und die Zutaten des aktuellen Schritts zum Abhaken. Export in den Kalender (.ics) mit Alarm. |
| **Tagebuch** | Bewertung mit Teilnoten (Pizza: Rand, Boden …; Brot: Kruste, Krume …). Die Parameter des Tages werden aus dem Backvorgang übernommen. Dazu Bedingungen, Fotos und „Nächstes Mal“. Diagramm Hydration gegen Bewertung, „So nochmal backen“ und „Ins Rezept übernehmen“. |
| **Sauerteig** | Levain-Rechnung mit Anstellgut, Wassertemperatur-Rechner für die Zielteigtemperatur, Brot-Vorlage mit Autolyse und Stockgare mit Dehnen & Falten. |
| **Temperatur-Ausgleich** | Garzeiten bei Raumtemperatur und in der Gärbox passen sich der tatsächlichen Temperatur an (+4 °C ≈ 30 % kürzer). Die Temperatur kann vorab im Planer stehen oder während des Backens gemessen werden. Kühlschrankphasen bleiben unverändert. |
| **Teighände-Modus** | Große Ansicht mit riesigem Weiter-Knopf und „Rückgängig“ (8 s). Der Bildschirm bleibt an, Sprachansagen auf Deutsch. |
| **QR-Code** | Ein Rezept wird als QR-Code geteilt, komprimiert im #-Teil des Links, also ohne Server und ohne Fotos. Empfang über die Kamera-App, den In-App-Scanner (Android/Chrome) oder einen eingefügten Link. |
| **Geräte-Sync** | Optional über Supabase: Anmeldung per E-Mail-Code, Abgleich von Rezepten, Tagebuch und Fotos. Offline-first, bei Konflikten gewinnt die neuere Version. Einrichtung: **ANLEITUNG.txt**, Datenbank: `supabase-setup.sql`, Wecker: `.github/workflows/supabase-keepalive.yml`. |
| **Funktionen** | Alle Zusatzfunktionen lassen sich unter Einstellungen → Funktionen einzeln abschalten. |
| **Daten** | Fotos werden komprimiert gespeichert. Export als Sicherung (JSON inkl. Fotos) oder pro Rezept, Import mit Zusammenführen. Ein Hinweis erinnert, wenn die letzte Sicherung zu alt ist. |

## Aufs Handy bringen

Eine PWA braucht eine **HTTPS-Adresse**. Die App ist eine rein statische Seite, darum reicht kostenloses Hosting.
Es werden **keine** Rezeptdaten hochgeladen, nur der App-Code.

### Variante A: GitHub Pages (empfohlen, dauerhaft und kostenlos)
1. Auf github.com ein Konto anlegen und ein neues Repository erstellen, z. B. `teigbuch` (öffentlich).
2. **Add file → Upload files** wählen und den *Inhalt* dieses Ordners hochladen (`index.html`, `app.js`, … und den Ordner `icons`).
3. Unter **Settings → Pages** als Source „Deploy from a branch“ wählen, dann Branch `main` und `/ (root)`. Speichern.
4. Nach ca. 1 Minute läuft die App unter `https://<dein-name>.github.io/teigbuch/`.

### Variante B: Netlify Drop
Auf app.netlify.com/drop den Ordner `teigbuch` ins Browserfenster ziehen. Mit einem kostenlosen Konto bleibt die Adresse dauerhaft.

### Installieren
- **Android (Chrome):** Adresse öffnen, dann **⋮ → App installieren**. Danach Benachrichtigungen erlauben.
- **iPhone (Safari):** Adresse öffnen, dann **Teilen → Zum Home-Bildschirm**. Benachrichtigungen gibt es erst ab iOS 16.4 und nur in der installierten App.

### Updates
Geänderte Dateien neu hochladen und in `sw.js` die Versionsnummer in `CACHE` erhöhen.

## Grenzen und Lösungen

| Anforderung | Stand | Lösung |
|---|---|---|
| Push-Benachrichtigung bei **komplett geschlossener** App | Eine Web-App ohne Server kann keine Benachrichtigung zu einer festen Uhrzeit planen. Sie funktioniert, solange die App offen ist oder kurz im Hintergrund läuft. | **📅 In Kalender eintragen** legt jeden Schritt mit Alarm im Handy-Kalender an. Das ist zuverlässig, auch nach einem Neustart. Ausbaustufe 1: die App als echte Android/iOS-App verpacken (Capacitor + Local Notifications). Ausbaustufe 2: ein kleiner Push-Server. |
| Daten beim Handywechsel | Die Daten liegen lokal auf dem Gerät, ohne automatische Cloud. | **Sicherung exportieren**, z. B. in Google Drive oder iCloud, und auf dem neuen Gerät **Importieren**. Die App erinnert an fällige Sicherungen. **Gelöst:** Geräte-Sync über Supabase (siehe ANLEITUNG.txt). |
| Vorteig aus einem anderen Vorteig (z. B. 3-stufiger Roggensauer) | Jeder Vorteig wird einzeln berechnet. | Die Stufen als Schritte anlegen und den finalen Sauer als Vorteig mit Anstellgut-Anteil rechnen. |

## Dauerhaft gültige Sicherungen
Jede Sicherung trägt eine Datenversion (`schema`, je Eintrag `v`). Beim Import, beim Geräte-Sync, beim QR-Empfang
und nach einem App-Update werden ältere Daten über `migrate.js` schrittweise auf den aktuellen Stand gebracht.
Nicht ableitbare neue Angaben fragt die App über „Angaben nachtragen“ (`#/fix`) ab. Unbekannte Felder aus neueren
Versionen bleiben erhalten. Prüfung: `tests/compat.html` (mit echten Sicherungen in `tests/fixtures/`).
Regeln für künftige Änderungen: **CLAUDE.md**.

## Technik
Vanilla JavaScript (ES-Module) ohne Abhängigkeiten. Speicher: IndexedDB. Offline über einen Service Worker.
Dateien: `index.html`, `styles.css`, `app.js` (Oberfläche), `calc.js` (Teigmathe, Zeitplanung, Vorlagen), `db.js` (Speicher, Export), `sw.js`, `manifest.webmanifest`, `icons/`.
