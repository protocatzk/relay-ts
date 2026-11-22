<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  closeOmniSearch,
  isOmniSearchOpen,
  useOmniSearchRegistry,
  type OmniSearchItem,
} from '@/src/composables/useOmniSearch';

const router = useRouter();
const { allItems } = useOmniSearchRegistry();

const query = ref('');
const activeIndex = ref(0);
const searchInput = ref<HTMLInputElement | null>(null);
const resultsListRef = ref<HTMLElement | null>(null);

const filteredItems = computed<OmniSearchItem[]>(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) {
    // Default recommendations when search query is empty:
    return allItems.value.slice(0, 15);
  }

  // Score items based on title, keywords and subtitle
  return allItems.value
    .map((item) => {
      let score = 0;
      const lowerTitle = item.title.toLowerCase();
      const lowerSub = item.subtitle?.toLowerCase() ?? '';

      if (lowerTitle === q) score += 100;
      else if (lowerTitle.startsWith(q)) score += 50;
      else if (lowerTitle.includes(q)) score += 30;

      for (const kw of item.keywords) {
        if (kw === q) score += 40;
        else if (kw.startsWith(q)) score += 20;
        else if (kw.includes(q)) score += 10;
      }

      if (lowerSub.includes(q)) score += 5;

      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
});

watch(filteredItems, () => {
  activeIndex.value = 0;
});

watch(isOmniSearchOpen, async (isOpen) => {
  if (isOpen) {
    query.value = '';
    activeIndex.value = 0;
    await nextTick();
    searchInput.value?.focus();
  }
});

function handleSelect(item: OmniSearchItem): void {
  closeOmniSearch();
  void item.action(router);
}

function selectCurrent(): void {
  const current = filteredItems.value[activeIndex.value];
  if (current) {
    handleSelect(current);
  }
}

function scrollActiveIntoView(): void {
  nextTick(() => {
    const list = resultsListRef.value;
    if (!list) return;
    const activeEl = list.children[activeIndex.value] as HTMLElement | undefined;
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  });
}

function onKeydown(e: KeyboardEvent): void {
  // Global Shortcut: Cmd+K / Ctrl+K or / (when not typing in an input)
  if (
    (e.key === 'k' && (e.metaKey || e.ctrlKey)) ||
    (e.key === '/' && !isOmniSearchOpen.value && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement))
  ) {
    e.preventDefault();
    isOmniSearchOpen.value = !isOmniSearchOpen.value;
    return;
  }

  if (!isOmniSearchOpen.value) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    closeOmniSearch();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (filteredItems.value.length > 0) {
      activeIndex.value = (activeIndex.value + 1) % filteredItems.value.length;
      scrollActiveIntoView();
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (filteredItems.value.length > 0) {
      activeIndex.value =
        (activeIndex.value - 1 + filteredItems.value.length) % filteredItems.value.length;
      scrollActiveIntoView();
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    selectCurrent();
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="palette-fade">
      <div
        v-if="isOmniSearchOpen"
        class="omni-backdrop"
        @click.self="closeOmniSearch"
      >
        <div
          class="omni-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="RELAY In-App Universalsuche"
        >
          <!-- Top Input Bar -->
          <div class="omni-input-wrapper">
            <span class="omni-search-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
                <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.8" />
                <path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
              </svg>
            </span>
            <input
              ref="searchInput"
              v-model="query"
              type="text"
              class="omni-input"
              placeholder="Funktion, Einstellung, Streamer, Szene oder Ansicht suchen…"
              autocomplete="off"
              spellcheck="false"
            />
            <button
              v-if="query"
              type="button"
              class="btn-icon omni-clear-btn"
              aria-label="Eingabe löschen"
              @click="query = ''; searchInput?.focus()"
            >
              ✕
            </button>
            <kbd class="omni-kbd hide-xs">ESC</kbd>
          </div>

          <!-- Results List -->
          <div
            ref="resultsListRef"
            class="omni-results"
            role="listbox"
            aria-label="Suchergebnisse"
          >
            <div
              v-for="(item, idx) in filteredItems"
              :key="item.id"
              class="omni-item"
              :class="{ 'is-active': idx === activeIndex }"
              role="option"
              :aria-selected="idx === activeIndex"
              @click="handleSelect(item)"
              @mouseenter="activeIndex = idx"
            >
              <span class="omni-item-icon" aria-hidden="true">{{ item.icon || '🔍' }}</span>

              <div class="omni-item-body">
                <div class="omni-item-title-row">
                  <span class="omni-item-title">{{ item.title }}</span>
                  <span v-if="item.badge" class="badge badge-info omni-badge">{{ item.badge }}</span>
                </div>
                <p v-if="item.subtitle" class="omni-item-subtitle">{{ item.subtitle }}</p>
              </div>

              <span class="omni-category-tag mono">{{ item.categoryLabel }}</span>
            </div>

            <!-- Empty State -->
            <div v-if="filteredItems.length === 0" class="omni-empty">
              <p>Keine Funktionen oder Einstellungen für „{{ query }}“ gefunden.</p>
              <span class="omni-empty-hint">Tipp: Probiere Begriffe wie „Delay“, „Encoder“, „Audio“, „Pause“ oder Streamer-Namen.</span>
            </div>
          </div>

          <!-- Bottom Footer Navigation Hint -->
          <footer class="omni-footer">
            <span class="omni-footer-hint">
              <kbd>↑</kbd> <kbd>↓</kbd> Navigieren · <kbd>↵</kbd> Auswählen · <kbd>ESC</kbd> Schließen
            </span>
            <span class="omni-footer-count mono">
              {{ filteredItems.length }} Treffer
            </span>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.omni-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(4px);
  z-index: 9999;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 4rem 1rem 2rem;
}

.omni-dialog {
  background: var(--bg-card, #141414);
  border: 1px solid var(--border-color, #333);
  border-radius: 6px;
  width: 100%;
  max-width: 640px;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-height: 80vh;
}

.omni-input-wrapper {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.85rem 1.1rem;
  border-bottom: 1px solid var(--border-color, #282828);
  background: var(--bg-surface, #1c1c1c);
}

.omni-search-icon {
  color: var(--color-accent, #38bdf8);
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.omni-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 1.05rem;
  color: var(--text-primary, #fff);
  padding: 0;
  box-shadow: none;
}

.omni-input::placeholder {
  color: var(--text-muted, #777);
  font-size: 0.95rem;
}

.omni-clear-btn {
  background: transparent;
  border: none;
  color: var(--text-muted, #888);
  font-size: 0.85rem;
  cursor: pointer;
  padding: 0.2rem 0.4rem;
}

.omni-kbd {
  font-family: var(--font-mono, monospace);
  font-size: 0.7rem;
  padding: 0.15rem 0.45rem;
  border-radius: 3px;
  border: 1px solid var(--border-color, #444);
  background: var(--bg-surface-elevated, #2a2a2a);
  color: var(--text-muted, #aaa);
}

.omni-results {
  flex: 1;
  overflow-y: auto;
  padding: 0.4rem 0;
  max-height: 52vh;
}

.omni-item {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.65rem 1.1rem;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: all 0.1s ease;
}

.omni-item:hover,
.omni-item.is-active {
  background: rgba(56, 189, 248, 0.08);
  border-left-color: var(--color-accent, #38bdf8);
}

.omni-item-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
}

.omni-item-body {
  flex: 1;
  min-width: 0;
}

.omni-item-title-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.omni-item-title {
  font-weight: 600;
  font-size: 0.92rem;
  color: var(--text-primary, #f0f0f0);
}

.omni-item.is-active .omni-item-title {
  color: var(--color-accent, #38bdf8);
}

.omni-badge {
  font-size: 0.65rem;
  padding: 0.1rem 0.35rem;
}

.omni-item-subtitle {
  margin: 0.15rem 0 0;
  font-size: 0.78rem;
  color: var(--text-muted, #888);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.omni-category-tag {
  font-size: 0.68rem;
  padding: 0.15rem 0.45rem;
  border-radius: 3px;
  background: var(--bg-surface, #1e1e1e);
  color: var(--text-muted, #777);
  border: 1px solid var(--border-color, #2c2c2c);
  text-transform: uppercase;
}

.omni-empty {
  padding: 2.5rem 1.5rem;
  text-align: center;
  color: var(--text-muted, #888);
}

.omni-empty-hint {
  display: block;
  font-size: 0.8rem;
  color: var(--text-muted, #666);
  margin-top: 0.5rem;
}

.omni-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 1.1rem;
  border-top: 1px solid var(--border-color, #262626);
  background: var(--bg-surface, #161616);
  font-size: 0.75rem;
  color: var(--text-muted, #777);
}

.omni-footer-hint kbd {
  font-family: var(--font-mono, monospace);
  padding: 0.1rem 0.3rem;
  border-radius: 2px;
  border: 1px solid var(--border-color, #444);
  background: var(--bg-surface-elevated, #242424);
  font-size: 0.68rem;
}

.palette-fade-enter-active,
.palette-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.palette-fade-enter-from,
.palette-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
