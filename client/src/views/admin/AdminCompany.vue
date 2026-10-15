<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../../api.js';
import { useAuthStore } from '../../stores/auth.js';
import { useUiStore } from '../../stores/ui.js';
import { COMPANY_ROLE, FEATURES, INVOICE_STATUS, TICKET_STATUS_STAFF, dateFr, ago, money, tone } from '../../lib/labels.js';
import Modal from '../../components/Modal.vue';

// Fiche société (équipe) : informations, abonnement et droits hérités par les membres,
// membres, factures, tickets, notes internes.
const props = defineProps({ id: { type: String, required: true } });
const auth = useAuthStore();
const ui = useUiStore();
const tab = ref('abonnement');
const d = ref(null);
const meta = ref(null);
const info = ref(null);
const sub = ref(null);
const error = ref('');
const secret = ref(null);
const addingMember = ref(false);
const member = ref({ email: '', name: '', companyRole: 'member' });
const invoicing = ref(false);
const inv = ref({ months: 1, lines: [], vatRate: 20, dueDays: 30, custom: false });

const d10 = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');
async function load() {
  try {
    [d.value, meta.value] = await Promise.all([api(`/admin/companies/${props.id}`), meta.value ? meta.value : api('/admin/meta')]);
    const c = d.value.company;
    info.value = { name: c.name, legalName: c.legalName, siret: c.siret, vatNumber: c.vatNumber, billingEmail: c.billingEmail, phone: c.phone, address: { ...c.address }, notes: c.notes, accountManager: c.accountManager?._id || '' };
    sub.value = {
      plan: c.plan, status: c.status, seats: c.seats, exportLimit: c.exportLimit ?? '',
      featuresAdd: [...(c.featuresAdd || [])], featuresRemove: [...(c.featuresRemove || [])],
      subscription: { start: d10(c.subscription?.start), end: d10(c.subscription?.end), billing: c.subscription?.billing || 'mensuel', price: c.subscription?.price ?? '' },
    };
  } catch (e) { error.value = e.message; }
}
onMounted(load);
const canSub = computed(() => auth.can('subscriptions.manage'));
const planFeatures = computed(() => new Set(meta.value?.plans[sub.value?.plan]?.features || []));
// Droits effectifs = offre + ajouts − retraits (ce que verront les membres)
function featureState(f) {
  if (sub.value.featuresRemove.includes(f)) return 'retire';
  if (planFeatures.value.has(f)) return 'offre';
  if (sub.value.featuresAdd.includes(f)) return 'ajoute';
  return 'non';
}
function toggleFeature(f) {
  const s = featureState(f);
  const rm = new Set(sub.value.featuresRemove);
  const add = new Set(sub.value.featuresAdd);
  if (s === 'offre') rm.add(f);
  else if (s === 'retire') rm.delete(f);
  else if (s === 'non') add.add(f);
  else add.delete(f);
  sub.value.featuresRemove = [...rm];
  sub.value.featuresAdd = [...add];
}
const FSTATE = { offre: 'Inclus dans l\'offre', ajoute: 'Ajouté', retire: 'Retiré', non: 'Non inclus' };

async function saveInfo() {
  try { await api(`/admin/companies/${props.id}`, { method: 'PUT', body: info.value }); ui.toast('Informations enregistrées'); await load(); } catch (e) { error.value = e.message; }
}
async function saveSub() {
  try {
    await api(`/admin/companies/${props.id}`, { method: 'PUT', body: { ...sub.value, seats: sub.value.seats || null, exportLimit: sub.value.exportLimit === '' ? null : sub.value.exportLimit } });
    ui.toast('Abonnement mis à jour : les membres héritent immédiatement des nouveaux droits');
    await load();
  } catch (e) { error.value = e.message; }
}
async function addMember() {
  try {
    const r = await api('/admin/users', { method: 'POST', body: { ...member.value, companyId: props.id } });
    addingMember.value = false;
    secret.value = { email: r.user.email, password: r.temporaryPassword };
    member.value = { email: '', name: '', companyRole: 'member' };
    await load();
  } catch (e) { error.value = e.message; }
}
async function updateUser(u, body) {
  try { await api(`/admin/users/${u.id}`, { method: 'PUT', body }); await load(); } catch (e) { ui.toast(e.message); }
}
async function resetUser(u) {
  try { const r = await api(`/admin/users/${u.id}/reset-password`, { method: 'POST' }); secret.value = { email: u.email, password: r.temporaryPassword }; } catch (e) { ui.toast(e.message); }
}
async function createInvoice() {
  try {
    const body = inv.value.custom ? { company: props.id, lines: inv.value.lines, vatRate: inv.value.vatRate, dueDays: inv.value.dueDays } : { company: props.id, months: inv.value.months, vatRate: inv.value.vatRate, dueDays: inv.value.dueDays };
    await api('/admin/invoices', { method: 'POST', body });
    invoicing.value = false;
    ui.toast('Facture émise');
    await load();
  } catch (e) { error.value = e.message; }
}
async function setInvoice(i, status) {
  try { await api(`/admin/invoices/${i._id}`, { method: 'PUT', body: { status } }); await load(); } catch (e) { ui.toast(e.message); }
}
const sales = computed(() => (meta.value?.staff || []));
</script>

<template>
  <div>
    <nav class="crumbs"><RouterLink to="/equipe/societes">Sociétés</RouterLink><span class="sep">›</span><span>{{ d?.company.name }}</span></nav>
    <p v-if="error" class="error">{{ error }}</p>
    <template v-if="d">
      <div class="page-head">
        <div>
          <h1>{{ d.company.name }}</h1>
          <p>
            Offre {{ d.company.planLabel }} · {{ d.members.filter((m) => m.active).length }} / {{ d.company.seats }} places ·
            {{ d.company.subscription?.end ? `échéance le ${dateFr(d.company.subscription.end)}` : 'sans échéance' }} · cliente depuis le {{ dateFr(d.company.createdAt) }}
          </p>
        </div>
        <RouterLink v-if="auth.can('logs.read')" class="btn" :to="{ path: '/equipe/journal', query: { company: id } }">Journal de la société</RouterLink>
      </div>
      <div class="tabs">
        <button v-for="[k, l] in [['abonnement', 'Abonnement et droits'], ['infos', 'Informations'], ['membres', `Membres (${d.members.length})`], ['factures', `Factures (${d.invoices.length})`], ['tickets', `Tickets (${d.tickets.length})`]]" :key="k" :class="{ on: tab === k }" @click="tab = k">{{ l }}</button>
      </div>

      <section v-if="tab === 'abonnement'" class="card">
        <p v-if="!canSub" class="hint">Lecture seule : la modification des abonnements demande le droit « abonnements ».</p>
        <form class="form-grid" @submit.prevent="saveSub">
          <label class="field">Offre<select v-model="sub.plan" :disabled="!canSub"><option v-for="(p, k) in meta.plans" :key="k" :value="k">{{ p.label }} — {{ p.monthly }} € / mois</option></select></label>
          <label class="field">État<select v-model="sub.status" :disabled="!canSub"><option value="active">Active</option><option value="suspended">Suspendue (plus d'accès aux données)</option></select></label>
          <label class="field">Début<input v-model="sub.subscription.start" type="date" :disabled="!canSub" /></label>
          <label class="field">Échéance (vide = sans limite)<input v-model="sub.subscription.end" type="date" :disabled="!canSub" /></label>
          <label class="field">Facturation<select v-model="sub.subscription.billing" :disabled="!canSub"><option value="mensuel">Mensuelle</option><option value="annuel">Annuelle</option></select></label>
          <label class="field">Prix mensuel négocié HT (vide = prix de l'offre)<input v-model="sub.subscription.price" type="number" min="0" step="0.01" :disabled="!canSub" :placeholder="`${meta.plans[sub.plan].monthly} €`" /></label>
          <label class="field">Places (vide = offre : {{ meta.plans[sub.plan].seats }})<input v-model.number="sub.seats" type="number" min="1" :disabled="!canSub" /></label>
          <label class="field">Plafond d'export CSV (vide = offre : {{ meta.plans[sub.plan].exportLimit }})<input v-model="sub.exportLimit" type="number" min="0" :disabled="!canSub" /></label>
          <div class="wide">
            <h3 class="sub">Fonctionnalités (héritées par tous les membres)</h3>
            <div class="feats">
              <button v-for="(l, f) in FEATURES" :key="f" type="button" class="feat" :class="featureState(f)" :disabled="!canSub" @click="toggleFeature(f)">
                <span class="tick">{{ ['offre', 'ajoute'].includes(featureState(f)) ? '✓' : '—' }}</span>
                <span>{{ l }}</span><span class="hint">{{ FSTATE[featureState(f)] }}</span>
              </button>
            </div>
          </div>
          <div v-if="canSub" class="actions wide"><button class="btn btn-primary">Enregistrer l'abonnement</button></div>
        </form>
      </section>

      <section v-if="tab === 'infos'" class="card">
        <form class="form-grid" @submit.prevent="saveInfo">
          <label class="field">Nom<input v-model="info.name" required /></label>
          <label class="field">Raison sociale<input v-model="info.legalName" /></label>
          <label class="field">SIRET<input v-model="info.siret" /></label>
          <label class="field">N° de TVA<input v-model="info.vatNumber" /></label>
          <label class="field wide">Adresse<input v-model="info.address.line1" /></label>
          <label class="field">Code postal<input v-model="info.address.postalCode" /></label>
          <label class="field">Ville<input v-model="info.address.city" /></label>
          <label class="field">Pays<input v-model="info.address.country" /></label>
          <label class="field">E-mail de facturation<input v-model="info.billingEmail" type="email" /></label>
          <label class="field">Téléphone<input v-model="info.phone" /></label>
          <label class="field">Commercial référent<select v-model="info.accountManager"><option value="">—</option><option v-for="s in sales" :key="s._id" :value="s._id">{{ s.name || s.email }}</option></select></label>
          <label class="field wide">Notes internes (jamais visibles du client)<textarea v-model="info.notes" rows="4" /></label>
          <div class="actions wide"><button class="btn btn-primary">Enregistrer</button></div>
        </form>
      </section>

      <section v-if="tab === 'membres'" class="card">
        <div class="card-head"><div><h2>Membres</h2><p>{{ d.seatsLeft }} place{{ d.seatsLeft > 1 ? 's' : '' }} libre{{ d.seatsLeft > 1 ? 's' : '' }}</p></div><button class="btn btn-sm btn-primary" @click="addingMember = true">＋ Ajouter</button></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th>Dernière connexion</th><th>État</th><th /></tr></thead>
            <tbody>
              <tr v-for="u in d.members" :key="u.id">
                <td><strong>{{ u.name || '—' }}</strong><div class="hint">{{ u.jobTitle }}</div></td>
                <td>{{ u.email }}</td>
                <td><select :value="u.companyRole" aria-label="Rôle" @change="updateUser(u, { companyRole: $event.target.value })"><option v-for="(l, k) in COMPANY_ROLE" :key="k" :value="k">{{ l }}</option></select></td>
                <td class="muted">{{ u.lastLoginAt ? ago(u.lastLoginAt) : 'jamais' }}</td>
                <td><span class="pill" :class="u.active ? 'ok' : 'muted'">{{ u.active ? 'Actif' : 'Désactivé' }}</span></td>
                <td class="num"><button class="btn btn-sm btn-ghost" @click="resetUser(u)">Nouveau mot de passe</button><button class="btn btn-sm btn-ghost" @click="updateUser(u, { active: !u.active })">{{ u.active ? 'Désactiver' : 'Réactiver' }}</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="tab === 'factures'" class="card">
        <div class="card-head"><div><h2>Factures</h2></div><button v-if="auth.can('invoices.manage')" class="btn btn-sm btn-primary" @click="invoicing = true">＋ Émettre une facture</button></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Numéro</th><th>Date</th><th class="num">TTC</th><th>Échéance</th><th>État</th><th /></tr></thead>
            <tbody>
              <tr v-for="i in d.invoices" :key="i._id">
                <td><RouterLink :to="`/equipe/factures/${i._id}`">{{ i.number }}</RouterLink></td><td>{{ dateFr(i.issueDate) }}</td><td class="num">{{ money(i.totalTTC) }}</td><td>{{ dateFr(i.dueDate) }}</td>
                <td><span class="pill" :class="tone(i.status)">{{ INVOICE_STATUS[i.status] }}</span></td>
                <td class="num"><template v-if="auth.can('invoices.manage') && ['emise', 'en_retard'].includes(i.status)"><button class="btn btn-sm" @click="setInvoice(i, 'payee')">Marquer payée</button><button class="btn btn-sm btn-ghost btn-danger" @click="setInvoice(i, 'annulee')">Annuler</button></template></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="!d.invoices.length" class="hint">Aucune facture.</p>
      </section>

      <section v-if="tab === 'tickets'" class="card">
        <table>
          <tbody>
            <tr v-for="t in d.tickets" :key="t._id"><td class="muted">#{{ t.number }}</td><td><RouterLink :to="`/equipe/tickets/${t._id}`">{{ t.subject }}</RouterLink></td><td><span class="pill" :class="tone(t.status)">{{ TICKET_STATUS_STAFF[t.status] }}</span></td><td class="num muted">{{ ago(t.lastActivityAt) }}</td></tr>
          </tbody>
        </table>
        <p v-if="!d.tickets.length" class="hint">Aucun ticket.</p>
      </section>
    </template>

    <Modal v-if="addingMember" title="Ajouter un membre" @close="addingMember = false">
      <form class="form-grid" @submit.prevent="addMember">
        <label class="field wide">E-mail<input v-model="member.email" type="email" required /></label>
        <label class="field">Nom<input v-model="member.name" /></label>
        <label class="field">Rôle<select v-model="member.companyRole"><option v-for="(l, k) in COMPANY_ROLE" :key="k" :value="k">{{ l }}</option></select></label>
        <div class="actions wide"><button type="button" class="btn" @click="addingMember = false">Annuler</button><button class="btn btn-primary">Créer le compte</button></div>
      </form>
    </Modal>
    <Modal v-if="invoicing" title="Émettre une facture" @close="invoicing = false">
      <form class="form-grid" @submit.prevent="createInvoice">
        <div class="field wide"><span>Contenu</span><div class="seg"><button type="button" :class="{ on: !inv.custom }" @click="inv.custom = false">Abonnement</button><button type="button" :class="{ on: inv.custom }" @click="inv.custom = true; inv.lines.length || inv.lines.push({ label: '', quantity: 1, unitPrice: 0 })">Lignes libres</button></div></div>
        <label v-if="!inv.custom" class="field">Nombre de mois<input v-model.number="inv.months" type="number" min="1" max="36" /></label>
        <template v-else>
          <div v-for="(l, i) in inv.lines" :key="i" class="line wide">
            <input v-model="l.label" placeholder="Désignation" required />
            <input v-model.number="l.quantity" type="number" min="0" step="any" aria-label="Quantité" />
            <input v-model.number="l.unitPrice" type="number" step="0.01" aria-label="Prix unitaire HT" />
          </div>
          <button type="button" class="btn btn-sm wide" @click="inv.lines.push({ label: '', quantity: 1, unitPrice: 0 })">＋ Ligne</button>
        </template>
        <label class="field">TVA (%)<input v-model.number="inv.vatRate" type="number" min="0" max="100" step="0.1" /></label>
        <label class="field">Échéance (jours)<input v-model.number="inv.dueDays" type="number" min="0" max="120" /></label>
        <div class="actions wide"><button type="button" class="btn" @click="invoicing = false">Annuler</button><button class="btn btn-primary">Émettre</button></div>
      </form>
    </Modal>
    <Modal v-if="secret" title="Mot de passe provisoire" @close="secret = null">
      <p class="secondary">À communiquer à <strong>{{ secret.email }}</strong> (il ne sera plus affiché) :</p>
      <p class="secret" style="margin: 14px 0">{{ secret.password }}</p>
      <div class="actions"><button class="btn btn-primary" @click="secret = null">Terminé</button></div>
    </Modal>
  </div>
</template>

<style scoped>
.sub { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 6px 0 8px; }
.feats { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px; }
.feat { display: grid; grid-template-columns: 22px 1fr; gap: 0 8px; text-align: left; padding: 9px 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font: inherit; font-size: 0.88rem; cursor: pointer; }
.feat .hint { grid-column: 2; }
.feat .tick { grid-row: span 2; font-weight: 700; }
.feat.offre { background: var(--accent-wash); }
.feat.ajoute { background: color-mix(in srgb, var(--good) 12%, transparent); }
.feat.retire { background: color-mix(in srgb, var(--bad) 10%, transparent); text-decoration: line-through; }
.feat:disabled { cursor: default; }
.line { display: grid; grid-template-columns: 1fr 90px 120px; gap: 8px; }
</style>
