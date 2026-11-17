import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import { setUnauthorizedHandler } from '@/src/api/client';
import { resetSession } from '@/src/composables/useStore';
import './style.css';
import './toktracker.css';

const savedTheme = localStorage.getItem('relay-theme');
document.documentElement.dataset.theme = savedTheme === 'light' ? 'light' : 'dark';

setUnauthorizedHandler(() => {
  const current = router.currentRoute.value;
  resetSession();
  if (current.name !== 'login') {
    void router.replace({ name: 'login', query: { redirect: current.fullPath } });
  }
});

createApp(App).use(router).mount('#app');
