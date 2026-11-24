/**
 * Route chunk prefetch (#88).
 *
 * Hovering or touching a navigation target starts downloading the view chunk so
 * the click lands on an already warm module. Only the four primary destinations
 * are prefetched, and only once per session.
 */
import type { RouteRecordRaw } from 'vue-router';

type Loader = () => Promise<unknown>;

const loaders = new Map<string, Loader>();
const started = new Set<string>();

/** Registers the lazy component loaders of the primary routes. */
export function registerPrefetchRoutes(routes: readonly RouteRecordRaw[]): void {
  for (const route of routes) {
    if (typeof route.path !== 'string') continue;
    const component = route.component as unknown;
    if (typeof component === 'function') {
      loaders.set(route.path, component as Loader);
    }
  }
}

export const PREFETCH_PATHS = ['/', '/streamers', '/discovery', '/overlays'] as const;

function start(path: string): void {
  if (started.has(path)) return;
  const loader = loaders.get(path);
  if (!loader) return;
  started.add(path);
  void loader().catch(() => {
    // A failed prefetch is harmless; the navigation retries the import.
    started.delete(path);
  });
}

/** Prefetches one path if it belongs to the warm-up set. */
export function prefetchPath(path: string): void {
  if (!(PREFETCH_PATHS as readonly string[]).includes(path)) return;
  const run = (): void => start(path);
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 1500 });
    return;
  }
  run();
}

/** Prefetches every warm-up path; used once the dashboard has painted. */
export function prefetchPrimaryRoutes(): void {
  for (const path of PREFETCH_PATHS) prefetchPath(path);
}

/** Test helper. */
export function resetPrefetchState(): void {
  started.clear();
  loaders.clear();
}
