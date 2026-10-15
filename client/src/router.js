import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from './stores/auth.js';

const routes = [
  { path: '/connexion', name: 'login', component: () => import('./views/AuthView.vue'), meta: { public: true } },
  { path: '/', name: 'dashboard', component: () => import('./views/DashboardView.vue') },
  { path: '/nomenclature', name: 'nomenclature', component: () => import('./views/NomenclatureView.vue') },
  { path: '/nomenclature/:code', name: 'nc', component: () => import('./views/NcView.vue'), props: true },
  { path: '/produits/:code', name: 'product', component: () => import('./views/ProductView.vue'), props: true },
  { path: '/carte', name: 'map', component: () => import('./views/MapView.vue') },
  { path: '/prix', name: 'prices', component: () => import('./views/PricesView.vue') },
  { path: '/monde', name: 'world', component: () => import('./views/WorldView.vue') },
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
  scrollBehavior: (to, from) => (to.path === from.path ? false : { top: 0 }),
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (!to.meta.public && !auth.isAuthenticated) return { name: 'login', query: { redirect: to.fullPath } };
  if (to.name === 'login' && auth.isAuthenticated) return { name: 'dashboard' };
});

export default router;
