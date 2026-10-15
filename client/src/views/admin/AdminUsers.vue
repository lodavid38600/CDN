<script setup>
import { onMounted, ref, watch } from 'vue';
import { api } from '../../api.js';
import { useAuthStore } from '../../stores/auth.js';
import { useUiStore } from '../../stores/ui.js';
import { COMPANY_ROLE, STAFF_ROLE, ago } from '../../lib/labels.js';
import Modal from '../../components/Modal.vue';

// Tous les comptes : clients (par société) et équipe. Seul un administrateur gère l'équipe.
const auth = useAuthStore();
const ui = useUiStore();
const users = ref([]);
const q = ref('');
const type = ref('');
const error = ref('');
const creating = ref(false);
const companies = ref([]);
const form = ref({ kind: 'client', email: '', name: '', companyId: '', companyRole: 'member', staffRole: 'commercial' });
const secret = ref(null);

let t;
async function load() {
  try { users.value = await api('/admin/users', { params: { q: q.value, type: type.value } }); } catch (e) { error.value = e.message; }
}
watch(q, () => { clearTimeout(t); t = setTimeout(load, 250); });
watch(type, load);
onMounted(async () => { await load(); companies.value = await api('/admin/companies').catch(() => []); });
async function create() {
  const f = form.value;
  const body = f.kind === 'staff' ? { email: f.email, name: f.name, staffRole: f.staffRole } : { email: f.email, name: f.name, companyId: f.companyId, companyRole: f.companyRole };
  try {
    const r = await api('/admin/users', { method: 'POST', body });
    creating.value = false;
    secret.value = { email: r.user.email, password: r.temporaryPassword };
    await load();
  } catch (e) { error.value = e.message; }
}
async function update(u, body) {
  try { await api(`/admin/users/${u.id}`, { method: 'PUT', body }); await load(); } catch (e) { ui.toast(e.message); }
}
async function reset(u) {
  try { const r = await api(`/admin/users/${u.id}/reset-password`, { method: 'POST' }); secret.value = { email: u.email, password: r.temporaryPassword }; } catch (e) { ui.toast(e.message); }
}
const canStaff = () => auth.can('staff.manage');
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>Utilisateurs</h1><p>{{ users.length }} compte{{ users.length > 1 ? 's' : '' }}</p></div>
      <button class="btn btn-primary" @click="creating = true">＋ Nouveau compte</button>
    </div>
    <div class="filters-row">
      <label class="field">Rechercher<input v-model="q" placeholder="Nom ou e-mail" /></label>
      <label class="field">Type<select v-model="type"><option value="">Tous</option><option value="clients">Clients</option><option value="staff">Équipe</option></select></label>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <section class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Nom</th><th>E-mail</th><th>Société / équipe</th><th>Rôle</th><th>Dernière connexion</th><th>État</th><th /></tr></thead>
          <tbody>
            <tr v-for="u in users" :key="u.id">
              <td><strong>{{ u.name || '—' }}</strong></td>
              <td>{{ u.email }}</td>
              <td><RouterLink v-if="u.companyId" :to="`/equipe/societes/${u.companyId}`">{{ u.companyName }}</RouterLink><span v-else class="badge badge-accent">Équipe</span></td>
              <td>
                <select v-if="u.staffRole && canStaff() && u.id !== auth.user.id" :value="u.staffRole" aria-label="Rôle" @change="update(u, { staffRole: $event.target.value })"><option v-for="(l, k) in STAFF_ROLE" :key="k" :value="k">{{ l }}</option></select>
                <span v-else-if="u.staffRole">{{ STAFF_ROLE[u.staffRole] }}</span>
                <select v-else :value="u.companyRole" aria-label="Rôle" @change="update(u, { companyRole: $event.target.value })"><option v-for="(l, k) in COMPANY_ROLE" :key="k" :value="k">{{ l }}</option></select>
              </td>
              <td class="muted">{{ u.lastLoginAt ? ago(u.lastLoginAt) : 'jamais' }}</td>
              <td><span class="pill" :class="u.active ? 'ok' : 'muted'">{{ u.active ? 'Actif' : 'Désactivé' }}</span></td>
              <td class="num">
                <template v-if="(!u.staffRole || canStaff()) && u.id !== auth.user.id">
                  <button class="btn btn-sm btn-ghost" @click="reset(u)">Nouveau mot de passe</button>
                  <button class="btn btn-sm btn-ghost" @click="update(u, { active: !u.active })">{{ u.active ? 'Désactiver' : 'Réactiver' }}</button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <Modal v-if="creating" title="Nouveau compte" @close="creating = false">
      <form class="form-grid" @submit.prevent="create">
        <div v-if="canStaff()" class="field wide"><span>Type de compte</span><div class="seg"><button type="button" :class="{ on: form.kind === 'client' }" @click="form.kind = 'client'">Client</button><button type="button" :class="{ on: form.kind === 'staff' }" @click="form.kind = 'staff'">Équipe</button></div></div>
        <label class="field wide">E-mail<input v-model="form.email" type="email" required /></label>
        <label class="field wide">Nom<input v-model="form.name" /></label>
        <template v-if="form.kind === 'client'">
          <label class="field">Société<select v-model="form.companyId" required><option value="" disabled>Choisir…</option><option v-for="c in companies" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
          <label class="field">Rôle<select v-model="form.companyRole"><option v-for="(l, k) in COMPANY_ROLE" :key="k" :value="k">{{ l }}</option></select></label>
        </template>
        <label v-else class="field wide">Rôle dans l'équipe<select v-model="form.staffRole"><option value="commercial">Commercial : sociétés, comptes, abonnements, factures, support</option><option value="admin">Administrateur : tout, y compris le journal et le site</option></select></label>
        <div class="actions wide"><button type="button" class="btn" @click="creating = false">Annuler</button><button class="btn btn-primary">Créer</button></div>
      </form>
    </Modal>
    <Modal v-if="secret" title="Mot de passe provisoire" @close="secret = null">
      <p class="secondary">À communiquer à <strong>{{ secret.email }}</strong> (il ne sera plus affiché) :</p>
      <p class="secret" style="margin: 14px 0">{{ secret.password }}</p>
      <div class="actions"><button class="btn btn-primary" @click="secret = null">Terminé</button></div>
    </Modal>
  </div>
</template>
