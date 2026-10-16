<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth.js';
import { useUiStore } from './stores/ui.js';
import AddToReportModal from './components/AddToReportModal.vue';
import WidgetBuilder from './components/WidgetBuilder.vue';
import Modal from './components/Modal.vue';
import { useMetaStore } from './stores/meta.js';
import { periodLabel } from './format.js';
import { api, pending } from './api.js';

const auth = useAuthStore();
const ui = useUiStore();
const meta = useMetaStore();
const route = useRoute();
const router = useRouter();
const menuOpen = ref(false);
const shell = computed(() => !route.meta.public && !route.meta.bare);

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

// Bandeau d'information et compteurs de messages non lus (actualisés chaque minute)
const banner = ref(null);
const preparing = ref(false);
let prepTimer;
async function loadHome() {
  try {
    const h = await api('/home', { background: true });
    banner.value = h.banner;
    preparing.value = h.preparing;
  } catch { /* ignoré */ }
  clearTimeout(prepTimer);
  if (preparing.value) prepTimer = setTimeout(loadHome, 20000); // jusqu'à la fin de la préparation
}
// Barre de chargement : n'apparaît que si une requête dure plus de 250 ms (pas de clignotement)
const busy = ref(false);
let busyTimer;
watch(pending, (n, before) => {
  if (n > 0 && !before) {
    clearTimeout(busyTimer);
    busyTimer = setTimeout(() => { busy.value = true; }, 250);
  } else if (n === 0) {
    clearTimeout(busyTimer);
    busy.value = false;
  }
});
const unread = ref({ tickets: 0, chat: 0 });
let timer;
async function refresh() {
  if (!auth.isAuthenticated || !auth.loaded) return;
  try {
    if (auth.isStaff && auth.can('support.manage')) {
      const o = await api('/admin/overview', { background: true });
      unread.value = { tickets: o.tickets, chat: o.unreadChat };
    } else if (auth.company) {
      unread.value = await api('/support/unread', { background: true });
    }
  } catch { /* hors ligne : on réessaiera */ }
}
async function loadSession() {
  if (!auth.isAuthenticated) return;
  await auth.fetchMe().catch(() => {});
  if (auth.dataAccess) meta.load().catch(() => {});
  loadHome();
  refresh();
}
onMounted(() => {
  let saved = 'auto';
  try { saved = localStorage.getItem(THEME_KEY) || 'auto'; } catch { /* ignoré */ }
  applyTheme(saved);
  loadSession();
  timer = setInterval(refresh, 60000);
});
onBeforeUnmount(() => clearInterval(timer));
watch(() => auth.token, (t, old) => { if (t && t !== old) loadSession(); });

function logout() {
  auth.logout();
  router.push({ name: 'login' });
}

// Navigation : seules les pages autorisées par les droits de l'utilisateur apparaissent
const I = {
  home: 'M12 3 2 12h3v8h6v-6h2v6h6v-8h3z',
  grid: 'M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2c1 1.3 1.9 3.2 2.2 5.5H9.8C10.1 7.2 11 5.3 12 4zM4.3 13.5h3.5c.1 1.9.5 3.6 1.2 5A8 8 0 0 1 4.3 13.5zm0-3a8 8 0 0 1 4.7-5c-.7 1.4-1.1 3.1-1.2 5zm7.7 9.5c-1-1.3-1.9-3.2-2.2-5.5h4.4c-.3 2.3-1.2 4.2-2.2 5.5zm3-1.5c.7-1.4 1.1-3.1 1.2-5h3.5a8 8 0 0 1-4.7 5zm1.2-8c-.1-1.9-.5-3.6-1.2-5a8 8 0 0 1 4.7 5z',
  compare: 'M10 3H4v18h6zm10 6h-6v12h6z',
  list: 'M3 5h18v2H3zm0 6h18v2H3zm0 6h18v2H3z',
  report: 'M6 2h9l5 5v15H6zm8 1.5V8h4.5zM9 12h8v1.5H9zm0 3h8v1.5H9zm0 3h5v1.5H9z',
  help: 'M4 4h16v12H7l-3 3zm3 4v2h10V8zm0 4v2h7v-2z',
  company: 'M3 21V5l8-3v6l10 3v10zm4-4h2v-2H7zm0-4h2v-2H7zm0-4h2V7H7zm6 8h2v-2h-2zm0-4h2v-2h-2zm4 4h2v-2h-2z',
  invoice: 'M6 2h12v20l-3-2-3 2-3-2-3 2zm3 5v2h6V7zm0 4v2h6v-2zm0 4v2h4v-2z',
  user: 'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-5 0-9 2.5-9 5v3h18v-3c0-2.5-4-5-9-5z',
  dash: 'M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM1 20c0-3.3 3.6-6 8-6s8 2.7 8 6zm16.5-5.9c2.9.4 5.5 2.4 5.5 5.9h-4c0-2.3-.6-4.3-1.5-5.9z',
  ticket: 'M3 7a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-3a2 2 0 0 0 0-4z',
  chat: 'M4 3h16v13H8l-4 4z',
  log: 'M5 3h14v18H5zm3 4v2h8V7zm0 4v2h8v-2zm0 4v2h5v-2z',
  site: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9 3h-2.1a7 7 0 0 0-1-2.4l1.5-1.5-1.5-1.5-1.5 1.5a7 7 0 0 0-2.4-1V3h-2v2.1a7 7 0 0 0-2.4 1L6.1 4.6 4.6 6.1l1.5 1.5a7 7 0 0 0-1 2.4H3v2h2.1a7 7 0 0 0 1 2.4l-1.5 1.5 1.5 1.5 1.5-1.5a7 7 0 0 0 2.4 1V21h2v-2.1a7 7 0 0 0 2.4-1l1.5 1.5 1.5-1.5-1.5-1.5a7 7 0 0 0 1-2.4H21z',
};
const groups = computed(() => {
  const f = auth.has;
  const c = auth.can;
  const all = [
    {
      title: 'Analyse',
      links: [
        { to: '/', label: 'Accueil', icon: I.home, show: true },
        { to: '/tableau-de-bord', label: 'Mon tableau de bord', hint: 'Vos graphiques enregistrés', icon: I.dash, show: f('dashboard') },
        { to: '/nomenclature', label: 'Produits', hint: 'Rechercher un produit, parcourir les codes NC', icon: I.grid, show: f('explore') },
        { to: '/pays', label: 'Pays partenaires', hint: 'Fiche de chaque pays', icon: I.globe, show: f('explore') },
        { to: '/comparateur', label: 'Comparer des produits', hint: 'Plusieurs codes NC8 côte à côte', icon: I.compare, show: f('compare') },
        { to: '/declarations', label: 'Déclarations', hint: 'Toutes les déclarations, mois par mois', icon: I.list, show: f('explore') },
        { to: '/rapports', label: 'Rapports', hint: 'Rapports PDF et PowerPoint', icon: I.report, show: f('reports') },
      ],
    },
    {
      title: 'Mon espace',
      links: [
        { to: '/assistance', label: 'Assistance', hint: 'Tickets et messagerie', icon: I.help, show: Boolean(auth.company), badge: unread.value.tickets + unread.value.chat },
        { to: '/societe', label: 'Ma société', icon: I.company, show: Boolean(auth.company) },
        { to: '/factures', label: 'Factures', icon: I.invoice, show: c('invoices.read') },
        { to: '/compte', label: 'Mon compte', icon: I.user, show: true },
      ],
    },
    {
      title: 'Équipe',
      links: [
        { to: '/equipe', label: "Vue d'ensemble", icon: I.dash, show: auth.isStaff, exact: true },
        { to: '/equipe/societes', label: 'Sociétés', icon: I.company, show: c('companies.manage') },
        { to: '/equipe/utilisateurs', label: 'Utilisateurs', icon: I.users, show: c('users.manage') },
        { to: '/equipe/tickets', label: 'Tickets', icon: I.ticket, show: c('support.manage'), badge: auth.isStaff ? unread.value.tickets : 0 },
        { to: '/equipe/chat', label: 'Messagerie', icon: I.chat, show: c('support.manage'), badge: auth.isStaff ? unread.value.chat : 0 },
        { to: '/equipe/factures', label: 'Facturation', icon: I.invoice, show: c('invoices.manage') },
        { to: '/equipe/journal', label: 'Journal d\'activité', icon: I.log, show: c('logs.read') },
        { to: '/equipe/site', label: 'Site et données', icon: I.site, show: c('site.manage') },
      ],
    },
  ];
  return all.map((g) => ({ ...g, links: g.links.filter((l) => l.show) })).filter((g) => g.links.length);
});
const isActive = (l) => (l.to === '/' || l.exact ? route.path === l.to : route.path.startsWith(l.to) || (l.to === '/nomenclature' && route.path.startsWith('/produits')));
const ROLE = { admin: 'Administrateur', commercial: 'Commercial' };
const STATUS_TEXT = {
  expired: 'L\'abonnement de votre société est arrivé à échéance : les données ne sont plus accessibles.',
  suspended: 'L\'accès de votre société est suspendu.',
  none: 'Votre compte n\'est rattaché à aucune société.',
};

// Mot de passe provisoire : changement obligatoire à la première connexion
const pw = ref({ current: '', next: '', confirm: '' });
const pwError = ref('');
async function changePassword() {
  pwError.value = '';
  if (pw.value.next !== pw.value.confirm) { pwError.value = 'Les deux mots de passe ne correspondent pas'; return; }
  try {
    await api('/auth/me/password', { method: 'PUT', body: { current: pw.value.current, next: pw.value.next } });
    await auth.fetchMe();
    ui.toast('Mot de passe enregistré');
  } catch (e) { pwError.value = e.message; }
}
</script>

<template>
  <div v-if="busy" class="topbar-progress" role="progressbar" aria-label="Chargement en cours" />
  <div v-if="shell" class="layout">
    <header class="topbar">
      <button class="btn btn-sm burger" aria-label="Menu" @click="menuOpen = !menuOpen">☰</button>
      <RouterLink to="/" class="brand"><span class="logo">D</span>DouaneData</RouterLink>
      <span class="tagline">Commerce de l'Union européenne avec le reste du monde, produit par produit</span>
      <div class="spacer" />
      <button class="btn btn-sm" title="Changer de thème" @click="cycleTheme">
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" /></svg><span class="theme-label"> Thème : {{ { auto: 'auto', light: 'clair', dark: 'sombre' }[theme] }}</span>
      </button>
      <RouterLink v-if="auth.user" to="/compte" class="user">
        {{ auth.user.name || auth.user.email }}
        <span v-if="auth.isStaff" class="badge badge-accent">{{ ROLE[auth.access.staffRole] }}</span>
        <span v-else-if="auth.company" class="badge">{{ auth.company.name }} · {{ auth.company.planLabel }}</span>
      </RouterLink>
      <button class="btn btn-sm" @click="logout">Déconnexion</button>
    </header>
    <nav class="sidebar" :class="{ open: menuOpen }" @click="menuOpen = false">
      <template v-for="g in groups" :key="g.title">
        <div class="nav-title">{{ g.title }}</div>
        <RouterLink v-for="l in g.links" :key="l.to" :to="l.to" class="nav-link" :class="{ active: isActive(l) }" :title="l.hint">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path :d="l.icon" fill="currentColor" /></svg>
          <span class="nl">{{ l.label }}</span>
          <span v-if="l.badge" class="count">{{ l.badge }}</span>
        </RouterLink>
      </template>
      <div v-if="meta.lastPeriod" class="nav-foot hint">
        <span class="fresh-dot" aria-hidden="true" />Données jusqu'à <strong>{{ periodLabel(meta.lastPeriod) }}</strong>
        <template v-if="meta.data?.updatedAt"><br />Mises à jour le {{ new Date(meta.data.updatedAt).toLocaleDateString('fr-FR') }}</template>
      </div>
    </nav>
    <main class="content">
      <div v-if="banner" class="banner" role="status">{{ banner }}</div>
      <div v-if="preparing" class="banner" role="status">Préparation des données en cours (quelques minutes après une mise à jour) : l'affichage peut être plus lent en attendant.</div>
      <div v-if="auth.loaded && !auth.dataAccess" class="banner warn" role="alert">
        {{ STATUS_TEXT[auth.access?.status] || STATUS_TEXT.none }}
        <RouterLink to="/assistance">Contacter notre équipe</RouterLink>
      </div>
      <RouterView />
    </main>
    <AddToReportModal />
    <WidgetBuilder />
    <Modal v-if="auth.user?.mustChangePassword" title="Choisissez votre mot de passe" @close="() => {}">
      <p class="secondary" style="margin-bottom: 12px">Vous vous êtes connecté avec un mot de passe provisoire. Choisissez le vôtre pour continuer.</p>
      <form class="pwform" @submit.prevent="changePassword">
        <label class="field">Mot de passe provisoire<input v-model="pw.current" type="password" required autocomplete="current-password" /></label>
        <label class="field">Nouveau mot de passe (8 caractères minimum)<input v-model="pw.next" type="password" required minlength="8" autocomplete="new-password" /></label>
        <label class="field">Confirmation<input v-model="pw.confirm" type="password" required minlength="8" autocomplete="new-password" /></label>
        <p v-if="pwError" class="error">{{ pwError }}</p>
        <button class="btn btn-primary">Enregistrer</button>
      </form>
    </Modal>
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
.user:hover { text-decoration: none; color: var(--text); }
.nl { flex: 1; }
.count { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: var(--accent); color: var(--accent-ink); font-size: 0.72rem; font-weight: 700; display: grid; place-items: center; }
.banner { margin-bottom: 16px; padding: 10px 14px; border-radius: 10px; background: var(--accent-wash); color: var(--text); font-size: 0.9rem; }
.banner.warn { background: color-mix(in srgb, var(--bad) 12%, transparent); }
.banner a { margin-left: 8px; font-weight: 600; }
.pwform { display: grid; gap: 12px; }
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
