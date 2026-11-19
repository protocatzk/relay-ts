import { onBeforeUnmount, onMounted, ref } from 'vue';

let sentinel: WakeLockSentinel | null = null;
const active = ref(false);

export async function requestWakeLock(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return false;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    active.value = true;
    sentinel.addEventListener('release', () => {
      active.value = false;
      sentinel = null;
    });
    return true;
  } catch {
    active.value = false;
    sentinel = null;
    return false;
  }
}

export async function releaseWakeLock(): Promise<void> {
  try {
    await sentinel?.release();
  } catch {
    /* already released */
  }
  sentinel = null;
  active.value = false;
}

async function onVisibility(): Promise<void> {
  if (document.visibilityState === 'visible' && sentinel === null) {
    await requestWakeLock();
  }
}

/** Keeps the screen awake for the lifetime of the calling component. */
export function useWakeLock() {
  onMounted(() => {
    void requestWakeLock();
    document.addEventListener('visibilitychange', onVisibility);
  });
  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', onVisibility);
    void releaseWakeLock();
  });
  return { active, requestWakeLock, releaseWakeLock };
}
