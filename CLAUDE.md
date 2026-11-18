# Teigbuch – Regeln für die Weiterentwicklung

Teigbuch ist eine offline-fähige PWA (Vanilla JS, ES-Module, IndexedDB, optionaler Supabase-Sync).
Nutzer-Anleitung: `ANLEITUNG.txt`. Überblick: `README.md`.

## Oberste Regel: Sicherungen und vorhandene Daten bleiben IMMER gültig

Der Nutzer hat ausdrücklich festgelegt: Jede Sicherungsdatei (und jeder Datenstand auf einem Gerät
oder in Supabase) muss mit jeder späteren App-Version weiter funktionieren. Braucht ein Update
zusätzliche Angaben, die sich nicht sicher ableiten lassen, wird der Nutzer danach gefragt –
es wird nichts geraten oder stillschweigend verworfen. Das gilt für **jedes** künftige Update.

### Pflicht-Checkliste bei jeder Änderung an gespeicherten Daten (Rezepte, Tagebuch, Fotos)
1. `migrate.js`: `SCHEMA` um 1 erhöhen und die Versionsgeschichte im Kopfkommentar ergänzen.
2. Migration „alte Version → neue Version“ in `RECIPE_MIGRATIONS` bzw. `LOG_MIGRATIONS` anlegen.
   - Nur ergänzen/umrechnen, nie Daten löschen.
   - Migrationen müssen **idempotent** sein (mehrfach ausführbar ohne Schaden).
3. Neuer Wert nicht sicher ableitbar → Feld leer lassen und eine Frage in `CHECKS` ergänzen.
   Die App zeigt dann „📝 … braucht noch eine Angabe“ und die Seite `#/fix`.
4. `calc.js` → `sanitizeRecipe`/`sanitizeLog`: neue Felder in die Listen `R_KEYS`/`L_KEYS`/`PF_KEYS`/
   `ST_KEYS` aufnehmen und bereinigen. Fehlende Pflichtangaben **nicht** mit Standardwerten füllen.
   Unbekannte Felder werden automatisch aufbewahrt (`keepUnknown`) – das nicht entfernen.
5. Felder niemals umbenennen oder entfernen ohne Migration.
6. Eine Sicherung der VORHERIGEN Version unter `tests/fixtures/` ablegen (Dateiname mit Format und
   App-Version) und `tests/compat.html` um Prüfungen dafür erweitern. Alte Fixtures nie löschen.
7. `tests/compat.html` im Browser öffnen (lokaler Server) – **alle Prüfungen müssen grün sein**.
8. Version erhöhen: `VERSION` in `app.js` und `CACHE` in `sw.js` (sonst bekommen Geräte das Update nicht).
9. `ANLEITUNG.txt` anpassen, wenn sich Bedienung oder Einrichtung ändert.

### Datenwege – alle Daten von außen laufen über `MG.importRecipe` / `MG.importLog`
- Sicherungsdatei (`db.importData` mit den Import-Funktionen aus `migrate.js`)
- QR-Link (`unpackRecipe`)
- Geräte-Sync (`sync.js` → `applyRow`)
- Daten auf dem Gerät nach einem Update (`migrateLocal` beim Start)

Neue Datenwege müssen denselben Weg nutzen.

### Weitere Hinweise
- Gespeicherte Einträge bekommen beim Speichern `v = max(SCHEMA, v)` – eine höhere Kennung aus einer
  neueren App-Version wird nie herabgesetzt.
- Supabase-Tabelle `items` speichert Einträge als JSON (`data`) – Formatänderungen brauchen dort keine
  SQL-Migration, solange obige Regeln eingehalten werden. Änderungen an `supabase-setup.sql` müssen
  mehrfach ausführbar bleiben.
- Nutzer-sichtbare Texte auf Deutsch; Benutzeroberfläche schlank halten (Zusatzinfos einklappbar).
