<script setup lang="ts">
import { ref, computed } from 'vue';
import type { McpSettings } from '@/src/api/types';
import ToggleField from '@/src/components/ToggleField.vue';

const props = defineProps<{
  mcp: McpSettings;
  dirty: boolean;
  saving: boolean;
  busySaving: boolean;
}>();

defineEmits<{
  (e: 'save'): void;
}>();

const copied = ref(false);

const sseUrl = computed(() => {
  return `${window.location.origin}/api/mcp/sse`;
});

const mcpClientConfigJson = computed(() => {
  return JSON.stringify(
    {
      mcpServers: {
        relay: {
          url: sseUrl.value,
        },
      },
    },
    null,
    2,
  );
});

async function copyConfig(): Promise<void> {
  try {
    await navigator.clipboard.writeText(mcpClientConfigJson.value);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    // clipboard best-effort
  }
}
</script>

<template>
  <section id="settings-mcp" class="card settings-section" tabindex="-1">
    <div class="card-head">
      <div>
        <h2 class="card-title">Model Context Protocol (MCP) Server</h2>
        <p class="card-sub">
          Ermöglicht externen KI-Agenten (Claude Desktop, Cursor, Antigravity, LLM-Tools) die Steuerung und Statusabfrage von RELAY via standardisiertem MCP.
        </p>
      </div>
      <div class="settings-section-actions">
        <span class="badge" :class="mcp.enabled ? 'tone-success' : 'tone-muted'">
          {{ mcp.enabled ? 'MCP aktiv' : 'MCP deaktiviert' }}
        </span>
        <button
          type="button"
          class="btn btn-sm btn-primary"
          :disabled="!dirty || busySaving"
          @click="$emit('save')"
        >
          {{ saving ? 'Speichert…' : 'Speichern' }}
        </button>
      </div>
    </div>

    <div class="card-body form-grid">
      <div class="form-row">
        <label for="mcp-enabled" class="form-label">MCP-Server aktivieren</label>
        <div class="form-control-wrap">
          <ToggleField
            id="mcp-enabled"
            v-model="mcp.enabled"
            label="Aktivieren"
            description="Stellt den SSE-Transport unter /api/mcp/sse bereit."
          />
        </div>
      </div>

      <div class="form-row">
        <label for="mcp-server-name" class="form-label">Server-Name</label>
        <div class="form-control-wrap">
          <input
            id="mcp-server-name"
            v-model="mcp.server_name"
            type="text"
            class="input"
            placeholder="relay-mcp-server"
            :disabled="!mcp.enabled"
          />
          <p class="form-hint">
            Name, mit dem sich der MCP-Server gegenüber KI-Clients identifiziert.
          </p>
        </div>
      </div>

      <div class="form-row">
        <label for="mcp-destructive" class="form-label">Destruktive Tools erlauben</label>
        <div class="form-control-wrap">
          <ToggleField
            id="mcp-destructive"
            v-model="mcp.allow_destructive"
            :disabled="!mcp.enabled"
            label="Aktionen erlauben"
            description="Erlaubt Agenten das Starten/Stoppen von Streams, Umschalten von Playlists/Szenen und Ändern der Regie-Queue. Wenn deaktiviert, stehen nur Status-, List- und Lese-Tools bereit."
          />
        </div>
      </div>

      <div class="form-row">
        <label for="mcp-require-auth" class="form-label">Authentifizierung erzwingen</label>
        <div class="form-control-wrap">
          <ToggleField
            id="mcp-require-auth"
            v-model="mcp.require_auth"
            :disabled="!mcp.enabled"
            label="Auth erforderlich"
            description="Erfordert bei MCP-SSE-Anfragen einen gültigen API-Token oder eine Session."
          />
        </div>
      </div>

      <div class="form-row">
        <label class="form-label">Client-Konfiguration</label>
        <div class="form-control-wrap">
          <div class="mcp-endpoint-box">
            <div class="mcp-url-line">
              <span class="mcp-label">SSE-Endpunkt:</span>
              <code class="mcp-code">{{ sseUrl }}</code>
            </div>
            <div class="mcp-snippet-wrap">
              <pre class="mcp-snippet"><code>{{ mcpClientConfigJson }}</code></pre>
              <button
                type="button"
                class="btn btn-xs btn-outline mcp-copy-btn"
                @click="copyConfig"
              >
                {{ copied ? 'Kopiert!' : 'Konfiguration kopieren' }}
              </button>
            </div>
          </div>
          <p class="form-hint">
            Füge diese Konfiguration in die Konfigurationsdatei deines MCP-Clients (z. B. <code>claude_desktop_config.json</code>) ein.
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.mcp-endpoint-box {
  background: var(--bg-surface-soft, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
  border-radius: var(--radius-md, 8px);
  padding: 0.75rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.mcp-url-line {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  flex-wrap: wrap;
}

.mcp-label {
  font-weight: 500;
  color: var(--text-muted);
}

.mcp-code {
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  background: var(--bg-code, rgba(0, 0, 0, 0.25));
  font-family: var(--font-mono, monospace);
  font-size: 0.82rem;
  word-break: break-all;
}

.mcp-snippet-wrap {
  position: relative;
  margin-top: 0.25rem;
}

.mcp-snippet {
  margin: 0;
  padding: 0.75rem;
  background: var(--bg-code, rgba(0, 0, 0, 0.3));
  border-radius: 6px;
  font-family: var(--font-mono, monospace);
  font-size: 0.8rem;
  overflow-x: auto;
}

.mcp-copy-btn {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
}
</style>
