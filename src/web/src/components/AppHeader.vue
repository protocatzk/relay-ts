<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import LiveMenu from '@/src/components/LiveMenu.vue';
import TikTokAccountSwitcher from '@/src/components/TikTokAccountSwitcher.vue';
import { openOmniSearch } from '@/src/composables/useOmniSearch';
import { useTikTokAccounts } from '@/src/composables/useTikTokAccounts';
import { logout, useStore } from '@/src/composables/useStore';
import { pushToast } from '@/src/composables/useToast';
import { useTheme } from '@/src/composables/useTheme';
import { usePwa } from '@/src/composables/usePwa';

const router = useRouter();
const { store } = useStore();
const { theme, preference, themeLabel, toggleTheme } = useTheme();
const { state: pwaState, promptInstall } = usePwa();
const { activeAccount } = useTikTokAccounts();

const accountSwitcherRef = ref<InstanceType<typeof TikTokAccountSwitcher> | null>(null);
const mobileMenuOpen = ref(false);
const mobileMenuPanel = ref<HTMLElement | null>(null);
const mobileMenuTrigger = ref<HTMLButtonElement | null>(null);

async function handleInstall(): Promise<void> {
  mobileMenuOpen.value = false;
  if (pwaState.isIos) {
    pushToast('Öffne das Teilen-Menü und tippe „Zum Home-Bildschirm“.', 'info');
    return;
  }
  const installed = await promptInstall();
  if (installed) pushToast('RELAY wurde installiert.', 'success');
}

async function handleLogout(): Promise<void> {
  mobileMenuOpen.value = false;
  await logout();
  pushToast('Erfolgreich abgemeldet.', 'info');
  await router.replace({ name: 'login' });
}

function openMobileAccountSwitcher(): void {
  mobileMenuOpen.value = false;
  accountSwitcherRef.value?.openDialog();
}

function navigateToDeck(): void {
  mobileMenuOpen.value = false;
  void router.push('/deck');
}

function handleMobileThemeToggle(): void {
  toggleTheme();
}

function toggleMobileMenu(): void {
  mobileMenuOpen.value = !mobileMenuOpen.value;
}

function closeMobileMenu(): void {
  mobileMenuOpen.value = false;
}

function onDocumentPointerDown(event: MouseEvent): void {
  if (!mobileMenuOpen.value) return;
  const target = event.target as Node | null;
  if (
    mobileMenuPanel.value?.contains(target) ||
    mobileMenuTrigger.value?.contains(target)
  ) {
    return;
  }
  closeMobileMenu();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && mobileMenuOpen.value) {
    event.stopPropagation();
    closeMobileMenu();
    mobileMenuTrigger.value?.focus();
  }
}

watch(mobileMenuOpen, async (isOpen) => {
  if (isOpen) {
    document.addEventListener('mousedown', onDocumentPointerDown);
    document.addEventListener('keydown', onKeydown);
    await nextTick();
    mobileMenuPanel.value?.querySelector<HTMLElement>('button, a[href]')?.focus();
  } else {
    document.removeEventListener('mousedown', onDocumentPointerDown);
    document.removeEventListener('keydown', onKeydown);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentPointerDown);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <header class="app-header">
    <div class="header-brand">
      <img class="header-logo" src="/logo.svg" alt="" width="26" height="26" aria-hidden="true" />
      <span class="header-title">RELAY</span>
      <span class="header-sub">Restreamer</span>
    </div>

    <!-- Live Stream Control -->
    <div class="header-status" aria-label="Systemstatus">
      <LiveMenu />
      <div class="desktop-only-inline">
        <TikTokAccountSwitcher ref="accountSwitcherRef" />
      </div>
    </div>

    <!-- Actions Bar -->
    <div class="header-actions">
      <!-- Search is always accessible directly (Desktop & Mobile) -->
      <button
        type="button"
        class="btn btn-ghost btn-sm omni-search-trigger"
        aria-label="Universalsuche öffnen (Strg+K)"
        title="Universalsuche (Einstellungen, Funktionen, Streamer) · Strg+K"
        @click="openOmniSearch"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.8" />
          <path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
        <span class="hide-xs">Suche</span>
        <kbd class="header-kbd hide-xs">⌘K</kbd>
      </button>

      <!-- Desktop-only Header Actions -->
      <div class="desktop-actions">
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          aria-label="Stream-Deck öffnen"
          title="Stream-Deck (Vollbild-Steuerung)"
          @click="router.push('/deck')"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2.5" stroke="currentColor" stroke-width="1.8" />
            <path d="M3 9h18M3 15h18M9 3v18M15 3v18" stroke="currentColor" stroke-width="1.8" />
          </svg>
          <span class="hide-xs">Deck</span>
        </button>
        <button
          v-if="pwaState.canInstall || pwaState.isIos"
          type="button"
          class="btn btn-ghost btn-sm"
          @click="handleInstall"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
            <path
              d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span class="hide-xs">Installieren</span>
        </button>
        <button
          type="button"
          class="theme-toggle"
          :aria-label="`Theme: ${themeLabel} (${preference})`"
          :title="`Theme wechseln (Auto → Neon → Amber) · aktuell: ${themeLabel}`"
          @click="toggleTheme"
        >
          <span aria-hidden="true">{{ preference === 'auto' ? '◐' : theme === 'light' ? '☾' : '☀' }}</span>
          <span class="hide-xs">{{ themeLabel }}</span>
        </button>
        <button
          v-if="store.authRequired"
          type="button"
          class="btn btn-ghost btn-sm"
          aria-label="Abmelden"
          @click="handleLogout"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
            <path
              d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span class="hide-xs">Abmelden</span>
        </button>
      </div>

      <!-- Mobile-only 3-Dots More Menu Trigger -->
      <div class="mobile-actions-wrapper">
        <button
          ref="mobileMenuTrigger"
          type="button"
          class="btn btn-ghost btn-sm mobile-more-btn"
          :class="{ 'is-active': mobileMenuOpen }"
          aria-label="Weitere Optionen & Konto"
          title="Menü öffnen"
          :aria-expanded="mobileMenuOpen"
          aria-controls="mobile-header-menu"
          @click="toggleMobileMenu"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
          </svg>
        </button>

        <!-- Mobile Popover Menu Dropdown -->
        <Transition name="menu-fade">
          <div
            v-if="mobileMenuOpen"
            id="mobile-header-menu"
            ref="mobileMenuPanel"
            class="mobile-header-dropdown"
            role="menu"
            aria-label="Optionen"
          >
            <!-- Account Row -->
            <button
              type="button"
              class="mobile-menu-item"
              role="menuitem"
              @click="openMobileAccountSwitcher"
            >
              <span class="menu-item-icon" aria-hidden="true">👤</span>
              <div class="menu-item-text">
                <span class="menu-item-title">TikTok-Konto</span>
                <span class="menu-item-sub mono">{{ activeAccount ? activeAccount.label : 'Kein Konto aktiv' }}</span>
              </div>
              <span class="menu-item-arrow" aria-hidden="true">›</span>
            </button>

            <div class="menu-divider" role="separator"></div>

            <!-- Stream Deck Link -->
            <button
              type="button"
              class="mobile-menu-item"
              role="menuitem"
              @click="navigateToDeck"
            >
              <span class="menu-item-icon" aria-hidden="true">🎛</span>
              <div class="menu-item-text">
                <span class="menu-item-title">Stream-Deck</span>
                <span class="menu-item-sub">Vollbild-Touch-Regie</span>
              </div>
            </button>

            <!-- Theme Toggle -->
            <button
              type="button"
              class="mobile-menu-item"
              role="menuitem"
              @click="handleMobileThemeToggle"
            >
              <span class="menu-item-icon" aria-hidden="true">
                {{ preference === 'auto' ? '◐' : theme === 'light' ? '☾' : '☀' }}
              </span>
              <div class="menu-item-text">
                <span class="menu-item-title">Erscheinungsbild</span>
                <span class="menu-item-sub">{{ themeLabel }}</span>
              </div>
            </button>

            <!-- PWA Install -->
            <button
              v-if="pwaState.canInstall || pwaState.isIos"
              type="button"
              class="mobile-menu-item"
              role="menuitem"
              @click="handleInstall"
            >
              <span class="menu-item-icon" aria-hidden="true">📲</span>
              <div class="menu-item-text">
                <span class="menu-item-title">App installieren</span>
                <span class="menu-item-sub">Zum Startbildschirm hinzufügen</span>
              </div>
            </button>

            <!-- Logout if Auth Required -->
            <template v-if="store.authRequired">
              <div class="menu-divider" role="separator"></div>
              <button
                type="button"
                class="mobile-menu-item item-danger"
                role="menuitem"
                @click="handleLogout"
              >
                <span class="menu-item-icon" aria-hidden="true">🚪</span>
                <div class="menu-item-text">
                  <span class="menu-item-title">Abmelden</span>
                </div>
              </button>
            </template>
          </div>
        </Transition>
      </div>
    </div>
  </header>
</template>

<style scoped>
.omni-search-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.header-kbd {
  font-family: var(--font-mono, monospace);
  font-size: 0.65rem;
  background: var(--bg-surface-elevated, rgba(255, 255, 255, 0.08));
  border: 1px solid var(--border-color, #444);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  color: var(--text-muted, #aaa);
}

.desktop-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.desktop-only-inline {
  display: inline-flex;
  align-items: center;
}

.mobile-actions-wrapper {
  display: none;
  position: relative;
}

.mobile-more-btn {
  padding: 0.35rem 0.5rem;
  border-radius: 4px;
}

.mobile-more-btn.is-active {
  background: var(--bg-surface-elevated, rgba(255, 255, 255, 0.12));
  color: var(--color-accent, #38bdf8);
}

.mobile-header-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 250px;
  background: var(--bg-card, #161616);
  border: 1px solid var(--border-color, #333);
  border-radius: 6px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.08);
  padding: 0.4rem 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
}

.mobile-menu-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.65rem 0.9rem;
  background: transparent;
  border: none;
  color: var(--text-primary, #f0f0f0);
  text-align: left;
  width: 100%;
  cursor: pointer;
  transition: background 0.1s ease;
}

.mobile-menu-item:hover,
.mobile-menu-item:focus-visible {
  background: rgba(56, 189, 248, 0.08);
  outline: none;
}

.menu-item-icon {
  font-size: 1.1rem;
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}

.menu-item-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.menu-item-title {
  font-size: 0.85rem;
  font-weight: 600;
}

.menu-item-sub {
  font-size: 0.72rem;
  color: var(--text-muted, #888);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.menu-item-arrow {
  color: var(--text-muted, #666);
  font-size: 1.1rem;
}

.menu-divider {
  height: 1px;
  background: var(--border-color, #282828);
  margin: 0.3rem 0;
}

.item-danger {
  color: var(--color-danger, #ef4444);
}

.item-danger:hover {
  background: rgba(239, 68, 68, 0.1);
}

.menu-fade-enter-active,
.menu-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.menu-fade-enter-from,
.menu-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (max-width: 680px) {
  .desktop-actions {
    display: none;
  }
  .desktop-only-inline {
    display: none;
  }
  .mobile-actions-wrapper {
    display: block;
  }
}
</style>
