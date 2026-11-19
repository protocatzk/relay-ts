import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import { setUnauthorizedHandler } from '@/src/api/client';
import { resetSession } from '@/src/composables/useStore';
import { initTheme } from '@/src/composables/useTheme';
import { initPwa } from '@/src/composables/usePwa';
import '@/src/styles/index.css';

initTheme();
initPwa();

setUnauthorizedHandler(() => {
  const current = router.currentRoute.value;
  resetSession();
  if (current.name !== 'login') {
    void router.replace({ name: 'login', query: { redirect: current.fullPath } });
  }
});

createApp(App).use(router).mount('#app');
