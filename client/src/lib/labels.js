// Libellés et mises en forme partagés par l'espace client et l'espace équipe.
export const TICKET_STATUS = { ouvert: 'Ouvert', en_cours: 'En cours', attente_client: 'En attente de votre réponse', resolu: 'Résolu', ferme: 'Fermé' };
export const TICKET_STATUS_STAFF = { ...TICKET_STATUS, attente_client: 'En attente du client' };
export const TICKET_CATEGORY = { question: 'Question', donnees: 'Données', facturation: 'Facturation', compte: 'Compte et accès', technique: 'Problème technique', suggestion: 'Suggestion' };
export const PRIORITY = { basse: 'Basse', normale: 'Normale', haute: 'Haute', urgente: 'Urgente' };
export const INVOICE_STATUS = { emise: 'À payer', payee: 'Payée', en_retard: 'En retard', annulee: 'Annulée' };
export const COMPANY_ROLE = { owner: 'Responsable', member: 'Membre' };
export const STAFF_ROLE = { admin: 'Administrateur', commercial: 'Commercial' };
export const NEWS_KIND = { nouveaute: 'Nouveauté', donnees: 'Données', nomenclature: 'Nomenclature', maintenance: 'Maintenance' };
export const LOG_LEVEL = { info: 'Info', warning: 'Attention', error: 'Erreur', security: 'Sécurité' };
export const LOG_CATEGORY = {
  auth: 'Connexions', compte: 'Comptes', societe: 'Sociétés', abonnement: 'Abonnements', facture: 'Factures', support: 'Support',
  chat: 'Messagerie', donnees: 'Données', export: 'Exports', securite: 'Sécurité', site: 'Site', systeme: 'Système',
};

export const tone = (status) => ({
  ouvert: 'warn', en_cours: 'info', attente_client: 'info', resolu: 'ok', ferme: 'muted',
  emise: 'info', payee: 'ok', en_retard: 'bad', annulee: 'muted',
  urgente: 'bad', haute: 'warn', normale: 'muted', basse: 'muted',
  active: 'ok', suspended: 'bad', expired: 'bad',
  info: 'muted', warning: 'warn', error: 'bad', security: 'bad',
}[status] || 'muted');

export const dateFr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const dateTimeFr = (d) => (d ? new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export function ago(d) {
  if (!d) return '—';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'à l\'instant';
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `il y a ${Math.floor(s / 86400)} j`;
  return dateFr(d);
}
export const money = (v) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(v || 0);
export const FEATURES = {
  explore: 'Exploration des données', prices: 'Analyse des prix et des volumes', compare: 'Comparateur', forecast: 'Prévisions',
  world: 'Marché mondial (pays hors Eurostat)', reports: 'Rapports PDF et PowerPoint', export: 'Export CSV', api: 'Accès API',
};
