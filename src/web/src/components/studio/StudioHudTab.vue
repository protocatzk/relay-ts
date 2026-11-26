<script setup lang="ts">
import type { ChatOverlay } from '@/src/api/types';
import { POSITIONS } from '@/src/overlay-studio';
import type { OverlayPosition, Section } from '@/src/overlay-studio';
import StudioGroup from '@/src/components/StudioGroup.vue';

const props = defineProps<{
  section: Extract<Section, 'status' | 'queue' | 'earnings_hud'>;
  chat: ChatOverlay;
  groupOpen: (section: Section, id: string, index: number) => boolean;
}>();

const emit = defineEmits<{
  setGroupOpen: [section: Section, id: string, open: boolean];
}>();

function setPos(pos: OverlayPosition): void {
  if (props.section === 'status') {
    props.chat.status_position = pos;
    props.chat.status_offset_x = 0;
    props.chat.status_offset_y = 0;
  } else if (props.section === 'queue') {
    props.chat.queue_position = pos;
    props.chat.queue_offset_x = 0;
    props.chat.queue_offset_y = 0;
  } else {
    props.chat.earnings_hud_position = pos;
    props.chat.earnings_hud_offset_x = 0;
    props.chat.earnings_hud_offset_y = 0;
  }
}
</script>

<template>
  <!-- STATUS-PILL -->
  <div v-if="section === 'status'" class="studio-groups">
    <StudioGroup
      title="Status-Pill (Live · Streamer · Uptime)"
      :open="groupOpen('status', 'main', 0)"
      @update:open="emit('setGroupOpen', 'status', 'main', $event)"
    >
      <div class="checkbox-grid studio-checks">
        <label class="checkbox">
          <input v-model="chat.top_banner_enabled" type="checkbox" /> Status-Pill anzeigen
        </label>
      </div>
      <div class="studio-grid" style="margin-top: 0.75rem">
        <div class="field">
          <label for="studio-status-pos">Anker-Position</label>
          <select
            id="studio-status-pos"
            :value="chat.status_position ?? 'top-left'"
            @change="setPos(($event.target as HTMLSelectElement).value as OverlayPosition)"
          >
            <option v-for="pos in POSITIONS" :key="pos.value" :value="pos.value">
              {{ pos.label }}
            </option>
          </select>
        </div>
        <div class="field">
          <label for="studio-status-size">Schriftgröße (px, 0 = auto)</label>
          <input
            id="studio-status-size"
            v-model.number="chat.status_font_size"
            type="number"
            min="0"
            max="72"
          />
        </div>
        <div class="field">
          <label for="studio-status-ox">Offset X (px)</label>
          <input
            id="studio-status-ox"
            v-model.number="chat.status_offset_x"
            type="number"
            min="-1920"
            max="1920"
          />
        </div>
        <div class="field">
          <label for="studio-status-oy">Offset Y (px)</label>
          <input
            id="studio-status-oy"
            v-model.number="chat.status_offset_y"
            type="number"
            min="-1080"
            max="1080"
          />
        </div>
      </div>
    </StudioGroup>
  </div>

  <!-- QUEUE-PILL -->
  <div v-else-if="section === 'queue'" class="studio-groups">
    <StudioGroup
      title="Regie-Queue im Stream"
      :open="groupOpen('queue', 'main', 0)"
      @update:open="emit('setGroupOpen', 'queue', 'main', $event)"
    >
      <div class="checkbox-grid studio-checks">
        <label class="checkbox">
          <input v-model="chat.queue_enabled" type="checkbox" /> Queue-Leiste anzeigen
        </label>
        <label class="checkbox">
          <input v-model="chat.queue_show_box" type="checkbox" /> Box-Hintergrund
        </label>
      </div>
      <div class="studio-grid" style="margin-top: 0.75rem">
        <div class="field">
          <label for="studio-queue-pos">Anker-Position</label>
          <select
            id="studio-queue-pos"
            :value="chat.queue_position ?? 'bottom-right'"
            @change="setPos(($event.target as HTMLSelectElement).value as OverlayPosition)"
          >
            <option v-for="pos in POSITIONS" :key="pos.value" :value="pos.value">
              {{ pos.label }}
            </option>
          </select>
        </div>
        <div class="field">
          <label for="studio-queue-entries">Max. Einträge</label>
          <input
            id="studio-queue-entries"
            v-model.number="chat.queue_max_entries"
            type="number"
            min="1"
            max="10"
          />
        </div>
        <div class="field">
          <label for="studio-queue-width">Breite (px, 0 = auto)</label>
          <input
            id="studio-queue-width"
            v-model.number="chat.queue_width"
            type="number"
            min="0"
            max="1920"
          />
        </div>
        <div class="field">
          <label for="studio-queue-size">Schriftgröße (px, 0 = auto)</label>
          <input
            id="studio-queue-size"
            v-model.number="chat.queue_font_size"
            type="number"
            min="0"
            max="72"
          />
        </div>
        <div class="field">
          <label for="studio-queue-ox">Offset X (px)</label>
          <input
            id="studio-queue-ox"
            v-model.number="chat.queue_offset_x"
            type="number"
            min="-1920"
            max="1920"
          />
        </div>
        <div class="field">
          <label for="studio-queue-oy">Offset Y (px)</label>
          <input
            id="studio-queue-oy"
            v-model.number="chat.queue_offset_y"
            type="number"
            min="-1080"
            max="1080"
          />
        </div>
        <div class="field">
          <label for="studio-queue-active-color">Akzentfarbe (Aktiv)</label>
          <input id="studio-queue-active-color" v-model="chat.queue_active_color" type="text" />
        </div>
        <div class="field">
          <label for="studio-queue-font-color">Textfarbe</label>
          <input id="studio-queue-font-color" v-model="chat.queue_font_color" type="text" />
        </div>
      </div>
    </StudioGroup>
  </div>

  <!-- EARNINGS-HUD -->
  <div v-else class="studio-groups">
    <StudioGroup
      title="Einnahmen-HUD (Coins · Betrag · Zielbalken)"
      :open="groupOpen('earnings_hud', 'main', 0)"
      @update:open="emit('setGroupOpen', 'earnings_hud', 'main', $event)"
    >
      <div class="checkbox-grid studio-checks">
        <label class="checkbox">
          <input v-model="chat.banner_show_stats" type="checkbox" /> Einnahmen-Pill anzeigen
        </label>
        <label class="checkbox">
          <input v-model="chat.banner_show_goal" type="checkbox" /> Spendenziel-Balken anzeigen
        </label>
      </div>
      <div class="studio-grid" style="margin-top: 0.75rem">
        <div class="field">
          <label for="studio-ehud-pos">Anker-Position</label>
          <select
            id="studio-ehud-pos"
            :value="chat.earnings_hud_position ?? 'top-right'"
            @change="setPos(($event.target as HTMLSelectElement).value as OverlayPosition)"
          >
            <option v-for="pos in POSITIONS" :key="pos.value" :value="pos.value">
              {{ pos.label }}
            </option>
          </select>
        </div>
        <div class="field">
          <label for="studio-ehud-size">Schriftgröße (px, 0 = auto)</label>
          <input
            id="studio-ehud-size"
            v-model.number="chat.earnings_hud_font_size"
            type="number"
            min="0"
            max="72"
          />
        </div>
        <div class="field">
          <label for="studio-ehud-ox">Offset X (px)</label>
          <input
            id="studio-ehud-ox"
            v-model.number="chat.earnings_hud_offset_x"
            type="number"
            min="-1920"
            max="1920"
          />
        </div>
        <div class="field">
          <label for="studio-ehud-oy">Offset Y (px)</label>
          <input
            id="studio-ehud-oy"
            v-model.number="chat.earnings_hud_offset_y"
            type="number"
            min="-1080"
            max="1080"
          />
        </div>
      </div>
    </StudioGroup>
  </div>
</template>
