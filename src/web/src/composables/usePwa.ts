import { reactive, readonly } from 'vue';
import { registerSW } from 'virtual:pwa-register';

export interface PwaState {
  /** A newer version was precached and is ready to activate. */
  needRefresh: boolean;
  /** The app shell is cached and available offline. */
  offlineReady: boolean;
  /** An install prompt is available (beforeinstallprompt fired). */
  canInstall: boolean;
  /** The app is running as an installed PWA. */
  installed: boolean;
  /** iOS/safari needs a manual "add to home screen" hint. */
  isIos: boolean;
  /** True while the update is being applied. */
  updating: boolean;
}

const state = reactive<PwaState>({
  needRefresh: false,
  offlineReady: false,
  canInstall: false,
  installed: false,
  isIos: false,
  updating: false,
});

let updateSW: ((reload?: boolean) => Promise<void>) | null = null;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let installPromptEvent: BeforeInstallPromptEvent | null = null;

function detectIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.platform ?? '';
  const ua = navigator.userAgent ?? '';
  return /iphone|ipad|ipod/i.test(platform) || /iphone|ipad|ipod/i.test(ua);
}

function captureInstallPrompt(): void {
  const handler = (event: Event): void => {
    const e = event as BeforeInstallPromptEvent;
    if (typeof e.prompt !== 'function') return;
    event.preventDefault();
    installPromptEvent = e;
    state.canInstall = true;
  };
  window.addEventListener('beforeinstallprompt', handler);

  const installedHandler = (): void => {
    state.installed = true;
    state.canInstall = false;
    installPromptEvent = null;
  };
  window.addEventListener('appinstalled', installedHandler);
}

async function promptInstall(): Promise<boolean> {
  if (state.installed) return false;
  if (installPromptEvent) {
    await installPromptEvent.prompt();
    const choice = await installPromptEvent.userChoice;
    if (choice.outcome === 'accepted') {
      state.installed = true;
    }
    state.canInstall = false;
    installPromptEvent = null;
    return state.installed;
  }
  return false;
}

export function initPwa(): void {
  state.isIos = detectIos();
  state.installed = window.matchMedia('(display-mode: standalone)').matches;

  if (state.installed || state.isIos) {
    state.canInstall = false;
  } else {
    captureInstallPrompt();
  }

  if ('serviceWorker' in navigator) {
    updateSW = registerSW({
      immediate: true,
      onOfflineReady() {
        state.offlineReady = true;
      },
      onNeedRefresh() {
        state.needRefresh = true;
      },
      onRegistered(registration) {
        // Keep the precache fresh in the background.
        void registration?.update().catch(() => undefined);
      },
      onRegisterError(error) {
        console.error('Service-Worker-Registrierung fehlgeschlagen:', error);
      },
    });
  }
}

async function refreshApp(): Promise<void> {
  state.updating = true;
  try {
    await updateSW?.(true);
    state.needRefresh = false;
  } finally {
    state.updating = false;
  }
}

function dismissRefresh(): void {
  state.needRefresh = false;
}

export function usePwa() {
  return {
    state: readonly(state),
    promptInstall,
    refreshApp,
    dismissRefresh,
  };
}
