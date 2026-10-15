import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from './stores/auth.js';
import { useUiStore } from './stores/ui.js';

/** Fiche d'un code NC : NC8 → fiche produit, NC2/4/6 → niveau de nomenclature. */
function ncPage(code, hash) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length === 8) return { path: `/produits/${c}`, query: {}, hash };
  if (c.length >= 6) return { path: `/nomenclature/${c.slice(0, 6)}`, query: {} };
  return { path: c.length >= 2 ? `/nomenclature/${c.slice(0, 2)}` : '/nomenclature', query: {} };
}

// meta : feature = fonctionnalité de l'offre ; perm = permission ; staff = équipe du SaaS ; data = abonnement actif
const pages = import.meta.glob(['./views/*.vue', './views/admin/*.vue']);
const v = (name) => pages[`./views/${name}.vue`];
const routes = [
  { path: '/connexion', name: 'login', component: v('AuthView'), meta: { public: true } },
  { path: '/', name: 'home', component: v('HomeView') },
  { path: '/nomenclature', name: 'nomenclature', component: v('NomenclatureView'), meta: { feature: 'explore' } },
  { path: '/nomenclature/:code', name: 'nc', component: v('NcView'), props: true, meta: { feature: 'explore' } },
  { path: '/produits/:code', name: 'product', component: v('ProductView'), props: true, meta: { feature: 'explore' } },
  { path: '/pays', name: 'countries', component: v('MapView'), meta: { feature: 'explore' } },
  { path: '/comparateur', name: 'compare', component: v('CompareView'), meta: { feature: 'compare' } },
  { path: '/declarations', name: 'explorer', component: v('ExplorerView'), meta: { feature: 'explore' } },
  { path: '/rapports', name: 'reports', component: v('ReportsView'), meta: { feature: 'reports' } },
  { path: '/rapports/:id', name: 'report', component: v('ReportEditorView'), props: true, meta: { bare: true, feature: 'reports' } },
  // Espace client
  { path: '/assistance', name: 'support', component: v('SupportView') },
  { path: '/assistance/tickets/:id', name: 'ticket', component: v('TicketView'), props: true },
  { path: '/societe', name: 'company', component: v('CompanyView') },
  { path: '/factures', name: 'invoices', component: v('InvoicesView'), meta: { perm: 'invoices.read' } },
  { path: '/factures/:id', name: 'invoice', component: v('InvoiceView'), props: true, meta: { perm: 'invoices.read', bare: true } },
  { path: '/compte', name: 'account', component: v('AccountView') },
  // Espace équipe
  { path: '/equipe', name: 'staff', component: v('admin/AdminHome'), meta: { staff: true } },
  { path: '/equipe/societes', name: 'staff-companies', component: v('admin/AdminCompanies'), meta: { perm: 'companies.manage' } },
  { path: '/equipe/societes/:id', name: 'staff-company', component: v('admin/AdminCompany'), props: true, meta: { perm: 'companies.manage' } },
  { path: '/equipe/utilisateurs', name: 'staff-users', component: v('admin/AdminUsers'), meta: { perm: 'users.manage' } },
  { path: '/equipe/tickets', name: 'staff-tickets', component: v('admin/AdminTickets'), meta: { perm: 'support.manage' } },
  { path: '/equipe/tickets/:id', name: 'staff-ticket', component: v('admin/AdminTicket'), props: true, meta: { perm: 'support.manage' } },
  { path: '/equipe/chat', name: 'staff-chat', component: v('admin/AdminChat'), meta: { perm: 'support.manage' } },
  { path: '/equipe/factures', name: 'staff-invoices', component: v('admin/AdminInvoices'), meta: { perm: 'invoices.manage' } },
  { path: '/equipe/factures/:id', name: 'staff-invoice', component: v('InvoiceView'), props: (r) => ({ id: r.params.id, staff: true }), meta: { perm: 'invoices.manage', bare: true } },
  { path: '/equipe/journal', name: 'staff-logs', component: v('admin/AdminLogs'), meta: { perm: 'logs.read' } },
  { path: '/equipe/site', name: 'staff-site', component: v('admin/AdminSite'), meta: { perm: 'site.manage' } },
  // Anciennes adresses
  { path: '/explorer', redirect: '/declarations' },
  { path: '/carte', redirect: '/pays' },
  { path: '/prix', redirect: (to) => ncPage(to.query.product, '#prix') },
  { path: '/monde', redirect: (to) => ncPage(to.query.product, '#monde') },
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

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!to.meta.public && !auth.isAuthenticated) return { name: 'login', query: { redirect: to.fullPath } };
  if (to.name === 'login' && auth.isAuthenticated) return { name: 'home' };
  if (to.meta.public) return true;
  if (!auth.loaded) await auth.fetchMe().catch(() => {});
  const { feature, perm, staff } = to.meta;
  const allowed = (!feature || auth.has(feature)) && (!perm || auth.can(perm)) && (!staff || auth.isStaff);
  if (!allowed) {
    // Fonctionnalité hors offre, ou abonnement inactif : retour à l'accueil avec explication
    const reason = feature && !auth.dataAccess
      ? 'L\'abonnement de votre société n\'est pas actif.'
      : feature ? 'Cette fonctionnalité n\'est pas incluse dans l\'offre de votre société.' : 'Accès réservé.';
    useUiStore().toast(reason, { link: '/assistance', linkLabel: 'Contacter l\'équipe' });
    return fallback();
  }
  return true;
});
const fallback = () => (router.currentRoute.value.matched.length ? false : { name: 'home' });

export default router;
