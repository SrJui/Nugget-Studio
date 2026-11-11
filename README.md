# Nugget Studio

Privates Web-Tool für die App **Nugget**. Zwei KIs (über deine Claude- und ChatGPT-Abos) arbeiten
zusammen: Die erste schreibt Wissens-Facts mit Webrecherche, die zweite prüft jeden Fact unabhängig.
Nur bestandene Facts werden gespeichert; du siehst sie dir an und veröffentlichst sie. Erst
veröffentlichte Facts landen in Supabase.

- **Erzeugen:** nur die Anzahl wählen. Die Facts verteilen sich auf alle Themen. Läuft im
  Hintergrund weiter, auch wenn die Seite geschlossen oder der Container neu gestartet wird.
- **Veröffentlichen:** Liste aller geprüften Facts – einzeln oder alle auf einmal veröffentlichen.
  Ein Klick öffnet das Detail mit der Begründung der Prüf-KI, dort auch bearbeiten oder ablehnen.
- **Einstellungen:** welche KI schreibt und welche prüft, Anmeldung, Modell, Verbindungstest.

Ablauf pro Fact: Code-Prüfung (Länge von Titel (80) und Summary (140), Text und Quelle vorhanden,
Verdacht auf Dublette) → Prüf-KI (Richtigkeit, Quellen, Verständlichkeit). Fällt ein Fact durch,
wird er verworfen und ein neuer erzeugt. Nach dreimal so vielen Verworfenen wie bestellt bricht
der Auftrag ab.

## Auf dem Server einrichten

Voraussetzung: Docker mit Docker Compose.

```sh
git clone https://github.com/SrJui/Nugget-Studio.git nugget-studio
cd nugget-studio
cp .env.example .env
nano .env          # SUPABASE_SECRET_KEY eintragen, ggf. PORT ändern
docker compose up -d --build
```

Danach ist das Tool unter `http://<server>:8787` erreichbar (oder dem Port aus `.env`).

**Claude anmelden** (einmalig, im Ordner `nugget-studio`):

```sh
docker compose exec -it studio claude auth login
```

Den Anweisungen folgen: Link im Browser öffnen, bestätigen, den angezeigten Code ins Terminal einfügen.
Danach in den Einstellungen auf „Status neu prüfen“ klicken.

**ChatGPT anmelden** (einmalig, im Ordner `nugget-studio`):

```sh
docker compose exec -it studio codex login --device-auth
```

Link im Browser öffnen, den angezeigten Code eingeben. Danach in den Einstellungen auf
„Status neu prüfen“ klicken.

## Aktualisieren

```sh
cd nugget-studio
git pull
docker compose up -d --build
```

Laufende Aufträge machen nach dem Neustart weiter.

## Daten

Alles Dauerhafte liegt im Docker-Volume `studio-data` (Ordner `/app/data` im Container):

- `studio.db` – Aufträge, Entwürfe, Einstellungen (SQLite)
- `claude/`, `codex/` – Anmeldungen der KI-Anbieter

Das Volume bleibt bei `docker compose down` und Updates erhalten. Gelöscht wird es nur mit
`docker compose down -v`.

## Entwickeln (lokal)

```sh
npm install
npm run dev:server   # Server auf Port 8787, liest .env
npm run dev:web      # Oberfläche mit automatischem Neuladen auf Port 5173
npm run check        # Typprüfung
```

Lokal liegen Datenbank und KI-Anmeldungen im Projektordner `data/` (nicht in Git).
Für Claude dann einmal mit dem global installierten `claude`-Befehl anmelden:
`CLAUDE_CONFIG_DIR=data/claude claude auth login`.

## Sicherheit

- Der geheime Supabase-Schlüssel steht nur in `.env` auf dem Server und nie im Frontend oder in Git.
- Das Tool hat keinen eigenen Login. Es sollte nur über dein VPN erreichbar sein, nicht offen im Internet.
- Die KI darf nur im Web suchen und Seiten lesen, keine Dateien ändern oder Befehle ausführen.
