// Comptes et contenus de DÉMONSTRATION (npm run seed uniquement, jamais en conditions réelles) :
// sociétés, équipe, tickets, chat, factures, actualités, couverture annoncée.
import { User } from '../models/User.js';
import { Company } from '../models/Company.js';
import { Ticket, ChatMessage, ChatThread } from '../models/Support.js';
import { Invoice } from '../models/Invoice.js';
import { News, Coverage } from '../models/Content.js';
import { AuditLog } from '../models/AuditLog.js';
import { Counter } from '../models/System.js';
import { PLANS } from '../services/access.js';

const PASSWORD = 'demo12345';
const day = 86400000;
const ago = (d) => new Date(Date.now() - d * day);

async function user(email, fields) {
  const u = (await User.findOne({ email })) || new User({ email });
  Object.assign(u, { active: true, mustChangePassword: false, ...fields });
  u.set('role', undefined); u.set('plan', undefined); u.set('company', undefined);
  await u.setPassword(PASSWORD);
  await u.save();
  return u;
}

export async function seedAccounts() {
  await Promise.all([Ticket.deleteMany({}), ChatMessage.deleteMany({}), ChatThread.deleteMany({}), Invoice.deleteMany({}), News.deleteMany({}), Coverage.deleteMany({}), AuditLog.deleteMany({}), Counter.deleteMany({})]);
  const admin = await user('admin@douane-saas.eu', { name: 'Camille Martin', jobTitle: 'Administratrice', staffRole: 'admin', companyId: undefined });
  const sales = await user('commercial@douane-saas.eu', { name: 'Hugo Bernard', jobTitle: 'Responsable commercial', staffRole: 'commercial', companyId: undefined });

  const companies = [
    { key: 'demo', name: 'Démo SAS', legalName: 'Démo SAS', plan: 'pro', siret: '12345678900012', vatNumber: 'FR12123456789', city: 'Lyon', started: 400, end: 330 },
    { key: 'vins', name: 'Vins du Rhône Export', legalName: 'VRE SARL', plan: 'essentiel', siret: '98765432100015', vatNumber: 'FR45987654321', city: 'Valence', started: 200, end: 165 },
    { key: 'agro', name: 'AgroNord Négoce', legalName: 'AgroNord SA', plan: 'entreprise', siret: '45678912300021', vatNumber: 'FR78456789123', city: 'Lille', started: 700, end: 20 },
    { key: 'start', name: 'TradeLab', legalName: 'TradeLab SAS', plan: 'essai', city: 'Nantes', started: 9, end: 5 },
    { key: 'susp', name: 'Import Express', legalName: 'Import Express SARL', plan: 'essentiel', city: 'Marseille', started: 300, end: 65, status: 'suspended' },
  ];
  const co = {};
  for (const c of companies) {
    const doc = (await Company.findOne({ name: c.name })) || new Company({ name: c.name });
    Object.assign(doc, {
      legalName: c.legalName, plan: c.plan, siret: c.siret || '', vatNumber: c.vatNumber || '', status: c.status || 'active',
      address: { line1: '12 rue du Commerce', postalCode: '69002', city: c.city, country: 'France' },
      billingEmail: `compta@${c.key}.example`, phone: '+33 4 00 00 00 00',
      subscription: { start: ago(c.started), end: new Date(Date.now() + c.end * day), billing: c.key === 'agro' ? 'annuel' : 'mensuel' },
      accountManager: sales._id, featuresAdd: c.key === 'vins' ? ['forecast'] : [], notes: c.key === 'agro' ? 'Renouvellement annuel à négocier en novembre.' : '',
    });
    await doc.save();
    co[c.key] = doc;
  }
  const demo = await user('demo@douane-saas.eu', { name: 'Claire Dubois', jobTitle: 'Responsable export', companyId: co.demo._id, companyRole: 'owner', staffRole: null, lastLoginAt: new Date() });
  const member = await user('analyste@demo-sas.example', { name: 'Lucas Petit', jobTitle: 'Analyste marchés', companyId: co.demo._id, companyRole: 'member', staffRole: null, lastLoginAt: ago(1) });
  await user('stagiaire@demo-sas.example', { name: 'Emma Roux', jobTitle: 'Stagiaire', companyId: co.demo._id, companyRole: 'member', staffRole: null, active: false });
  const vins = await user('direction@vins-rhone.example', { name: 'Paul Girard', jobTitle: 'Gérant', companyId: co.vins._id, companyRole: 'owner', staffRole: null, lastLoginAt: ago(3) });
  const agro = await user('achats@agronord.example', { name: 'Sophie Laurent', jobTitle: 'Directrice des achats', companyId: co.agro._id, companyRole: 'owner', staffRole: null, lastLoginAt: ago(0.2) });
  await user('contact@tradelab.example', { name: 'Nicolas Faure', companyId: co.start._id, companyRole: 'owner', staffRole: null, lastLoginAt: ago(2) });
  await user('gestion@import-express.example', { name: 'Julie Mercier', companyId: co.susp._id, companyRole: 'owner', staffRole: null });

  // Tickets
  const msg = (u, body, d, extra = {}) => ({ author: u._id, authorName: u.name, staff: Boolean(u.staffRole), body, at: ago(d), ...extra });
  const tickets = [
    { company: co.demo, author: demo, subject: 'Données de juin manquantes pour le Portugal', category: 'donnees', priority: 'haute', status: 'en_cours', assignee: admin, unreadClient: true,
      messages: [msg(demo, 'Bonjour, les exportations portugaises de juin n\'apparaissent pas sur le code 2204 21 09. Est-ce normal ?', 2), msg(admin, 'Eurostat a publié une révision pour le Portugal ; elle sera intégrée lors de la prochaine mise à jour automatique.', 1.5), msg(admin, 'Vérifier le fichier full202606 après la révision.', 1.4, { internal: true })] },
    { company: co.demo, author: member, subject: 'Export PowerPoint : logo de la société', category: 'suggestion', status: 'ouvert', messages: [msg(member, 'Serait-il possible d\'ajouter notre logo sur les rapports PowerPoint ?', 0.5)] },
    { company: co.vins, author: vins, subject: 'Facture de septembre', category: 'facturation', status: 'attente_client', assignee: sales,
      messages: [msg(vins, 'Pouvez-vous ajouter notre numéro de bon de commande sur la facture ?', 6), msg(sales, 'Bien sûr, pouvez-vous nous communiquer ce numéro ?', 5)] },
    { company: co.agro, author: agro, subject: 'Ajout de 5 utilisateurs', category: 'compte', priority: 'normale', status: 'resolu', assignee: sales,
      messages: [msg(agro, 'Nous souhaitons ajouter 5 places à notre abonnement.', 12), msg(sales, 'C\'est fait : votre offre compte désormais 55 places.', 11)] },
    { company: co.agro, author: agro, subject: 'Accès API : documentation', category: 'technique', priority: 'urgente', status: 'ouvert', messages: [msg(agro, 'Où trouver la documentation de l\'API ? Notre équipe informatique en a besoin rapidement.', 0.1)] },
  ];
  for (const [i, t] of tickets.entries()) {
    await Ticket.create({ ...t, number: i + 1, company: t.company._id, author: t.author._id, assignee: t.assignee?._id, lastActivityAt: t.messages.at(-1).at, unreadStaff: !t.messages.at(-1).staff });
  }
  await Counter.create({ _id: 'ticket', seq: tickets.length });

  // Chat
  const chats = [
    [co.demo, [[demo, 'Bonjour, une question rapide sur les prix médians : sont-ils pondérés par les volumes ?', 0.3], [sales, 'Bonjour Claire, oui : la moitié des volumes échangés l\'est à un prix inférieur au prix médian.', 0.28], [demo, 'Parfait, merci !', 0.27]]],
    [co.agro, [[agro, 'Bonjour, pouvons-nous planifier une démonstration du comparateur pour notre équipe ?', 0.05]]],
  ];
  for (const [c, list] of chats) {
    for (const [u, body, d] of list) await ChatMessage.create({ company: c._id, author: u._id, authorName: u.name, staff: Boolean(u.staffRole), body, at: ago(d) });
    const last = list.at(-1);
    await ChatThread.create({ company: c._id, lastMessageAt: ago(last[2]), lastMessage: last[1].slice(0, 140), unreadStaff: last[0].staffRole ? 0 : 1, unreadClient: 0 });
  }

  // Factures
  let n = 0;
  const invoice = async (c, monthsAgo, status) => {
    const issue = new Date(); issue.setMonth(issue.getMonth() - monthsAgo, 1);
    const plan = PLANS[c.plan];
    n += 1;
    return Invoice.create({
      number: `F-${issue.getFullYear()}-${String(n).padStart(4, '0')}`, company: c._id, issueDate: issue, dueDate: new Date(issue.getTime() + 30 * day),
      periodFrom: issue, periodTo: new Date(issue.getFullYear(), issue.getMonth() + 1, 0),
      lines: [{ label: `Abonnement ${plan.label} — 1 mois`, quantity: 1, unitPrice: plan.monthly }],
      status, paidAt: status === 'payee' ? new Date(issue.getTime() + 10 * day) : undefined,
      billedTo: { name: c.name, legalName: c.legalName, address: c.address, vatNumber: c.vatNumber, siret: c.siret, billingEmail: c.billingEmail }, createdBy: sales._id,
    });
  };
  for (let m = 5; m >= 1; m--) await invoice(co.demo, m, 'payee');
  await invoice(co.demo, 0, 'emise');
  await invoice(co.vins, 2, 'payee');
  await invoice(co.vins, 1, 'en_retard');
  await invoice(co.agro, 1, 'payee');
  await invoice(co.susp, 3, 'en_retard');
  await Counter.create({ _id: `facture-${new Date().getFullYear()}`, seq: n });

  // Actualités et couverture annoncée
  await News.insertMany([
    { title: 'Nouvelle fiche produit : tout sur une page', body: 'Valeurs, volumes, prix médians, pays partenaires et marché mondial sont désormais réunis sur la fiche de chaque code NC.', kind: 'nouveaute', publishedAt: ago(2), author: admin._id },
    { title: 'Données de juin 2026 disponibles', body: 'Les échanges extra-UE de juin 2026 sont intégrés pour les 27 pays de l\'Union.', kind: 'donnees', publishedAt: ago(5), author: admin._id },
    { title: 'Nomenclature combinée 2026', body: 'Les changements de codes NC au 1er janvier 2026 sont pris en compte : les séries restent continues.', kind: 'nomenclature', publishedAt: ago(40), author: admin._id },
    { title: 'Maintenance programmée', body: 'Une courte interruption est prévue le premier dimanche du mois entre 6 h et 7 h.', kind: 'maintenance', publishedAt: ago(60), author: admin._id },
  ]);
  await Coverage.insertMany([
    { country: 'VN', status: 'en_cours', source: 'Douanes vietnamiennes', eta: 'T1 2027' },
    { country: 'KZ', status: 'en_cours', source: 'Bureau national des statistiques', eta: 'T1 2027' },
    { country: 'PH', status: 'prevu', source: 'Philippine Statistics Authority', eta: '2027' },
    { country: 'PE', status: 'prevu', source: 'SUNAT', eta: '2027' },
    { country: 'CO', status: 'prevu', source: 'DANE', eta: '2027' },
  ]);
  // Quelques événements au journal
  await AuditLog.insertMany([
    { at: ago(0.1), level: 'security', category: 'auth', action: 'connexion.echec', actorEmail: null, message: 'Échec de connexion pour inconnu@exemple.fr', ip: '203.0.113.7' },
    { at: ago(1), level: 'warning', category: 'abonnement', action: 'societe.abonnement.modifie', actor: sales._id, actorEmail: sales.email, company: co.agro._id, target: co.agro.name, message: `Abonnement de ${co.agro.name} modifié` },
    { at: ago(2), level: 'info', category: 'facture', action: 'facture.emise', actor: sales._id, actorEmail: sales.email, company: co.demo._id, target: 'F-0006', message: `Facture émise pour ${co.demo.name}` },
    { at: ago(3), level: 'info', category: 'donnees', action: 'donnees.mise-a-jour.lancee', actor: admin._id, actorEmail: admin.email, message: 'Mise à jour des données lancée' },
  ]);
  return { companies: Object.keys(co).length, staff: 2 };
}
