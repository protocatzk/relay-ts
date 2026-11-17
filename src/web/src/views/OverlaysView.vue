<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { api, errorMessage } from '@/src/api/client';
import { useStore } from '@/src/composables/useStore';
import { useToast } from '@/src/composables/useToast';

const { store, refreshStatus } = useStore();
const { pushToast } = useToast();

const sample = ref(false);
const previewUrl = ref(api.overlays.previewUrl(true));
const sending = ref(false);
const chat = reactive({ username: 'Testuser', text: 'Das Overlay sieht gut aus! 🔥' });
let timer: number | null = null;

const chatStatus = computed(() => store.status?.chat ?? null);

function refreshPreview(): void {
  previewUrl.value = api.overlays.previewUrl(sample.value);
}

watch(sample, refreshPreview);

async function sendTest(): Promise<void> {
  if (!chat.text.trim()) return;
  sending.value = true;
  try {
    await api.chat.test(chat.username.trim() || 'Testuser', chat.text.trim());
    await refreshStatus();
    refreshPreview();
    pushToast('Testnachricht an das Overlay gesendet.', 'success');
  } catch (error) {
    pushToast(errorMessage(error), 'error');
  } finally {
    sending.value = false;
  }
}

onMounted(() => {
  refreshPreview();
  timer = window.setInterval(refreshPreview, 3000);
});

onBeforeUnmount(() => {
  if (timer !== null) window.clearInterval(timer);
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Overlay-Studio</h1>
        <p class="page-sub">Chat-Engine, Live-Vorschau und Testnachrichten.</p>
      </div>
      <div class="page-actions">
        <span v-if="chatStatus?.canvas_active" class="badge tone-success">Canvas aktiv</span>
        <span v-else class="badge tone-neutral">Keine Canvas-Engine aktiv</span>
        <RouterLink to="/settings" class="btn btn-ghost btn-sm">Chat-API</RouterLink>
      </div>
    </div>

    <div class="overlay-studio-grid">
      <section class="card overlay-preview-card">
        <div class="card-head">
          <div>
            <h2 class="card-title">Live-Vorschau</h2>
            <p class="card-sub">So sieht das Chat-Overlay im Stream aus.</p>
          </div>
          <label class="checkbox">
            <input v-model="sample" type="checkbox" />
            Beispielnachrichten
          </label>
        </div>
        <div class="overlay-preview-stage">
          <img :src="previewUrl" alt="Vorschau des Chat-Overlays" />
        </div>
        <p class="muted small">
          Die Vorschau wird alle 3 Sekunden aktualisiert. Die Engine rendert nur den Chat-Bereich
          und speist ihn als zweiten ffmpeg-Input ein – Nachrichten erscheinen ohne Encoder-Neustart.
        </p>
      </section>

      <section class="card">
        <div class="card-head">
          <div>
            <h2 class="card-title">Status</h2>
            <p class="card-sub">Aktive Chat-Engine und Nachrichten.</p>
          </div>
        </div>
        <dl class="settings-summary">
          <div><dt>Overlay</dt><dd>{{ chatStatus?.enabled ? 'Aktiv' : 'Aus' }}</dd></div>
          <div><dt>Engine</dt><dd>{{ chatStatus?.engine ?? '–' }}</dd></div>
          <div><dt>Nachrichten</dt><dd>{{ chatStatus?.messages ?? 0 }}</dd></div>
          <div><dt>Chat-API</dt><dd>{{ chatStatus?.api_configured ? 'Konfiguriert' : 'Fehlt' }}</dd></div>
          <div><dt>Letzte Nachricht</dt><dd class="mono">{{ chatStatus?.last_message_at ?? '–' }}</dd></div>
        </dl>
        <p class="muted small">
          Der Chat wird um die Delay-Buffer-Größe verzögert, damit er zum Videobild passt.
        </p>
      </section>

      <section class="card">
        <div class="card-head">
          <div>
            <h2 class="card-title">Testnachricht</h2>
            <p class="card-sub">Direkt in die laufende Vorschau einspeisen.</p>
          </div>
        </div>
        <form class="stack" @submit.prevent="sendTest">
          <div class="field">
            <label for="test-chat-user">Benutzername</label>
            <input id="test-chat-user" v-model="chat.username" type="text" maxlength="40" />
          </div>
          <div class="field">
            <label for="test-chat-text">Nachricht</label>
            <textarea id="test-chat-text" v-model="chat.text" rows="3" maxlength="300"></textarea>
          </div>
          <button type="submit" class="btn btn-primary" :disabled="sending || !chat.text.trim()">
            <span v-if="sending" class="spinner" aria-hidden="true"></span>
            Nachricht senden
          </button>
        </form>
        <p class="field-hint">
          Die Testnachricht wird nicht an YouTube oder TikTok gesendet, sondern nur lokal gerendert.
        </p>
      </section>
    </div>
  </div>
</template>
