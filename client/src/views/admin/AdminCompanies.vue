<script setup>
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../../api.js';
import { dateFr, tone } from '../../lib/labels.js';
import Modal from '../../components/Modal.vue';

const router = useRouter();
const list = ref([]);
const q = ref('');
const plan = ref('');
const status = ref('');
const error = ref('');
const creating = ref(false);
const form = ref({ name: '', ownerEmail: '', ownerName: '', plan: 'essai', trialDays: 14 });
const created = ref(null);
const PLAN = { essai: 'Essai', essentiel: 'Essentiel', pro: 'Pro', entreprise: 'Entreprise' };

let t;
async function load() {
  try { list.value = await api('/admin/companies', { params: { q: q.value, plan: plan.value, status: status.value } }); } catch (e) { error.value = e.message; }
}
watch(q, () => { clearTimeout(t); t = setTimeout(load, 250); });
watch([plan, status], load);
onMounted(load);
async function create() {
  try {
    const r = await api('/admin/companies', { method: 'POST', body: form.value });
    creating.value = false;
    created.value = r;
    await load();
  } catch (e) { error.value = e.message; }
}
const state = (c) => (c.status === 'suspended' ? 'suspended' : c.subscription?.end && new Date(c.subscription.end) < new Date() ? 'expired' : 'active');
const STATE = { active: 'Active', suspended: 'Suspendue', expired: 'Échue' };
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>Sociétés clientes</h1><p>{{ list.length }} société{{ list.length > 1 ? 's' : '' }}</p></div>
      <button class="btn btn-primary" @click="creating = true">＋ Nouvelle société</button>
    </div>
    <div class="filters-row">
      <label class="field">Rechercher<input v-model="q" placeholder="Nom, SIRET, e-mail…" /></label>
      <label class="field">Offre<select v-model="plan"><option value="">Toutes</option><option v-for="(l, k) in PLAN" :key="k" :value="k">{{ l }}</option></select></label>
      <label class="field">État<select v-model="status"><option value="">Tous</option><option value="active">Actives</option><option value="expiring">Échéance sous 30 jours</option><option value="expired">Échues</option><option value="suspended">Suspendues</option></select></label>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <section class="card">
      <div class="table-wrap">
        <table class="clickable">
          <thead><tr><th>Société</th><th>Offre</th><th class="num">Membres</th><th>Échéance</th><th>Commercial</th><th>État</th></tr></thead>
          <tbody>
            <tr v-for="c in list" :key="c.id" @click="router.push(`/equipe/societes/${c.id}`)">
              <td><strong>{{ c.name }}</strong><div class="hint">{{ c.legalName || c.billingEmail }}</div></td>
              <td>{{ PLAN[c.plan] }}<span v-if="c.featuresAdd?.length || c.featuresRemove?.length" class="hint"> · ajusté</span></td>
              <td class="num">{{ c.members }} / {{ c.seats }}</td>
              <td>{{ c.subscription?.end ? dateFr(c.subscription.end) : 'Sans échéance' }}</td>
              <td class="muted">{{ c.accountManager?.name || '—' }}</td>
              <td><span class="pill" :class="tone(state(c))">{{ STATE[state(c)] }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!list.length" class="empty">Aucune société.</p>
    </section>

    <Modal v-if="creating" title="Nouvelle société" @close="creating = false">
      <form class="form-grid" @submit.prevent="create">
        <label class="field wide">Nom de la société<input v-model="form.name" required /></label>
        <label class="field">E-mail du responsable<input v-model="form.ownerEmail" type="email" required /></label>
        <label class="field">Nom du responsable<input v-model="form.ownerName" /></label>
        <label class="field">Offre<select v-model="form.plan"><option v-for="(l, k) in PLAN" :key="k" :value="k">{{ l }}</option></select></label>
        <label v-if="form.plan === 'essai'" class="field">Durée de l'essai (jours)<input v-model.number="form.trialDays" type="number" min="1" max="90" /></label>
        <div class="actions wide"><button type="button" class="btn" @click="creating = false">Annuler</button><button class="btn btn-primary">Créer</button></div>
      </form>
    </Modal>
    <Modal v-if="created" title="Société créée" @close="created = null">
      <p class="secondary">Communiquez à <strong>{{ created.owner.email }}</strong> son mot de passe provisoire (il ne sera plus affiché) :</p>
      <p class="secret" style="margin: 14px 0">{{ created.temporaryPassword }}</p>
      <div class="actions"><RouterLink :to="`/equipe/societes/${created.company.id}`" class="btn btn-primary">Ouvrir la fiche</RouterLink></div>
    </Modal>
  </div>
</template>
