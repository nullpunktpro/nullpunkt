# Nullpunkt

Web-App zum Einschießen: Scheibe drucken, Gruppe schießen, Scheibe fotografieren, Klickkorrektur ablesen.
Zusätzlich misst das iPhone an der Waffe, wie ruhig der Haltepunkt vor jedem Schuss war.

Läuft unter https://nullpunkt.pro (GitHub Pages). Keine Abhängigkeiten, kein Build-Schritt.

## Aufbau

| Datei | Inhalt |
|---|---|
| `index.html`, `css/app.css` | App-Hülle und Gestaltung |
| `js/main.js` | Bildschirme, Ablauf, Export |
| `js/strings.de.js` | Alle Oberflächentexte |
| `js/sensors.js` | Bewegungssensoren, Mikrofon, Schusserkennung |
| `js/vision.js` | Eckmarken-Erkennung, Homographie, Entzerrung |
| `js/analysis.js` | Streukreis, Treffpunktlage, Klicks, Ruhewerte |
| `js/target.js` | Scheibe als SVG für die Ergebnisansicht |
| `js/store.js` | Lokale Speicherung (nur auf dem Gerät) |
| `sw.js`, `manifest.webmanifest` | Offline-Fähigkeit und Installation |
| `tools/make_assets.py` | Erzeugt `assets/zielscheibe-a4.pdf` und die Icons |

Geometrie der Scheibe: Markenmitten bei ±85 mm vom Haltepunkt, Marken 20 mm, Marke oben links mit 8-mm-Kern.
Bei Änderungen `js/vision.js` und `tools/make_assets.py` gemeinsam anpassen.

## Entwickeln

```
npm test            # Rechenkerne und Markenerkennung
npm run serve       # lokal unter http://localhost:8080
python tools/make_assets.py
```

Bewegungssensoren, Mikrofon und Kamera funktionieren auf dem iPhone nur über HTTPS, also über die veröffentlichte Seite.
Nach jeder Änderung an Dateien die Cache-Version in `sw.js` hochzählen.

## Offene Punkte

- Grenzen für „ruhig / unruhig / verrissen“ mit echten Trocken- und Scharfschussdaten kalibrieren.
- Schuss und Loch einander zuordnen (z. B. Foto nach jedem Schuss).
- Automatische Erkennung der Einschusslöcher.
- Impressum und Datenschutz: Platzhalter durch echte Angaben ersetzen.
