<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth.js';
import { useUiStore } from './stores/ui.js';
import AddToReportModal from './components/AddToReportModal.vue';
import { useMetaStore } from './stores/meta.js';
import { periodLabel } from './format.js';

const auth = useAuthStore();
const ui = useUiStore();
const meta = useMetaStore();
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
  if (auth.isAuthenticated) {
    auth.fetchMe().catch(() => {});
    meta.load().catch(() => {});
  }
});

function logout() {
  auth.logout();
  router.push({ name: 'login' });
}

const groups = [
  {
    title: 'Analyse',
    links: [
      { to: '/', label: "Vue d'ensemble", hint: 'Commerce UE ↔ hors UE : chiffres clés, tendances, prévisions', icon: 'M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z' },
      { to: '/nomenclature', label: 'Produits (codes NC)', hint: 'Chaque code NC : valeurs, volumes, prix médian, pays, marché mondial — tout sur une fiche', icon: 'M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z' },
      { to: '/carte', label: 'Pays partenaires', hint: 'Carte et fiche de chaque pays', icon: 'M15 5.1 9 3 3 5v16l6-2 6 2 6-2V3zM15 19l-6-2V5l6 2z' },
      { to: '/comparateur', label: 'Comparer', hint: 'Superposer jusqu\'à 4 jeux de données', icon: 'M10 3H4v18h6zm10 6h-6v12h6z' },
      { to: '/explorer', label: 'Lignes détaillées', hint: 'Toutes les déclarations, export CSV', icon: 'M3 5h18v2H3zm0 6h18v2H3zm0 6h18v2H3z' },
    ],
  },
  {
    title: 'Restitution',
    links: [
      { to: '/rapports', label: 'Rapports', hint: 'Rapports éditables, PDF et PowerPoint', icon: 'M6 2h9l5 5v15H6zm8 1.5V8h4.5zM9 12h8v1.5H9zm0 3h8v1.5H9zm0 3h5v1.5H9z' },
      { to: '/compte', label: 'Compte & données', hint: 'Profil, offre, état des données', icon: 'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-5 0-9 2.5-9 5v3h18v-3c0-2.5-4-5-9-5z' },
    ],
  },
];
const isActive = (to) => (to === '/' ? route.path === '/' : route.path.startsWith(to) || (to === '/nomenclature' && route.path.startsWith('/produits')));
</script>

<template>
  <div v-if="shell" class="layout">
    <header class="topbar">
      <button class="btn btn-sm burger" aria-label="Menu" @click="menuOpen = !menuOpen">☰</button>
      <RouterLink to="/" class="brand"><span class="logo">D</span>DouaneData</RouterLink>
      <span class="tagline">Commerce UE ↔ hors UE par code NC · source Eurostat Comext</span>
      <div class="spacer" />
      <button class="btn btn-sm" title="Changer de thème" @click="cycleTheme">
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" /></svg><span class="theme-label"> Thème : {{ { auto: 'auto', light: 'clair', dark: 'sombre' }[theme] }}</span>
      </button>
      <span v-if="auth.user" class="user">
        {{ auth.user.name || auth.user.email }}
        <span class="badge">{{ auth.user.plan === 'pro' ? 'Pro' : 'Gratuit' }}</span>
      </span>
      <button class="btn btn-sm" @click="logout">Déconnexion</button>
    </header>
    <nav class="sidebar" :class="{ open: menuOpen }" @click="menuOpen = false">
      <template v-for="g in groups" :key="g.title">
        <div class="nav-title">{{ g.title }}</div>
        <RouterLink v-for="l in g.links" :key="l.to" :to="l.to" class="nav-link" :class="{ active: isActive(l.to) }" :title="l.hint">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path :d="l.icon" fill="currentColor" /></svg>
          {{ l.label }}
        </RouterLink>
      </template>
      <div class="nav-foot hint">
        <template v-if="meta.lastPeriod">
          <span class="fresh-dot" aria-hidden="true" />Données jusqu'à <strong>{{ periodLabel(meta.lastPeriod) }}</strong><br />
          <span v-if="meta.data?.updatedAt">Actualisées le {{ new Date(meta.data.updatedAt).toLocaleDateString('fr-FR') }}</span><br />
        </template>
        Eurostat · sources nationales · ONU<br />Nomenclature harmonisée automatiquement
      </div>
    </nav>
    <main class="content">
      <RouterView />
    </main>
    <AddToReportModal />
    <div class="toasts" aria-live="polite">
      <div v-for="t in ui.toasts" :key="t.id" class="toast">
        <span>{{ t.message }}</span>
        <RouterLink v-if="t.link" :to="t.link" @click="ui.dismiss(t.id)">{{ t.linkLabel || 'Voir' }}</RouterLink>
        <button class="btn btn-sm btn-ghost" aria-label="Fermer" @click="ui.dismiss(t.id)">✕</button>
      </div>
    </div>
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
.sidebar { padding: 12px 10px; border-right: 1px solid var(--border); background: var(--surface); display: flex; flex-direction: column; gap: 2px; position: sticky; top: 56px; height: calc(100vh - 56px); overflow-y: auto; }
.nav-title { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); padding: 14px 12px 4px; font-weight: 600; }
.nav-foot { margin-top: auto; padding: 12px; line-height: 1.5; }
.fresh-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--good); margin-right: 6px; vertical-align: 1px; }
.toasts { position: fixed; right: 16px; bottom: 16px; z-index: 80; display: grid; gap: 8px; }
.toast { display: flex; gap: 12px; align-items: center; background: var(--text); color: var(--page); padding: 10px 12px 10px 16px; border-radius: 10px; box-shadow: var(--shadow-pop); font-size: 0.88rem; }
.toast a { color: var(--page); font-weight: 700; text-decoration: underline; }
.toast .btn { color: var(--page); }
.nav-link { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 8px; color: var(--text-2); font-size: 0.92rem; }
.nav-link:hover { background: var(--surface-2); text-decoration: none; }
.nav-link.active { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--text); font-weight: 600; }
.content { padding: 24px 28px 48px; min-width: 0; max-width: 1500px; width: 100%; }
@media (max-width: 900px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
  .topbar { gap: 8px; padding: 0 12px; min-width: 0; }
  .theme-label { display: none; }
  .brand { font-size: 0.95rem; }
  .tagline, .user { display: none; }
  .burger { display: inline-flex; }
  .sidebar { display: none; position: fixed; top: 56px; left: 0; right: 0; height: auto; max-height: calc(100vh - 56px); z-index: 30; border-bottom: 1px solid var(--border); }
  .sidebar.open { display: flex; }
  .content { padding: 16px; }
}
</style>
