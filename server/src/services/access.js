import { audit } from './audit.js';

// Droits d'accès, en un seul endroit.
//
// Deux familles d'utilisateurs :
//   - l'équipe du SaaS (staffRole) : « admin » (tout) ou « commercial » (comptes, abonnements,
//     factures, support) ;
//   - les clients : chaque utilisateur appartient à une société et HÉRITE de ses droits
//     (fonctionnalités de l'offre souscrite, ajustées au cas par cas par le commercial).
//     Dans sa société, il est « owner » (gère la société, ses membres, voit les factures) ou
//     « member » (utilise l'outil, ouvre des tickets).

// Fonctionnalités vendues (héritées de la société)
export const FEATURES = {
  explore: 'Exploration des données (fiches NC, pays, lignes détaillées)',
  prices: 'Analyse des prix et des volumes',
  compare: 'Comparateur',
  forecast: 'Prévisions',
  world: 'Marché mondial (pays hors Eurostat)',
  reports: 'Rapports PDF et PowerPoint',
  export: 'Export CSV',
  api: 'Accès API',
};

export const PLANS = {
  essai: { label: 'Essai', monthly: 0, seats: 2, exportLimit: 1000, days: 14, features: ['explore', 'prices', 'compare', 'reports'] },
  essentiel: { label: 'Essentiel', monthly: 49, seats: 3, exportLimit: 10000, features: ['explore', 'prices', 'compare', 'reports', 'export'] },
  pro: { label: 'Pro', monthly: 149, seats: 10, exportLimit: 100000, features: ['explore', 'prices', 'compare', 'forecast', 'world', 'reports', 'export'] },
  entreprise: { label: 'Entreprise', monthly: 490, seats: 50, exportLimit: 500000, features: Object.keys(FEATURES) },
};

// Actions réservées (équipe du SaaS et responsables de société)
export const PERMISSIONS = {
  'companies.manage': 'Créer et modifier les sociétés clientes',
  'users.manage': 'Créer et modifier les comptes utilisateurs',
  'subscriptions.manage': 'Gérer les offres, fonctionnalités et nombre de places',
  'invoices.manage': 'Émettre et suivre les factures',
  'support.manage': 'Traiter les tickets et le chat des clients',
  'logs.read': 'Consulter le journal d\'activité',
  'site.manage': 'Administrer le site (données, actualités, couverture, bandeau)',
  'staff.manage': 'Gérer les comptes de l\'équipe (admin, commercial)',
  'company.manage': 'Gérer sa société et ses membres',
  'invoices.read': 'Consulter les factures de sa société',
};

const STAFF_PERMS = {
  commercial: ['companies.manage', 'users.manage', 'subscriptions.manage', 'invoices.manage', 'support.manage'],
};
STAFF_PERMS.admin = Object.keys(PERMISSIONS).filter((p) => !['company.manage', 'invoices.read'].includes(p));

export const STAFF_ROLES = { admin: 'Administrateur', commercial: 'Commercial' };
export const COMPANY_ROLES = { owner: 'Responsable', member: 'Membre' };

/** Fin d'abonnement dépassée ? */
export const isExpired = (company, now = new Date()) => Boolean(company?.subscription?.end && new Date(company.subscription.end) < now);

/** Droits effectifs d'un utilisateur (avec sa société chargée). */
export function accessOf(user, company) {
  const perms = new Set(STAFF_PERMS[user.staffRole] || []);
  let features = new Set();
  let status = 'none';
  let plan = null;
  if (user.staffRole) {
    features = new Set(Object.keys(FEATURES)); // l'équipe voit tout
    status = 'staff';
  } else if (company) {
    plan = PLANS[company.plan] ? company.plan : 'essai';
    if (user.companyRole === 'owner') { perms.add('company.manage'); perms.add('invoices.read'); }
    if (company.status === 'suspended') status = 'suspended';
    else if (isExpired(company)) status = 'expired';
    else {
      status = 'active';
      features = new Set([...PLANS[plan].features, ...(company.featuresAdd || [])].filter((f) => FEATURES[f] && !(company.featuresRemove || []).includes(f)));
    }
  }
  const exportLimit = user.staffRole ? PLANS.entreprise.exportLimit : company?.exportLimit || (plan ? PLANS[plan].exportLimit : 0);
  return { staffRole: user.staffRole || null, companyRole: user.staffRole ? null : user.companyRole || 'member', perms, features, status, plan, exportLimit };
}

/** Forme publique (pour l'interface : afficher ou masquer pages et boutons). */
export const publicAccess = (a) => ({ ...a, perms: [...a.perms], features: [...a.features] });

const STATUS_MESSAGE = {
  none: 'Votre compte n\'est rattaché à aucune société : contactez votre commercial.',
  suspended: 'L\'accès de votre société est suspendu : contactez votre commercial.',
  expired: 'L\'abonnement de votre société est arrivé à échéance : contactez votre commercial pour le renouveler.',
};

/** Middleware : action réservée. */
export const requirePerm = (perm) => (req, res, next) => (req.access?.perms.has(perm) ? next() : deny(req, res, `permission « ${perm} »`));

/** Middleware : fonctionnalité de l'offre (hérite de la société). */
export const requireFeature = (feature) => (req, res, next) => {
  const a = req.access;
  if (a?.features.has(feature)) return next();
  if (a && a.status !== 'active' && a.status !== 'staff') return res.status(402).json({ error: STATUS_MESSAGE[a.status], code: a.status });
  return deny(req, res, `fonctionnalité « ${feature} »`, `Cette fonctionnalité n'est pas incluse dans l'offre de votre société (${FEATURES[feature] || feature}).`);
};

function deny(req, res, what, message = 'Accès refusé') {
  audit(req, { action: 'acces.refuse', category: 'securite', level: 'security', message: `Accès refusé : ${what}`, details: { path: req.originalUrl, method: req.method } });
  return res.status(403).json({ error: message });
}
