<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth.js';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const menuOpen = ref(false);
const shell = computed(() => !route.meta.public);

const THEME_KEY = 'douane.theme';
const theme = ref('auto');
function applyTheme(t) {
  theme.value = t;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem(THEME_KEY, t); } catch { /* ignoré */ }
  window.dispatchEvent(new Event('themechange'));
}
function cycleTheme() {
  applyTheme({ auto: 'light', light: 'dark', dark: 'auto' }[theme.value]);
}

onMounted(() => {
  let saved = 'auto';
  try { saved = localStorage.getItem(THEME_KEY) || 'auto'; } catch { /* ignoré */ }
  applyTheme(saved);
  if (auth.isAuthenticated) auth.fetchMe().catch(() => {});
});

function logout() {
  auth.logout();
  router.push({ name: 'login' });
}

const links = [
  { to: '/', label: 'Tableau de bord', icon: 'M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z' },
  { to: '/explorer', label: 'Explorateur', icon: 'M3 5h18v2H3zm0 6h18v2H3zm0 6h18v2H3z' },
  { to: '/categories', label: 'Catégories NC', icon: 'M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z' },
  { to: '/compte', label: 'Mon compte', icon: 'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-5 0-9 2.5-9 5v3h18v-3c0-2.5-4-5-9-5z' },
];
</script>

<template>
  <div v-if="shell" class="layout">
    <header class="topbar">
      <button class="btn btn-sm burger" aria-label="Menu" @click="menuOpen = !menuOpen">☰</button>
      <RouterLink to="/" class="brand"><span class="logo">D</span>DouaneData</RouterLink>
      <span class="tagline">Commerce UE ↔ hors UE par code NC · source Eurostat Comext</span>
      <div class="spacer" />
      <button class="btn btn-sm" title="Changer de thème" @click="cycleTheme">
        Thème : {{ { auto: 'auto', light: 'clair', dark: 'sombre' }[theme] }}
      </button>
      <span v-if="auth.user" class="user">
        {{ auth.user.name || auth.user.email }}
        <span class="badge">{{ auth.user.plan === 'pro' ? 'Pro' : 'Gratuit' }}</span>
      </span>
      <button class="btn btn-sm" @click="logout">Déconnexion</button>
    </header>
    <nav class="sidebar" :class="{ open: menuOpen }" @click="menuOpen = false">
      <RouterLink v-for="l in links" :key="l.to" :to="l.to" class="nav-link" :class="{ active: l.to === '/' ? route.path === '/' : route.path.startsWith(l.to) }">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path :d="l.icon" fill="currentColor" /></svg>
        {{ l.label }}
      </RouterLink>
    </nav>
    <main class="content">
      <RouterView />
    </main>
  </div>
  <RouterView v-else />
</template>

<style scoped>
.layout { display: grid; grid-template-columns: 220px 1fr; grid-template-rows: 56px 1fr; min-height: 100vh; }
.topbar {
  grid-column: 1 / -1; display: flex; align-items: center; gap: 12px; padding: 0 16px;
  background: var(--surface); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 20;
}
.brand { display: flex; align-items: center; gap: 8px; font-weight: 700; color: var(--text); font-size: 1.05rem; }
.brand:hover { text-decoration: none; }
.logo { width: 28px; height: 28px; border-radius: 7px; background: var(--accent); color: #fff; display: grid; place-items: center; font-size: 0.9rem; }
.tagline { color: var(--muted); font-size: 0.82rem; }
.spacer { flex: 1; }
.user { font-size: 0.85rem; color: var(--text-2); display: flex; gap: 6px; align-items: center; }
.burger { display: none; }
.sidebar { padding: 16px 10px; border-right: 1px solid var(--border); background: var(--surface); display: flex; flex-direction: column; gap: 2px; }
.nav-link { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 8px; color: var(--text-2); font-size: 0.92rem; }
.nav-link:hover { background: var(--surface-2); text-decoration: none; }
.nav-link.active { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--text); font-weight: 600; }
.content { padding: 24px; min-width: 0; }
@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; }
  .tagline, .user { display: none; }
  .burger { display: inline-flex; }
  .sidebar { display: none; position: fixed; top: 56px; left: 0; right: 0; z-index: 30; border-bottom: 1px solid var(--border); }
  .sidebar.open { display: flex; }
  .content { padding: 16px; }
}
</style>
