# Resi-Helfer

Ein Tampermonkey-Skript für [rettungssimulator.online](https://rettungssimulator.online), das Erweiterungen bringt. Es macht die Leitstelle übersichtlicher und spart Klicks. Gespielt wird aber weiter von dir: Das Skript alarmiert nie selbst.

## Installation

1. Installiere [Tampermonkey](https://www.tampermonkey.net/) in deinem Browser (Firefox, Chrome, Edge, LibreWolf …).
2. Öffne den Installations-Link: **[resi-helfer.user.js](https://raw.githubusercontent.com/ShadowZyroX7/Resi-Helfer/main/resi-helfer.user.js)**
3. Klicke in Tampermonkey auf **„Installieren“** und lade den Rettungssimulator neu.

Updates kommen automatisch über Tampermonkey. Gibt es eine neue Version, zeigt das Skript außerdem einen **Update-Hinweis** am Menü-Symbol. Ein Klick auf „Installieren“ holt sie sofort.

## Funktionen

Alle Funktionen lassen sich einzeln an- und ausschalten. Dafür gibt es links neben deinem Namen ein Symbol, das das **Kontrollzentrum** öffnet.

**Leitstelle**
- **Fahrzeug-Statusleiste:** Zähler S1–S8 über den Wachen. Ein Klick filtert die Wachenliste nach diesem Status.
- **Einsatz-Countdown:** Restzeit neben laufenden Einsätzen.
- **Einsatzfarben:** Farbiger Rand nach Einsatzart (Brand, THL, Rettungsdienst, Polizei).
- **Einsatzinfos:** Bestmögliche Vergütung direkt in der Einsatzliste (z. B. „◉ max. 1,8k“).
- **Einsatzliste sortieren:** Wie im Spiel, unalarmierte zuerst, nach Restzeit, Vergütung oder Entfernung zur nächsten eigenen Wache.
- **Eigene Fahrzeuge bei Freigaben:** Ein Symbol zeigt, wie viele deiner Fahrzeuge bei einer Verbandsfreigabe sind. Ab einer einstellbaren Anzahl gilt sie als versorgt (grün) und rutscht ans Ende der Liste.
- **Wachen-Notizen:** Eigene Notizen an jeder Wache.
- **Personal:** Vorhandenes und benötigtes Personal pro Wache.
- **Tagesleiste:** Eigene Einsätze, freie Fahrzeuge und Tagesverdienst in der Kopfzeile.
- **Reiter-Zähler:** Neue und gesamte Einsätze an den Reitern „Einsätze“ und „Freigaben“.

**Statistik**
- Auswertung nach Tag, Woche, Monat, Jahr und gesamt – direkt aus dem Münzverlauf des Spiels: Verdienst, Ausgaben, Bilanz, Einsätze, Ø pro Einsatz, Diagramm, häufigste Einsätze und Ausgaben nach Art.

**Alarme**
- Ton bei Sprechwunsch (S5) und bei neuem Anruf, blinkender Tab-Titel, Desktop-Benachrichtigung.

**Einsatzfenster**
- **Einsatz-Check:** Benötigte Fahrzeuge, was schon vor Ort, unterwegs oder ausgewählt ist, dazu Vergütung und Dauer.
- **Listenfilter:** „Nur freie“, „Nur benötigte“ und ein Umkreis in km.
- **Hotkeys (frei belegbar):** Alarmieren, Freigeben, Anlegen, mit Zusatztaste jeweils auch „& Schließen“ bzw. „& öffnen“. Mit **A** / **D** springst du zum vorherigen bzw. nächsten Einsatz.
- **Stichwort fokussieren:** Beim Anlegen eines Einsatzes steht der Cursor sofort im Einsatzstichwort.

## Datenschutz

Alle Einstellungen und Notizen bleiben lokal in deinem Browser. Das Skript spricht nur mit dem Rettungssimulator selbst.

## Für Entwickler

```
node build.js <github-benutzer> [repo-name] [autor]
```

Der Befehl baut `resi-helfer.user.js` aus `resi-helper.js`. Für ein Update erhöhst du `VERSION` in `resi-helper.js`, baust neu und lädst die Datei hoch.

Zum Entwickeln gibt es einen Lader mit lokalem Server: `node server.js` starten und `resi-helper-loader.user.js` in Tampermonkey installieren. Dann reicht nach jeder Änderung ein F5 im Spiel.
