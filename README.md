# Knackpunkt

FEM-Minispiel: Aus einem Bauteil Kacheln entfernen, dann rechnet eine echte FE-Rechnung (ebener Spannungszustand, im Browser), ob es hält. Allein gegen den ESO-Algorithmus oder als Wettkampf mit Raumcode und Auflösung am Beamer.

## Aufbau

- `src/fem.js`: FE-Kern (Viereckelemente mit inkompatiblen Moden, Band-Cholesky, ESO), ohne DOM
- `src/game.js`: Spiel, Zeichnung, Wettkampf (Presence über claude.ai-Raum oder eigenen Server)
- `src/shell.html`: Seite und Stil
- `game.html`: gebaute Spieldatei (Seitenfragment), läuft als claude.ai-Artifact und über `server.mjs`
- `index.html`: dieselbe Seite als vollständiges Dokument für GitHub Pages (https://fkaule.github.io/Knackpunkt/, Quelle `main`, Hauptverzeichnis, `.nojekyll`); dort gibt es nur „Allein üben“, der Wettkampf braucht den Server
- `server.mjs`: liefert das Spiel aus und verteilt den Status aller Geräte per WebSocket (`/ws`), Status unter `/api/status`

## Befehle

```
npm install
npm run build   # game.html aus src/ bauen
npm test        # FE-Kern gegen Balkentheorie, Mechanismus, ESO-Richtwert
npm start       # Server auf PORT (Standard 8080)
```

Der Server liest `game.html` beim Start ein: nach jedem Build neu starten.

## Wettkampf

- Spielleitung: „Mehrspieler“, „Neues Spiel eröffnen“, Bauteil und Zeit wählen, Runde starten
- Mitspielende: Link mit `#RAUMCODE` öffnen oder Code eintippen, Pseudonym eintragen
- Ende der Zeit gibt automatisch ab; die FEM rechnet alle Entwürfe bei der Spielleitung, Punkte = entfernte Prozent, wenn es hält, sonst 0
