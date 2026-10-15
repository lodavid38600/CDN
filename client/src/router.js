import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from './stores/auth.js';

const routes = [
  { path: '/connexion', name: 'login', component: () => import('./views/AuthView.vue'), meta: { public: true } },
  { path: '/', name: 'dashboard', component: () => import('./views/DashboardView.vue') },
  { path: '/explorer', name: 'explorer', component: () => import('./views/ExplorerView.vue') },
  { path: '/categories', name: 'categories', component: () => import('./views/CategoriesView.vue') },
  { path: '/produits/:code', name: 'product', component: () => import('./views/ProductView.vue'), props: true },
  { path: '/compte', name: 'account', component: () => import('./views/AccountView.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (!to.meta.public && !auth.isAuthenticated) return { name: 'login', query: { redirect: to.fullPath } };
  if (to.name === 'login' && auth.isAuthenticated) return { name: 'dashboard' };
});

export default router;
