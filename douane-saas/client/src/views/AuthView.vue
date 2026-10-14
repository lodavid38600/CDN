<script setup>
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const mode = ref('login');
const form = reactive({ email: '', password: '', name: '', company: '' });
const error = ref('');
const busy = ref(false);

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    if (mode.value === 'login') await auth.login(form.email, form.password);
    else await auth.register({ ...form });
    const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : '/';
    router.push(redirect);
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
function demo() {
  mode.value = 'login';
  Object.assign(form, { email: 'demo@douane-saas.eu', password: 'demo12345' });
  submit();
}
</script>

<template>
  <div class="auth">
    <section class="pitch">
      <div class="brand"><span class="logo">D</span>DouaneData</div>
      <h1>Les données douanières européennes, code NC par code NC.</h1>
      <p>Analysez les importations et exportations des 27 pays de l'UE avec le reste du monde, à partir des statistiques Eurostat Comext.</p>
      <ul>
        <li>Codes NC à 8 chiffres classés par section et chapitre de la nomenclature combinée</li>
        <li>Filtres par année, flux, pays déclarant, partenaire hors UE et catégorie</li>
        <li>Graphiques d'évolution, classements des partenaires et soldes commerciaux</li>
        <li>Export CSV des données filtrées</li>
      </ul>
    </section>
    <section class="card form-card">
      <div class="tabs" role="tablist">
        <button role="tab" :aria-selected="mode === 'login'" :class="{ on: mode === 'login' }" @click="mode = 'login'">Connexion</button>
        <button role="tab" :aria-selected="mode === 'register'" :class="{ on: mode === 'register' }" @click="mode = 'register'">Créer un compte</button>
      </div>
      <form @submit.prevent="submit">
        <template v-if="mode === 'register'">
          <label class="field">Nom<input v-model="form.name" autocomplete="name" /></label>
          <label class="field">Société<input v-model="form.company" autocomplete="organization" /></label>
        </template>
        <label class="field">E-mail<input v-model="form.email" type="email" required autocomplete="email" /></label>
        <label class="field">Mot de passe<input v-model="form.password" type="password" required :minlength="mode === 'register' ? 8 : undefined" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" /></label>
        <p v-if="error" class="error">{{ error }}</p>
        <button class="btn btn-primary" :disabled="busy">{{ mode === 'login' ? 'Se connecter' : 'Créer mon compte' }}</button>
      </form>
      <div class="demo">
        <span class="muted">Pas encore de compte ?</span>
        <button class="btn btn-sm" :disabled="busy" @click="demo">Essayer avec le compte démo</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.auth { min-height: 100vh; display: grid; grid-template-columns: 1.1fr 1fr; gap: 48px; align-items: center; max-width: 1080px; margin: 0 auto; padding: 32px 16px; }
.brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 1.1rem; margin-bottom: 24px; }
.logo { width: 30px; height: 30px; border-radius: 8px; background: var(--accent); color: #fff; display: grid; place-items: center; }
.pitch h1 { font-size: 2rem; letter-spacing: -0.02em; }
.pitch p { color: var(--text-2); font-size: 1.05rem; }
.pitch ul { padding-left: 18px; color: var(--text-2); display: grid; gap: 6px; }
.form-card { padding: 24px; }
.tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--grid); }
.tabs button { background: none; border: 0; padding: 8px 12px; font: inherit; color: var(--text-2); cursor: pointer; border-bottom: 2px solid transparent; }
.tabs button.on { color: var(--text); border-color: var(--accent); font-weight: 600; }
form { display: grid; gap: 12px; }
.demo { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--grid); font-size: 0.88rem; flex-wrap: wrap; }
@media (max-width: 800px) { .auth { grid-template-columns: 1fr; gap: 24px; } .pitch h1 { font-size: 1.5rem; } }
</style>
