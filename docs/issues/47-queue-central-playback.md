# Queue als zentrale Abspielsteuerung der App

## Ziel

Die Regie-Queue wird das **eine** Abspielmodell der App: ein Transport
(Play/Pause, Weiter/Zurück, Stopp, Seek, Hold), ein sichtbarer „on air"-Zustand
und eine Warteschlange, aus der alles läuft — Streamer, Playlist-Einträge,
lokale Videos und Screens. Playlists und Einzel-Streamer werden zu Quellen
dieser Steuerung statt zu parallelen Systemen.

## Ausgangslage (geprüft an 0.34.0)

Heute existieren **fünf** parallel bedienbare Abspielpfade mit je eigener API,
eigenem Zustand und eigener UI:

| Pfad | API | Steuerung |
|---|---|---|
| Einzel-Streamer | `/api/streamers/:id/start\|switch\|stop` | Cockpit, Live-Menü, Streamers-View, Telegram, MCP |
| Playlist | `/api/playlists/:id/play\|next\|previous\|stop` | Cockpit („Weiter"), Playlists-View, Telegram, Scheduler |
| Regie-Queue | `/api/queue/*` (11 Routen) | nur die Queue-Karte, Telegram `/queue`, 3 MCP-Tools |
| Screens | `/api/screens/:type/start\|stop` | Cockpit, Telegram, Scheduler |
| Lokale Medien | über Queue/Playlist (`file:`) | Medien-View |

Konkrete Brüche:

- **Zwei „Weiter" im Cockpit:** `queue.next` ruft `api.playlists.next()` (nächster
  Playlist-Kanal), `queue.nextEntry` ruft `api.queue.next()` (nächste Queue-Zeile).
  Beide heißen im UI ähnlich, meinen aber unterschiedliche Dinge.
- **Queue ist nicht von außen steuerbar:** Play/Stopp/Seek liegen ausschließlich
  in `RegieQueue.vue`; der „Queue +"-Button im Cockpit fokussiert nur die Karte.
- **`QueueSnapshot` ist dünn:** `{ entries, playing, index, loop }` — keine
  `entryId`, kein „als Nächstes", kein Pause-/Hold-Zustand, keine Historie.
- **Duplizierte Semantik:** Die Queue ist eine synthetische Playlist
  (`__regie__`), Playlists haben aber `previous`/`wrap`/`auto_advance`, die
  Queue nicht; `queueStop` und `playlists/stop` laufen getrennt.
- **Scheduler spiegelt die Spaltung:** `start_streamer`, `start_playlist`,
  `start_queue`, `start_screen`, `stop` — fünf Aktionen für einen Vorgang.
- **Stream Deck** kennt nur Start/Stop/Pause/Startbild/Marker, keine Queue.
- **Status:** `status.active_playlist.id === '__regie__'` ist der einzige
  Hinweis darauf, dass die Queue läuft.

## Umfang

### Phase A · Ein Playback-Modell (Backend)

- `PlaybackService` (neu, `src/core/supervisor/playback-service.ts`) als einzige
  Quelle für „was läuft": kapselt Queue, Playlist und Einzelquelle, die
  bestehenden Controller bleiben als Ausführungsschicht.
- Neuer Snapshot `PlaybackState`:
  ```ts
  {
    source: 'queue' | 'playlist' | 'streamer' | 'screen' | 'idle';
    playing: boolean;          // false = gestoppt oder pausiert
    paused: boolean;           // Hold/Pause-Screen statt Stopp
    position_seconds: number | null;
    duration_seconds: number | null;
    current: { kind, id, label, channel } | null;
    next: { kind, id, label } | null;
    loop: 'off' | 'all' | 'one';
    queue_index: number | null;
    updated_at: string;
  }
  ```
- Routen: `GET /api/playback`, `POST /api/playback/{play,pause,resume,stop,next,previous,seek}`.
  Die bestehenden `/api/queue/*`- und `/api/playlists/*`-Routen bleiben als
  kompatible Aliase und rufen denselben Service.
- SSE-Event `playback` (zusätzlich zum bestehenden `queue` und `status`).

### Phase B · Queue als Steuerzentrale (Frontend)

- **Transport-Leiste** im Cockpit (ersetzt die zwei „Weiter"-Buttons):
  ⏮ ▶/⏸ ⏭ ⏹, Seek-Slider für lokale Videos, Loop-Umschalter, „Hold".
- **Queue-Panel** (analog zum Discovery-Panel aus #92): von rechts, per `Q`
  oder Klick, mit derselben Transport-Leiste im Kopf; die Karte bleibt als
  kompakte Vorschau.
- **Einheitliches Hinzufügen:** „Jetzt", „Als Nächstes", „Ans Ende" für
  Streamer, Playlist-Einträge, Medien und Screens — aus Cockpit,
  Streamer-Liste, Medien-View und Discovery.
- Tastatur: `Space` Play/Pause, `N`/`P` Next/Previous, `Q` Queue, `Shift+Q`
  „Jetzt abspielen".
- `QueueSnapshot` (UI-Typ) erweitert um `entryId`, `next`, `loop: 'off'|'all'|'one'`.

### Phase C · Quellen vereinheitlichen

- „Playlist in die Queue laden" und „Queue aus Playlist erzeugen" (einmalige
  Kopie vs. Referenz — Entscheidung: **Kopie**, damit Live-Edits der Playlist
  nicht die laufende Regie verändern).
- Playlist-Weiter/Zurück nutzt intern denselben Transport; `auto_advance` wird
  zu `loop`/`next`-Verhalten der Queue.
- Einzel-Streamer-Start wird zu „ein Eintrag in der Queue" (Queue mit einem
  Eintrag, ohne die bestehende Queue zu löschen — als „Sofort"-Eintrag).
- Scheduler: neue Aktion `playback` mit Ziel (`queue`, `playlist:<id>`,
  `streamer:<id>`, `screen:<type>`) — die alten fünf Aktionen bleiben als Alias.

### Phase D · Persistenz und Wiederaufnahme

- Loop-Modi `off`/`all`/`one` statt Boolean.
- Historie der letzten 20 abgespielten Einträge (`data/queue.json`, Feld
  `history`), sichtbar im Queue-Panel („Zuletzt").
- Resume: Position für lokale Videos bleibt; zusätzlich merkt sich die Queue
  den letzten Eintrag, damit ein Neustart „wo waren wir" anzeigen kann
  (Wiedergabe startet weiterhin nicht automatisch).
- „Hold": pausiert die Queue am aktuellen Eintrag (Pausenscreen), ohne den
  Eintrag zu verlieren.

### Phase E · Oberflächen nachziehen

- **Stream Deck:** Aktionen `queue.next`, `queue.previous`, `queue.playpause`,
  `queue.stop` (Layout-Persistenz bleibt).
- **Telegram:** `/queue` bekommt Zurück/Play-Pause und zeigt „läuft: … · als
  Nächstes: …"; `/now` als Kurzform für „sofort abspielen".
- **MCP:** `relay_playback_state`, `relay_playback_control` (action:
  play|pause|next|previous|stop|seek), `relay_queue_enqueue` (mode:
  now|next|end).
- **Discovery/Cockpit:** „Ans Ende" und „Als Nächstes" nutzen die neuen Modi
  (`mode=next|end` statt nur `now`).

## Akzeptanzkriterien

- [ ] Ein Transport im Cockpit steuert Queue, Playlist und Einzelquelle
      (play/pause/next/previous/stop/seek) ohne Seitenwechsel.
- [ ] `GET /api/playback` beschreibt jede Wiedergabequelle einheitlich; SSE
      `playback` hält die UI ohne Polling aktuell.
- [ ] Es gibt genau eine „Weiter"-Semantik im UI; die zweite Aktion entfällt.
- [ ] Queue-Einträge lassen sich aus Streamer-Liste, Medien, Discovery und
      Playlist mit den Modi `now`/`next`/`end` einreihen.
- [ ] `loop` kennt `off`/`all`/`one`; „Hold" pausiert ohne Eintragsverlust.
- [ ] Nach einem Neustart zeigt die Queue den letzten Eintrag und die
      Video-Position; die Wiedergabe startet weiterhin nicht von selbst.
- [ ] Bestehende Clients (Telegram, MCP, Scheduler, Stream Deck) funktionieren
      unverändert weiter; alte Routen bleiben Aliase.
- [ ] `npm run check`, `npm run build`, `npm run test:e2e` grün; neue Tests für
      `PlaybackService`, Alias-Routen und den Transport im Cockpit.

## Abgrenzungen

- Kein Umbau der Relay-/DelayBuffer-Schicht und keine Änderung am Sink-Verhalten.
- Keine Multi-Sink-Steuerung (Twitch/Kick) in diesem Issue.
- Kein Autoplay nach Neustart.
- Overlay-Studio, Aufnahmen und Einnahmen bleiben unberührt.

## Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Zwei Wahrheiten (PlaybackService + Controller) laufen auseinander | Service liest ausschließlich den Controller-Zustand, schreibt nie selbst |
| Alte Clients brechen durch Routen-Umbau | Alle Alt-Routen als Aliase behalten, mit Tests abgesichert |
| „Einzelstreamer als Queue-Eintrag" verändert bestehende Regie-Abläufe | Feature-Flag `queue.single_source` (Default an), Alt-Verhalten per Alias |
| UI-Umbau im Cockpit kollidiert mit Discovery-Panel (#92) | Queue-Panel und Discovery-Panel teilen sich die Dock-Mechanik, nie gleichzeitig offen |
| Persistenz-Migration (`version: 3`) | Beim Laden migrieren, unbekannte Felder ignorieren, Backup der alten Datei |
