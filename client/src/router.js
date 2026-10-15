import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from './stores/auth.js';

/** Fiche d'un code NC : NC8 → fiche produit, NC2/4/6 → niveau de nomenclature. */
function ncPage(code, hash) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length === 8) return { path: `/produits/${c}`, query: {}, hash };
  if (c.length >= 6) return { path: `/nomenclature/${c.slice(0, 6)}`, query: {}, hash };
  return { path: c.length >= 2 ? `/nomenclature/${c.slice(0, 2)}` : '/nomenclature', query: {} };
}

const routes = [
  { path: '/connexion', name: 'login', component: () => import('./views/AuthView.vue'), meta: { public: true } },
  { path: '/', name: 'dashboard', component: () => import('./views/DashboardView.vue') },
  { path: '/nomenclature', name: 'nomenclature', component: () => import('./views/NomenclatureView.vue') },
  { path: '/nomenclature/:code', name: 'nc', component: () => import('./views/NcView.vue'), props: true },
  { path: '/produits/:code', name: 'product', component: () => import('./views/ProductView.vue'), props: true },
  { path: '/carte', name: 'map', component: () => import('./views/MapView.vue') },
  // Anciennes pages Prix et Marché mondial : tout est désormais sur la fiche du code NC
  { path: '/prix', redirect: (to) => ncPage(to.query.product, '#prix') },
  { path: '/monde', redirect: (to) => ncPage(to.query.product, '#monde') },
  { path: '/comparateur', name: 'compare', component: () => import('./views/CompareView.vue') },
  { path: '/explorer', name: 'explorer', component: () => import('./views/ExplorerView.vue') },
  { path: '/rapports', name: 'reports', component: () => import('./views/ReportsView.vue') },
  { path: '/rapports/:id', name: 'report', component: () => import('./views/ReportEditorView.vue'), props: true, meta: { bare: true } },
  { path: '/compte', name: 'account', component: () => import('./views/AccountView.vue') },
  { path: '/categories', redirect: '/nomenclature' },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: (to, from) => {
    // Lien vers une partie de fiche (#prix, #monde) : on attend le rendu des données
    if (to.hash) return new Promise((resolve) => setTimeout(() => resolve({ el: to.hash, top: 110, behavior: 'smooth' }), 900));
    return to.path === from.path ? false : { top: 0 };
  },
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (!to.meta.public && !auth.isAuthenticated) return { name: 'login', query: { redirect: to.fullPath } };
  if (to.name === 'login' && auth.isAuthenticated) return { name: 'dashboard' };
});

export default router;
