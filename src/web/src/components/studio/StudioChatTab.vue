<script setup lang="ts">
import ColorInput from '@/src/components/ColorInput.vue';
import StudioGroup from '@/src/components/StudioGroup.vue';
import ToggleField from '@/src/components/ToggleField.vue';
import type { ChatOverlay } from '@/src/api/types';
import type { Section } from '@/src/overlay-studio';

interface ChatTestModel {
  username: string;
  text: string;
}

defineProps<{
  chat: ChatOverlay;
  chatTest: ChatTestModel;
  positions: { value: string; label: string }[];
  sendingTest: boolean;
  panelId: string;
  tabId: string;
  groupOpen: (section: Section, name: string, fallbackIdx: number) => boolean;
}>();

defineEmits<{
  (e: 'setGroupOpen', section: Section, name: string, open: boolean): void;
  (e: 'sendTest'): void;
}>();
</script>

<template>
  <div
    :id="panelId"
    role="tabpanel"
    :aria-labelledby="tabId"
    tabindex="0"
    class="studio-body"
  >
    <ToggleField v-model="chat.enabled" label="Chat-Overlay" />

    <StudioGroup
      title="Erscheinungsbild"
      :open="groupOpen('chat', 'look', 0)"
      @update:open="$emit('setGroupOpen', 'chat', 'look', $event)"
    >
      <div class="studio-grid">
        <div class="field">
          <label for="studio-chat-engine">Engine</label>
          <select id="studio-chat-engine" v-model="chat.engine">
            <option value="canvas">Canvas (modern)</option>
            <option value="drawtext">drawtext (Legacy)</option>
          </select>
          <p class="field-hint">Canvas bietet weiche Übergänge und Badges.</p>
        </div>
        <div class="field">
          <label for="studio-chat-layout-mode">Layout-Modell</label>
          <select id="studio-chat-layout-mode" v-model="chat.layout_mode">
            <option value="standard">Standard (frei positionierbar)</option>
            <option value="glass_minimal">Glass Minimal (modernes Broadcast-HUD)</option>
            <option value="ultra_clean">Ultra Clean (ohne Boxen, nur Typografie)</option>
          </select>
          <p class="field-hint">Glass Minimal &amp; Ultra Clean cachen statische Layer für minimale CPU-Last.</p>
        </div>
        <div class="field">
          <label for="studio-chat-style">Stil</label>
          <select id="studio-chat-style" v-model="chat.style">
            <option value="bubbles">Sprechblasen</option>
            <option value="panel">Nachrichten-Panel</option>
            <option value="minimal">Minimalistisch</option>
          </select>
        </div>
        <div class="field">
          <label for="studio-chat-fps">Render-FPS</label>
          <input id="studio-chat-fps" v-model.number="chat.render_fps" type="number" min="5" max="30" />
        </div>
        <div class="field">
          <label for="studio-chat-opacity">Blasen-Deckkraft (%)</label>
          <input
            id="studio-chat-opacity"
            v-model.number="chat.bubble_opacity"
            type="range"
            min="0"
            max="100"
            step="5"
          />
          <p class="field-hint mono">{{ chat.bubble_opacity }} %</p>
        </div>
        <div v-if="chat.layout_mode === 'glass_minimal' || chat.layout_mode === 'ultra_clean'" class="checkbox-grid studio-checks" style="grid-column: 1 / -1; margin-top: 0.5rem;">
          <label class="checkbox">
            <input v-model="chat.top_banner_enabled" type="checkbox" /> Status-Leiste (Live, Streamer &amp; Uptime)
          </label>
          <label class="checkbox">
            <input v-model="chat.chat_monitor_enabled" type="checkbox" /> Chat-Bereich
          </label>
          <label class="checkbox">
            <input v-model="chat.banner_show_stats" type="checkbox" /> Statistiken &amp; Einnahmen
          </label>
          <label class="checkbox">
            <input v-model="chat.banner_show_goal" type="checkbox" /> Spendenziel-Balken
          </label>
        </div>
      </div>
    </StudioGroup>

    <StudioGroup
      title="Layout & Begrenzungen"
      :open="groupOpen('chat', 'layout', 1)"
      @update:open="$emit('setGroupOpen', 'chat', 'layout', $event)"
    >
      <div class="studio-grid">
        <div class="field">
          <label for="studio-chat-position">Position</label>
          <select id="studio-chat-position" v-model="chat.position">
            <option v-for="position in positions" :key="position.value" :value="position.value">
              {{ position.label }}
            </option>
          </select>
        </div>
        <div class="field">
          <label for="studio-chat-font-size">Schriftgröße (px)</label>
          <input id="studio-chat-font-size" v-model.number="chat.font_size" type="number" min="10" max="64" />
        </div>
        <div class="field">
          <label for="studio-chat-max-lines">Max. Zeilen / Nachricht</label>
          <input id="studio-chat-max-lines" v-model.number="chat.max_lines" type="number" min="1" max="10" />
        </div>
        <div class="field">
          <label for="studio-chat-max-messages">Max. Nachrichten</label>
          <input id="studio-chat-max-messages" v-model.number="chat.max_messages" type="number" min="1" max="20" />
        </div>
        <div class="field">
          <label for="studio-chat-max-age">Max. Alter (Sekunden)</label>
          <input id="studio-chat-max-age" v-model.number="chat.max_age_seconds" type="number" min="0" max="120" />
          <p class="field-hint">0 = Nachrichten bleiben dauerhaft sichtbar</p>
        </div>
        <div class="field">
          <label for="studio-chat-width">Panel-Breite (px)</label>
          <input id="studio-chat-width" v-model.number="chat.panel_width" type="number" min="0" max="1920" />
          <p class="field-hint">0 = automatische Breite (ca. 60 % bei Querformat, 92 % bei Hochformat)</p>
        </div>
        <div class="field">
          <label for="studio-chat-height">Panel-Höhe (px)</label>
          <input id="studio-chat-height" v-model.number="chat.panel_height" type="number" min="0" max="1920" />
          <p class="field-hint">0 = automatisch (ca. ein Drittel der Bildhöhe)</p>
        </div>
      </div>
    </StudioGroup>

    <StudioGroup
      title="Farben & Elemente"
      :open="groupOpen('chat', 'colors', 2)"
      @update:open="$emit('setGroupOpen', 'chat', 'colors', $event)"
    >
      <div class="studio-grid">
        <div class="field">
          <label for="studio-chat-font-color">Schriftfarbe</label>
          <ColorInput id="studio-chat-font-color" v-model="chat.font_color" />
        </div>
        <div class="field">
          <label for="studio-chat-box-color">Hintergrundfarbe</label>
          <ColorInput id="studio-chat-box-color" v-model="chat.box_color" alpha />
        </div>
      </div>
      <div class="checkbox-grid studio-checks">
        <label class="checkbox"><input v-model="chat.show_timestamps" type="checkbox" /> Zeitstempel anzeigen</label>
        <label class="checkbox"><input v-model="chat.show_badges" type="checkbox" /> Badges anzeigen</label>
        <label class="checkbox"><input v-model="chat.show_tiers" type="checkbox" /> Tier-Level anzeigen</label>
        <label class="checkbox"><input v-model="chat.show_stats" type="checkbox" /> Stats-Bar anzeigen</label>
        <label class="checkbox"><input v-model="chat.show_earnings_card" type="checkbox" /> Einnahmen-Karten einblenden</label>
        <label class="checkbox"><input v-model="chat.name_colors" type="checkbox" /> Farbige Nutzernamen</label>
      </div>
      <div v-if="chat.show_earnings_card" class="field" style="margin-top: 0.75rem;">
        <label for="studio-chat-earnings-interval">Einnahmen-Intervall (Sekunden)</label>
        <input
          id="studio-chat-earnings-interval"
          v-model.number="chat.earnings_card_interval_seconds"
          type="number"
          min="10"
          max="3600"
        />
        <p class="field-hint">Wie oft die Einnahmen-Zusammenfassung als Chat-Karte eingeblendet wird.</p>
      </div>
    </StudioGroup>

    <StudioGroup
      title="Queue-Anzeige"
      :open="groupOpen('chat', 'queue', 2)"
      @update:open="$emit('setGroupOpen', 'chat', 'queue', $event)"
    >
      <div class="checkbox-grid studio-checks">
        <label class="checkbox">
          <input v-model="chat.queue_enabled" type="checkbox" />
          Regie-Queue im Chat-Overlay anzeigen
        </label>
      </div>
      <template v-if="chat.queue_enabled">
        <div class="studio-grid" style="margin-top: 0.75rem;">
          <div class="field">
            <label for="studio-chat-queue-max">Einträge</label>
            <input
              id="studio-chat-queue-max"
              v-model.number="chat.queue_max_entries"
              type="number"
              min="1"
              max="10"
            />
            <p class="field-hint">Laufender Eintrag mittig, davor/danach die nächsten.</p>
          </div>
          <div class="field">
            <label for="studio-chat-queue-font-size">Schriftgröße (px, 0 = automatisch)</label>
            <input
              id="studio-chat-queue-font-size"
              v-model.number="chat.queue_font_size"
              type="number"
              min="0"
              max="72"
            />
          </div>
          <div class="field">
            <label for="studio-chat-queue-offset-x">Feinjustierung X (px)</label>
            <input
              id="studio-chat-queue-offset-x"
              v-model.number="chat.queue_offset_x"
              type="number"
              min="-1920"
              max="1920"
            />
          </div>
          <div class="field">
            <label for="studio-chat-queue-offset-y">Feinjustierung Y (px)</label>
            <input
              id="studio-chat-queue-offset-y"
              v-model.number="chat.queue_offset_y"
              type="number"
              min="-1080"
              max="1080"
            />
          </div>
          <div class="field">
            <label for="studio-chat-queue-font-color">Textfarbe</label>
            <ColorInput id="studio-chat-queue-font-color" v-model="chat.queue_font_color" />
          </div>
          <div class="field">
            <label for="studio-chat-queue-active-color">Farbe des laufenden Eintrags</label>
            <ColorInput id="studio-chat-queue-active-color" v-model="chat.queue_active_color" />
          </div>
          <div class="field">
            <label for="studio-chat-queue-box-color">Hintergrund</label>
            <ColorInput id="studio-chat-queue-box-color" v-model="chat.queue_box_color" alpha />
          </div>
        </div>
        <div class="checkbox-grid studio-checks">
          <label class="checkbox">
            <input v-model="chat.queue_show_box" type="checkbox" />
            Hintergrundbox anzeigen
          </label>
        </div>
        <p class="field-hint">
          Standard-Layout: unterhalb des Chats im Panel. Säulen-Monitor: mittig im Bild.
          Format: <code class="mono">Streamer 1 → Streamer 2 → aktuell → Streamer 3 …</code>
          — X/Y verschiebt die Leiste frei.
        </p>
      </template>
    </StudioGroup>

    <StudioGroup
      title="Datenquelle & Verbindung"
      :open="groupOpen('chat', 'source', 3)"
      @update:open="$emit('setGroupOpen', 'chat', 'source', $event)"
    >
      <div class="studio-grid">
        <div class="field">
          <label for="studio-chat-api-url">API-URL</label>
          <input id="studio-chat-api-url" v-model="chat.api_url" type="text" placeholder="https://..." />
        </div>
        <div class="field">
          <label for="studio-chat-poll-interval">Poll-Intervall (ms)</label>
          <input id="studio-chat-poll-interval" v-model.number="chat.poll_interval" type="number" min="500" max="10000" />
        </div>
        <div class="field">
          <label for="studio-chat-delay">Chat-Verzögerung (Sekunden)</label>
          <input
            id="studio-chat-delay"
            v-model.number="chat.delay"
            type="number"
            min="0"
            max="120"
            step="0.5"
          />
          <p class="field-hint">
            Verzögert die Chat-Anzeige relativ zum Stream-Delay, um Chat und Video zu synchronisieren.
          </p>
        </div>
      </div>
    </StudioGroup>

    <StudioGroup
      title="Testnachricht senden"
      :open="groupOpen('chat', 'test', 4)"
      @update:open="$emit('setGroupOpen', 'chat', 'test', $event)"
    >
      <form class="studio-grid" @submit.prevent="$emit('sendTest')">
        <div class="field">
          <label for="studio-test-username">Benutzername</label>
          <input id="studio-test-username" v-model="chatTest.username" type="text" maxlength="40" />
        </div>
        <div class="field">
          <label for="studio-test-text">Nachricht</label>
          <input id="studio-test-text" v-model="chatTest.text" type="text" maxlength="300" />
        </div>
        <button type="submit" class="btn btn-secondary" :disabled="sendingTest || !chatTest.text.trim()">
          <span v-if="sendingTest" class="spinner" aria-hidden="true"></span>
          Senden
        </button>
      </form>
      <p class="field-hint">Sendet an den aktiven Stream, nicht an die Studio-Vorschau.</p>
    </StudioGroup>
  </div>
</template>
