# Restreamer TS - TikTok to YouTube Restreaming Service

> **Node.js/TypeScript-basierter Restreaming-Service** - Inspiriert von [protocatzk/restreamer](https://github.com/protocatzk/restreamer)

---

## 📌 Projektübersicht

Ein **eigener Restreaming-Service** in **Node.js/TypeScript**, der TikTok-Live-Streams zu YouTube weiterleitet. Das Projekt orientiert sich am Python-basierten [protocatzk/restreamer](https://github.com/protocatzk/restreamer), ist aber **unabhängig implementiert** mit moderner TypeScript-Architektur.

### ✅ Hauptziele
- **Echter Echtzeit-Streaming** von TikTok zu YouTube
- **Robuste Verbindungshandhabung** (Auto-Reconnect, Watchdog, Stall Detection)
- **Web-Dashboard** für Steuerung und Monitoring
- **Erweiterbare Architektur** für zukünftige Quellen und Ziele
- **Docker-Ready** für einfache Bereitstellung
- **Typsicherheit** durch TypeScript

### ⚠️ Rechtlicher Hinweis
> **Wichtig:** Restreaming fremder Inhalte kann gegen die Nutzungsbedingungen von TikTok/YouTube und gegen Urheberrechte verstoßen. Verwende dieses Projekt nur für Inhalte, für die du die erforderlichen Rechte hast.

---

## 🏗️ Architektur

### Systemüberblick
```
┌─────────────────────────────────────────────────────────────────────────┐
│                          RESTREAMER TS SERVICE                           │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────────┐ │
│  │  TikTok     │    │  YouTube    │    │   Web Dashboard             │ │
│  │  Source     │    │  Sink       │    │   (Fastify + Vue/React)     │ │
│  └──────┬──────┘    └──────┬──────┘    └──────────────┬──────────────┘ │
│         │                  │                           │               │
│         ▼                  ▼                           ▼               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                        CORE SERVICE                               │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌───────────────────────────┐ │   │
│  │  │ Source      │  │ Relay       │  │ Sink                      │ │   │
│  │  │ Manager     │  │ Buffer      │  │ Manager                   │ │   │
│  │  └──────┬──────┘  └──────┬──────┘  └───────────┬──────────────┘ │   │
│  │         │                │                        │               │   │
│  │  ┌─────────────┐  ┌─────────────┐        ┌─────────────┐          │   │
│  │  │ yt-dlp      │  │ MPEG-TS     │        │ ffmpeg       │          │   │
│  │  │ Wrapper     │  │ Relay       │        │ Process     │          │   │
│  │  └─────────────┘  └─────────────┘        └─────────────┘          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Datenfluss
```
TikTok Live Stream
       ↓
   [yt-dlp resolution]
       ↓
   MPEG-TS Stream
       ↓
   [Delay Buffer - 30s default]
       ↓
   [MPEG-TS Relay Server - localhost:12345]
       ↓
   [ffmpeg normalization & encoding]
       ↓
   YouTube RTMP (rtmp://a.rtmp.youtube.com/live2/STREAM_KEY)
```

---

## 🛠️ Technologie-Stack

| **Komponente** | **Technologie** | **Zweck** |
|----------------|----------------|-----------|
| Runtime | Node.js 20+ | JavaScript Runtime |
| Sprache | TypeScript 5.x | Typsicherheit |
| Web Framework | Fastify | HTTP Server (schneller als Express) |
| Frontend | Vue 3 | Dashboard UI |
| Stream Processing | child_process (ffmpeg, yt-dlp) | Media Processing |
| Reactive | RxJS | Event Streams |
| Configuration | YAML + Zod Schema + env vars | Settings |
| Logging | Pino | Strukturierte Logs |
| Database | LowDB | File-based DB |
| Build Tool | Vite | Frontend Build |
| Testing | Vitest | Unit/Integration Tests |
| Linting | ESLint + Prettier | Code Quality |
| Containerization | Docker + docker-compose | Deployment |

---

## 📁 Projektstruktur

```
/restreamer-ts
├── /src
│   ├── /core
│   │   ├── /source          # TikTok Source, Source Manager
│   │   ├── /relay           # Delay Buffer, MPEG-TS Relay
│   │   ├── /sink            # YouTube Sink, Sink Manager
│   │   ├── /overlays        # Chat, Clock, Text Overlays
│   │   ├── /supervisor      # Watchdog, Auto-Refresh, Supervisor
│   │   └── /config          # Schema, Loader
│   │
│   ├── /api
│   │   ├── /routes          # REST API Routes
│   │   ├── /middleware      # Authentication, etc.
│   │   └── server.ts        # Fastify Server
│   │
│   ├── /web
│   │   ├── /public
│   │   └── /src             # Vue 3 Frontend
│   │
│   └── /utils              # Helpers (ffmpeg, ytdlp, logger)
│
├── /config                  # Configuration Files
├── /docker                  # Docker Files
├── /logs                    # Log Files
├── /tests                   # Tests
│
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🔧 Kernkomponenten

### 1. Source Layer
**Zweck:** TikTok-Live-Streams als Quelle bereitstellen

- **`BaseSource` Interface**: Abstraktes Interface für alle Quellen
- **`TikTokSource`**: Implementierung für TikTok
  - URL-Auflösung mit `yt-dlp`
  - Qualitätsauswahl (best, 720p, 480p, etc.)
  - Session Handling (TikTok Cookies)
  - Status-Polling (Online/Offline Check)
  - Auto-Retry bei Verbindungsproblemen

### 2. Relay Layer
**Zweck:** MPEG-TS Stream zwischen Quelle und Sink weiterleiten

- **`DelayBuffer`**: Puffer für 30s Delay (einstellbar)
  - Ring-Buffer mit Time-Stamping
  - Gleichmäßige Paketausgabe (Pacing)
  - Kontinuität bei Quellenwechsel
  
- **`MpegTsRelay`**: TCP-Server für Stream-Weiterleitung
  - Einfaches Protokoll: Rohdaten-Forwarding
  - Verbindungsmanagement
  - Mehrere Clients möglich

### 3. Sink Layer
**Zweck:** Stream zu YouTube weiterleiten

- **`YouTubeSink`**: RTMP-Connection zu YouTube
  - ffmpeg Prozess Management
  - Video-Normalisierung (720x1280 oder 1280x720)
  - CBR (Constant Bitrate) für YouTube
  - Filler Frames bei statischen Szenen
  - Monotone Timestamps

### 4. Overlay System
**Zweck:** Overlays in den Stream einfügen

- **`ChatOverlay`**: Chat-Nachrichten aus TokTracker API
  - Delayed Messages (entspricht Delay Buffer)
  - Emoji-Unterstützung
  - Configurierbare Position und Stil
  
- **`ClockOverlay`**: Echtzeit Uhrzeit
  - Configurierbares Format (HH:MM, HH:MM:SS)
  - Configurierbare Position
  
- **`TextOverlay`**: Frei definierbarer Text
  - Laufschrift-Funktion
  - Configurierbare Position und Stil

### 5. Supervisor
**Zweck:** Hauptkontrolle des Systems

- **`Supervisor`**: State Machine für Stream Management
  - Start/Stop/Switch von Streams
  - Verbindung zwischen Quelle und Sink
  - Error Handling
  
- **`Watchdog`**: Überwachung der Verbindung
  - Stall Detection (30s ohne Daten)
  - Bitrate Monitoring
  - Auto-Reconnect
  
- **`AutoRefresh`**: Regelmäßige URL-Aktualisierung
  - Alle 20 Minuten (einstellbar)
  - Nahtloser Wechsel

---

## 📊 Configuration System

### Zod Schema (Type-Safe)

```typescript
// Streamer Configuration
const StreamerSchema = z.object({
  id: z.string(),
  name: z.string(),
  tiktok: z.string(),           // TikTok handle or URL
  youtube_key: z.string().optional(),
  youtube_key_env: z.string().optional(),
  quality: z.enum(['best', '720p', '480p']).default('best'),
  auto_start: z.boolean().default(false),
  preferred: z.boolean().default(false),
  enabled: z.boolean().default(true),
  overlays: z.object({
    chat: z.object({ enabled: z.boolean().default(false), ... }),
    clock: z.object({ enabled: z.boolean().default(false), ... }),
    text: z.object({ enabled: z.boolean().default(false), ... })
  }).default({})
});

// General Settings
const SettingsSchema = z.object({
  delay_buffer: z.object({
    enabled: z.boolean().default(true),
    size: z.number().default(30)         // Sekunden
  }).default({}),
  video: z.object({
    resolution: z.enum(['720x1280', '1280x720']).default('720x1280'),
    fps: z.number().default(25),
    video_bitrate: z.number().default(4000),
    audio_bitrate: z.number().default(128)
  }).default({}),
  watchdog: z.object({
    stall_timeout: z.number().default(30),   // Sekunden
    min_bitrate: z.number().default(500)     // KB/s
  }).default({}),
  auto_refresh: z.object({
    interval: z.number().default(20)          // Minuten
  }).default({})
});
```

### Config Quellen (Priorität)
1. Environment Variables (z.B. `TIKTOK_SESSION_ID`)
2. CLI Arguments
3. YAML/JSON Config Files (`config/streamers.yml`)
4. Defaults

---

## 🌐 Web API (Fastify)

### Endpoints

| **Method** | **Endpoint** | **Beschreibung** |
|------------|--------------|------------------|
| GET | `/api/streamers` | Liste aller Streamer |
| GET | `/api/streamers/:id` | Streamer Details |
| POST | `/api/streamers` | Streamer erstellen |
| PUT | `/api/streamers/:id` | Streamer aktualisieren |
| DELETE | `/api/streamers/:id` | Streamer löschen |
| POST | `/api/streamers/:id/start` | Stream starten |
| POST | `/api/streamers/:id/stop` | Stream stoppen |
| POST | `/api/streamers/:id/switch` | Zu Streamer wechseln |
| GET | `/api/status` | System Status |
| GET | `/api/settings` | Einstellungen laden |
| PUT | `/api/settings` | Einstellungen speichern |
| GET | `/api/logs` | Logs abrufen |
| GET | `/health` | Health Check |

---

## 🎨 Web Dashboard (Vue 3)

### Hauptseiten
- **Dashboard**: Übersicht mit Status-Cards, aktueller Stream, Streamer-Liste
- **Streamer**: Streamer verwalten (hinzufügen, bearbeiten, löschen)
- **Settings**: Konfiguration bearbeiten
- **Logs**: Log-Viewer mit Filter

### Features
- Echtzeit-Updates (Server-Sent Events)
- Responsive Design
- Schnellstart-Funktion (Handle + Key eingeben, Stream starten)
- Status-Indikatoren (Online/Offline, Verbunden, etc.)

---

## 🐳 Docker Setup

### Dockerfile (Multi-stage)
```dockerfile
# Build Stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production Stage
FROM node:20-alpine
WORKDIR /app

# Install ffmpeg and yt-dlp
RUN apk add --no-cache ffmpeg python3 py3-pip
RUN pip3 install yt-dlp

# Copy built files
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/config ./config

# Non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

EXPOSE 3000 12345
HEALTHCHECK --interval=30s --timeout=10s CMD curl -f http://localhost:3000/health
CMD ["node", "dist/main.js"]
```

### docker-compose.yml
```yaml
version: '3.8'
services:
  restreamer-ts:
    build: .
    container_name: restreamer-ts
    restart: unless-stopped
    ports:
      - "3000:3000"   # Web Dashboard
      - "12345:12345" # MPEG-TS Relay
    volumes:
      - ./config:/app/config:rw
      - ./logs:/app/logs:rw
    environment:
      - NODE_ENV=production
      - TIKTOK_SESSION_ID=${TIKTOK_SESSION_ID:-}
      - SERVER_PORT=3000
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

---

## 📦 Dependencies (package.json)

```json
{
  "dependencies": {
    "@fastify/cors": "^8.5.0",
    "@fastify/static": "^6.12.0",
    "fastify": "^4.24.0",
    "js-yaml": "^4.1.0",
    "pino": "^8.17.2",
    "rxjs": "^7.8.1",
    "vue": "^3.4.0",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^20.10.5",
    "@typescript-eslint/eslint-plugin": "^6.15.0",
    "@typescript-eslint/parser": "^6.15.0",
    "@vitejs/plugin-vue": "^5.0.0",
    "eslint": "^8.56.0",
    "eslint-plugin-vue": "^9.19.0",
    "prettier": "^3.1.1",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3",
    "vite": "^5.0.10",
    "vitest": "^1.1.0"
  }
}
```

---

## 🚀 Implementierungs-Roadmap

### Phase 1: Foundation (2-3 Wochen)
- [ ] Projektstruktur einrichten
- [ ] TypeScript Konfiguration
- [ ] Basis Interfaces (Source, Sink, Relay)
- [ ] Logger (Pino)
- [ ] Config System (Zod + YAML)
- [ ] Process Manager für ffmpeg/yt-dlp
- [ ] Einfacher Express/Fastify Server

### Phase 2: Core Streaming (3-4 Wochen)
- [ ] TikTokSource Implementierung
- [ ] YouTubeSink Implementierung
- [ ] DelayBuffer Implementierung
- [ ] MPEG-TS Relay Server
- [ ] Source/Sink Manager
- [ ] Supervisor (State Machine)
- [ ] Watchdog Implementierung
- [ ] Auto-Refresh Logic

### Phase 3: Features (2-3 Wochen)
- [ ] Overlay System (Base)
- [ ] Chat Overlay
- [ ] Clock Overlay
- [ ] Text Overlay
- [ ] Pausenscreen
- [ ] Playlist Support
- [ ] Online-Status Monitoring

### Phase 4: Web Interface (2-3 Wochen)
- [ ] API Routes implementieren
- [ ] Vue 3 Frontend einrichten
- [ ] Dashboard UI
- [ ] Streamer Management UI
- [ ] Settings UI
- [ ] Real-time Updates (SSE)
- [ ] Log Viewer

### Phase 5: Deployment & Polish (1-2 Wochen)
- [ ] Docker Configuration
- [ ] Docker Compose Setup
- [ ] Environment Variables
- [ ] Unit Tests (Vitest)
- [ ] Integration Tests
- [ ] Documentation
- [ ] CI/CD Pipeline

**Gesamt: ~14-18 Wochen (3.5-4.5 Monate)**

---

## 🎯 Feature-Comparison

| Feature | protocatzk/restreamer | restreamer-ts | Status |
|---------|----------------------|---------------|--------|
| TikTok → YouTube | ✅ | ✅ | ✅ |
| MPEG-TS Relay | ✅ | ✅ | ✅ |
| Delay Buffer | ✅ | ✅ | ✅ |
| Auto-Refresh | ✅ | ✅ | ✅ |
| Stall Watchdog | ✅ | ✅ | ✅ |
| Web Dashboard | ✅ | ✅ | ⏳ |
| Chat Overlay | ✅ | ✅ | ⏳ |
| Clock Overlay | ✅ | ✅ | ⏳ |
| Text Overlay | ✅ | ✅ | ⏳ |
| Pausenscreen | ✅ | ✅ | ⏳ |
| Playlists | ✅ | ✅ | ⏳ |
| Online Status | ✅ | ✅ | ⏳ |
| **TypeScript** | ❌ | ✅ | ✅ |
| **Node.js** | ❌ | ✅ | ✅ |
| **Modern Web Tech** | ❌ | ✅ | ✅ |

---

## ❓ Entscheidungen

| Frage | Optionen | Empfehlung |
|-------|----------|-------------|
| Web Framework | Express vs Fastify | **Fastify** (schneller, moderner) |
| Frontend Framework | Vue 3 vs React | **Vue 3** (leicht, gut dokumentiert) |
| State Management | RxJS vs Custom | **RxJS** (reaktiv, gut für Streams) |
| Database | SQLite vs LowDB | **LowDB** (einfach, file-based) |
| Logging | Winston vs Pino | **Pino** (schneller, strukturiert) |
| Chat Overlay | ffmpeg vs Canvas | **Canvas** (flexibler, Emoji-Unterstützung) |

---

## 🔐 Sicherheitshinweise

1. **Stream Keys**: Immer verschlüsselt speichern (Environment Variables)
2. **TikTok Session**: Regelmäßig erneuern
3. **Dashboard**: Authentifizierung aktivieren
4. **RTMP**: Nur auf localhost oder VPN exponieren
5. **Logs**: Keine sensiblen Daten loggen
6. **Docker**: Non-root User verwenden

---

## 📜 Lizenz

MIT License - Siehe [LICENSE](./LICENSE)

---

*Erstellt für die Streaming-Community* 🚀
