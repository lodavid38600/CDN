<script setup>
import { ref, watch } from 'vue';
import { api } from '../api.js';
import { useAuthStore } from '../stores/auth.js';
import { useUiStore } from '../stores/ui.js';
import { COMPANY_ROLE, STAFF_ROLE, dateFr } from '../lib/labels.js';

const auth = useAuthStore();
const ui = useUiStore();
const profile = ref({ name: '', jobTitle: '', phone: '' });
watch(() => auth.user, (u) => { if (u) profile.value = { name: u.name, jobTitle: u.jobTitle, phone: u.phone }; }, { immediate: true });
const pw = ref({ current: '', next: '', confirm: '' });
const error = ref('');

async function saveProfile() {
  try { await api('/auth/me', { method: 'PUT', body: profile.value }); await auth.fetchMe(); ui.toast('Profil enregistré'); } catch (e) { error.value = e.message; }
}
async function savePassword() {
  error.value = '';
  if (pw.value.next !== pw.value.confirm) { error.value = 'Les deux mots de passe ne correspondent pas'; return; }
  try {
    await api('/auth/me/password', { method: 'PUT', body: { current: pw.value.current, next: pw.value.next } });
    pw.value = { current: '', next: '', confirm: '' };
    ui.toast('Mot de passe modifié');
  } catch (e) { error.value = e.message; }
}
</script>

<template>
  <div>
    <div class="page-head"><div><h1>Mon compte</h1><p>{{ auth.user?.email }}</p></div></div>
    <p v-if="error" class="error">{{ error }}</p>
    <div v-if="auth.user" class="grid grid-2">
      <section class="card">
        <div class="card-head"><div><h2>Profil</h2>
          <p v-if="auth.isStaff">Équipe DouaneData · {{ STAFF_ROLE[auth.access.staffRole] }}</p>
          <p v-else-if="auth.company">{{ auth.company.name }} · {{ COMPANY_ROLE[auth.user.companyRole] }} · membre depuis le {{ dateFr(auth.user.createdAt) }}</p>
        </div></div>
        <form class="form-grid" @submit.prevent="saveProfile">
          <label class="field">Nom<input v-model="profile.name" /></label>
          <label class="field">Fonction<input v-model="profile.jobTitle" /></label>
          <label class="field">Téléphone<input v-model="profile.phone" /></label>
          <div class="actions wide"><button class="btn btn-primary">Enregistrer</button></div>
        </form>
      </section>
      <section class="card">
        <div class="card-head"><div><h2>Mot de passe</h2><p>8 caractères minimum</p></div></div>
        <form class="form-grid" @submit.prevent="savePassword">
          <label class="field wide">Mot de passe actuel<input v-model="pw.current" type="password" required autocomplete="current-password" /></label>
          <label class="field">Nouveau mot de passe<input v-model="pw.next" type="password" required minlength="8" autocomplete="new-password" /></label>
          <label class="field">Confirmation<input v-model="pw.confirm" type="password" required minlength="8" autocomplete="new-password" /></label>
          <div class="actions wide"><button class="btn btn-primary">Changer le mot de passe</button></div>
        </form>
      </section>
      <section class="card">
        <h2>D'où viennent les données ?</h2>
        <p class="secondary" style="margin-top: 8px">Les échanges des 27 pays de l'Union européenne avec le reste du monde proviennent d'<strong>Eurostat</strong>, l'office statistique de l'Union, code produit par code produit (nomenclature combinée à 8 chiffres), mois par mois. Les valeurs sont en euros courants, les quantités en kilogrammes.</p>
        <p class="secondary" style="margin-top: 8px">Pour les pays hors Union, nous complétons avec les publications officielles des pays concernés et des Nations unies. Lorsque la nomenclature évolue, les séries restent comparables d'une année sur l'autre.</p>
        <p class="hint" style="margin-top: 8px">La liste des pays couverts et les dernières mises à jour sont sur la page d'<RouterLink to="/">accueil</RouterLink>.</p>
      </section>
    </div>
  </div>
</template>
