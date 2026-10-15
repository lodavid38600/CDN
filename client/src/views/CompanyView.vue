<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { useAuthStore } from '../stores/auth.js';
import { useUiStore } from '../stores/ui.js';
import { COMPANY_ROLE, FEATURES, dateFr, ago } from '../lib/labels.js';
import Modal from '../components/Modal.vue';

// Ma société : coordonnées, abonnement et membres. Les responsables modifient et gèrent les membres.
const auth = useAuthStore();
const ui = useUiStore();
const manage = computed(() => auth.can('company.manage'));
const company = ref(null);
const seatsLeft = ref(0);
const members = ref([]);
const form = ref(null);
const error = ref('');
const adding = ref(false);
const newMember = ref({ email: '', name: '', jobTitle: '', companyRole: 'member' });
const secret = ref(null);

async function load() {
  try {
    const r = await api('/company');
    company.value = r.company;
    seatsLeft.value = r.seatsLeft;
    form.value = JSON.parse(JSON.stringify({ name: r.company.name, legalName: r.company.legalName, siret: r.company.siret, vatNumber: r.company.vatNumber, billingEmail: r.company.billingEmail, phone: r.company.phone, address: r.company.address || {} }));
    members.value = await api('/company/members');
  } catch (e) { error.value = e.message; }
}
async function save() {
  try {
    company.value = (await api('/company', { method: 'PUT', body: form.value })).company;
    await auth.fetchMe();
    ui.toast('Informations enregistrées');
  } catch (e) { error.value = e.message; }
}
async function add() {
  try {
    const r = await api('/company/members', { method: 'POST', body: newMember.value });
    adding.value = false;
    secret.value = { email: r.member.email, password: r.temporaryPassword };
    newMember.value = { email: '', name: '', jobTitle: '', companyRole: 'member' };
    await load();
  } catch (e) { error.value = e.message; }
}
async function update(m, change) {
  try { await api(`/company/members/${m.id}`, { method: 'PUT', body: change }); await load(); } catch (e) { ui.toast(e.message); }
}
async function reset(m) {
  try { const r = await api(`/company/members/${m.id}/reset-password`, { method: 'POST' }); secret.value = { email: m.email, password: r.temporaryPassword }; } catch (e) { ui.toast(e.message); }
}
const features = computed(() => (auth.access?.features || []).map((f) => FEATURES[f]).filter(Boolean));
onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>{{ company?.name || 'Ma société' }}</h1>
        <p>{{ manage ? 'Vous êtes responsable de ce compte : vous gérez ses informations et ses membres.' : 'Les informations sont gérées par les responsables de votre société.' }}</p>
      </div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <template v-if="company">
      <div class="grid grid-2">
        <section class="card">
          <div class="card-head"><div><h2>Abonnement</h2><p>Les droits de chaque membre découlent de cet abonnement</p></div></div>
          <dl class="dl">
            <dt>Offre</dt><dd><strong>{{ company.planLabel }}</strong></dd>
            <dt>Échéance</dt><dd>{{ company.subscription?.end ? dateFr(company.subscription.end) : 'Sans échéance' }}</dd>
            <dt>Places</dt><dd>{{ company.seats - seatsLeft }} utilisée{{ company.seats - seatsLeft > 1 ? 's' : '' }} sur {{ company.seats }}</dd>
            <dt>Inclus</dt><dd><ul class="feat"><li v-for="f in features" :key="f">{{ f }}</li></ul></dd>
          </dl>
          <p class="hint">Pour changer d'offre ou ajouter des places, <RouterLink to="/assistance">contactez notre équipe</RouterLink>.</p>
        </section>
        <section class="card">
          <div class="card-head"><div><h2>Coordonnées</h2><p>Utilisées sur vos factures</p></div></div>
          <form class="form-grid" @submit.prevent="save">
            <label class="field">Nom<input v-model="form.name" :disabled="!manage" required /></label>
            <label class="field">Raison sociale<input v-model="form.legalName" :disabled="!manage" /></label>
            <label class="field">SIRET<input v-model="form.siret" :disabled="!manage" /></label>
            <label class="field">N° de TVA<input v-model="form.vatNumber" :disabled="!manage" /></label>
            <label class="field wide">Adresse<input v-model="form.address.line1" :disabled="!manage" /></label>
            <label class="field">Code postal<input v-model="form.address.postalCode" :disabled="!manage" /></label>
            <label class="field">Ville<input v-model="form.address.city" :disabled="!manage" /></label>
            <label class="field">Pays<input v-model="form.address.country" :disabled="!manage" /></label>
            <label class="field">E-mail de facturation<input v-model="form.billingEmail" type="email" :disabled="!manage" /></label>
            <label class="field">Téléphone<input v-model="form.phone" :disabled="!manage" /></label>
            <div v-if="manage" class="actions wide"><button class="btn btn-primary">Enregistrer</button></div>
          </form>
        </section>
      </div>

      <section class="card" style="margin-top: 16px">
        <div class="card-head">
          <div><h2>Membres ({{ members.filter((m) => m.active !== false).length }})</h2><p>{{ manage ? `${seatsLeft} place${seatsLeft > 1 ? 's' : ''} disponible${seatsLeft > 1 ? 's' : ''}` : 'Personnes ayant accès à l\'outil' }}</p></div>
          <button v-if="manage" class="btn btn-primary btn-sm" :disabled="seatsLeft <= 0" @click="adding = true">＋ Ajouter un membre</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Nom</th><th v-if="manage">E-mail</th><th>Rôle</th><th v-if="manage">Dernière connexion</th><th v-if="manage">État</th><th v-if="manage" /></tr></thead>
            <tbody>
              <tr v-for="m in members" :key="m.id">
                <td><strong>{{ m.name || m.email }}</strong> <span v-if="m.id === auth.user?.id" class="muted small">(vous)</span><div v-if="m.jobTitle" class="hint">{{ m.jobTitle }}</div></td>
                <td v-if="manage">{{ m.email }}</td>
                <td>
                  <select v-if="manage && m.id !== auth.user?.id" :value="m.companyRole" aria-label="Rôle" @change="update(m, { companyRole: $event.target.value })">
                    <option v-for="(l, k) in COMPANY_ROLE" :key="k" :value="k">{{ l }}</option>
                  </select>
                  <span v-else>{{ COMPANY_ROLE[m.companyRole] }}</span>
                </td>
                <td v-if="manage" class="muted">{{ m.lastLoginAt ? ago(m.lastLoginAt) : 'jamais' }}</td>
                <td v-if="manage"><span class="pill" :class="m.active ? 'ok' : 'muted'">{{ m.active ? 'Actif' : 'Désactivé' }}</span></td>
                <td v-if="manage" class="num">
                  <template v-if="m.id !== auth.user?.id">
                    <button class="btn btn-sm btn-ghost" @click="reset(m)">Nouveau mot de passe</button>
                    <button class="btn btn-sm btn-ghost" :class="{ 'btn-danger': m.active }" @click="update(m, { active: !m.active })">{{ m.active ? 'Désactiver' : 'Réactiver' }}</button>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <Modal v-if="adding" title="Ajouter un membre" @close="adding = false">
      <form class="form-grid" @submit.prevent="add">
        <label class="field wide">E-mail<input v-model="newMember.email" type="email" required /></label>
        <label class="field">Nom<input v-model="newMember.name" /></label>
        <label class="field">Fonction<input v-model="newMember.jobTitle" /></label>
        <label class="field wide">Rôle<select v-model="newMember.companyRole"><option value="member">Membre : utilise l'outil</option><option value="owner">Responsable : gère aussi la société et les factures</option></select></label>
        <div class="actions wide"><button type="button" class="btn" @click="adding = false">Annuler</button><button class="btn btn-primary">Créer le compte</button></div>
      </form>
    </Modal>
    <Modal v-if="secret" title="Mot de passe provisoire" @close="secret = null">
      <p class="secondary">Communiquez ce mot de passe à <strong>{{ secret.email }}</strong>. Il ne sera plus affiché ; il devra être changé à la première connexion.</p>
      <p class="secret" style="margin: 14px 0">{{ secret.password }}</p>
      <div class="actions"><button class="btn btn-primary" @click="secret = null">J'ai noté le mot de passe</button></div>
    </Modal>
  </div>
</template>

<style scoped>
.dl { display: grid; grid-template-columns: 110px 1fr; gap: 8px 12px; margin: 0 0 12px; }
.dl dt { color: var(--text-2); font-size: 0.86rem; }
.dl dd { margin: 0; }
.feat { margin: 0; padding-left: 18px; display: grid; gap: 2px; font-size: 0.9rem; }
</style>
