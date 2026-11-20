import { createRouter, createWebHashHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';
import { ApiError, api } from '@/src/api/client';
import { store } from '@/src/composables/useStore';
import type { SectionId } from '@/src/navigation';

declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    layout?: 'deck' | 'auth';
    section?: SectionId;
    public?: boolean;
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'dashboard',
    component: () => import('@/src/views/DashboardView.vue'),
    meta: { title: 'Dashboard', section: 'live' },
  },
  {
    path: '/streamers',
    name: 'streamers',
    component: () => import('@/src/views/StreamersView.vue'),
    meta: { title: 'Streamer', section: 'inhalte' },
  },
  {
    path: '/playlists',
    name: 'playlists',
    component: () => import('@/src/views/PlaylistsView.vue'),
    meta: { title: 'Playlists', section: 'inhalte' },
  },
  {
    path: '/media',
    name: 'media',
    component: () => import('@/src/views/MediaView.vue'),
    meta: { title: 'Medien', section: 'inhalte' },
  },
  {
    path: '/youtube',
    name: 'youtube',
    component: () => import('@/src/views/YouTubeView.vue'),
    meta: { title: 'YouTube', section: 'studio' },
  },
  {
    path: '/overlays',
    name: 'overlays',
    component: () => import('@/src/views/OverlaysView.vue'),
    meta: { title: 'Overlays', section: 'studio' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/src/views/SettingsView.vue'),
    meta: { title: 'Einstellungen', section: 'system' },
  },
  {
    path: '/logs',
    name: 'logs',
    component: () => import('@/src/views/LogsView.vue'),
    meta: { title: 'Logs', section: 'system' },
  },
  {
    path: '/diagnostics',
    name: 'diagnostics',
    component: () => import('@/src/views/DiagnosticsView.vue'),
    meta: { title: 'Diagnose', section: 'system' },
  },
  {
    path: '/deck',
    name: 'deck',
    component: () => import('@/src/views/StreamDeckView.vue'),
    meta: { title: 'Stream-Deck', layout: 'deck' },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/src/views/LoginView.vue'),
    meta: { title: 'Anmelden', layout: 'auth', public: true },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
  if (to.name === 'login') {
    if (store.authenticated) return { path: '/' };
    if (store.authChecked) return true;
    try {
      const me = await api.auth.me();
      store.authenticated = me.authenticated;
      store.authRequired = me.auth_required;
      store.authChecked = true;
      if (me.authenticated) return { path: '/' };
    } catch {
      store.authChecked = true;
    }
    return true;
  }

  if (store.authenticated) return true;

  try {
    const me = await api.auth.me();
    store.authenticated = me.authenticated;
    store.authRequired = me.auth_required;
    store.authChecked = true;
    return true;
  } catch (error) {
    store.authChecked = true;
    store.authenticated = false;
    if (error instanceof ApiError && error.status === 401) {
      return { name: 'login', query: { redirect: to.fullPath } };
    }
    // Backend unreachable: render the shell with an offline state instead of a hard redirect.
    return true;
  }
});

router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? to.meta.title : '';
  document.title = title ? `${title} · RELAY` : 'RELAY · Restreamer Dashboard';
});

export default router;
