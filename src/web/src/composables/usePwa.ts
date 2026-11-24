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

let swRegistration: ServiceWorkerRegistration | undefined;
let updateTimer: number | null = null;
let updateListenersBound = false;

/** How often an open tab checks for a new service worker. */
const UPDATE_CHECK_MS = 60_000;

function sessionGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function sessionSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function checkForUpdate(): void {
  void swRegistration?.update().catch(() => undefined);
}

function scheduleUpdateChecks(): void {
  if (updateTimer !== null) return;
  checkForUpdate();
  updateTimer = window.setInterval(checkForUpdate, UPDATE_CHECK_MS);
  if (updateListenersBound) return;
  updateListenersBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
  window.addEventListener('focus', checkForUpdate);
  window.addEventListener('online', checkForUpdate);
}

function reloadOnce(): void {
  const now = Date.now();
  const last = Number(sessionGet('relay:reload-at') ?? 0);
  if (now - last < 10_000) return;
  sessionSet('relay:reload-at', String(now));
  window.location.reload();
}

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
        // Force the waiting worker to activate instead of waiting for a tap.
        state.needRefresh = true;
        void refreshApp();
      },
      onNeedReload() {
        // A new worker already took control; reload to run the new bundle.
        reloadOnce();
      },
      onRegisteredSW(_swUrl, registration) {
        // Registration can be blocked (private mode, iframes, tests); the app
        // still works without a worker, so never assume it exists.
        if (!registration) return;
        swRegistration = registration;
        scheduleUpdateChecks();
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
    if (!swRegistration) {
      reloadOnce();
      return;
    }
    await updateSW?.(true);
    state.needRefresh = false;
  } finally {
    state.updating = false;
  }
}

function dismissRefresh(): void {
  state.needRefresh = false;
}

/**
 * Compares the running bundle version with the server version. If the server
 * is newer, the client is stale: drop the service worker + caches and reload
 * from the network. Guarded per version so a broken reload cannot loop.
 */
export function checkServerVersion(version: string | null | undefined): void {
  if (!version || version === __APP_VERSION__) return;
  const key = 'relay:forced-version';
  if (sessionGet(key) === version) return;
  sessionSet(key, version);
  void forceFreshClient();
}

async function forceFreshClient(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((name) => caches.delete(name)));
    }
  } catch {
    /* best effort – reload anyway */
  }
  window.location.reload();
}

export function usePwa() {
  return {
    state: readonly(state),
    promptInstall,
    refreshApp,
    dismissRefresh,
  };
}
