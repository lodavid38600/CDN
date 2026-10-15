<script setup>
import { onMounted } from 'vue';
import { useAuthStore } from '../stores/auth.js';

const auth = useAuthStore();
onMounted(() => auth.fetchMe().catch(() => {}));

const plans = [
  { id: 'free', name: 'Gratuit', price: '0 €', features: ['Tableau de bord et graphiques', 'Explorateur et filtres', 'Export CSV limité à 1 000 lignes'] },
  { id: 'pro', name: 'Pro', price: '49 € / mois', features: ['Tout le plan Gratuit', 'Export CSV jusqu\'à 100 000 lignes', 'Accès API (jeton JWT)', 'Support prioritaire'] },
];
</script>

<template>
  <div>
    <div class="page-head"><div><h1>Mon compte</h1><p>Profil, offre et sources de données</p></div></div>
    <div class="grid grid-2">
      <section v-if="auth.user" class="card">
        <h2>Profil</h2>
        <dl>
          <dt>E-mail</dt><dd>{{ auth.user.email }}</dd>
          <dt>Nom</dt><dd>{{ auth.user.name || '—' }}</dd>
          <dt>Société</dt><dd>{{ auth.user.company || '—' }}</dd>
          <dt>Offre</dt><dd><span class="badge">{{ auth.user.plan === 'pro' ? 'Pro' : 'Gratuit' }}</span></dd>
        </dl>
      </section>
      <section class="card">
        <h2>Sources</h2>
        <p class="secondary">Les données proviennent de la base <strong>Comext</strong> d'Eurostat (commerce international de marchandises de l'UE, nomenclature combinée à 8 chiffres). Valeurs en euros courants, quantités en kilogrammes. Flux « extra-UE » : échanges des 27 États membres avec les pays tiers.</p>
        <p class="muted">Les données de démonstration sont simulées à partir de codes NC réels ; lancez l'import Eurostat pour charger les données officielles.</p>
      </section>
    </div>
    <h2 style="margin: 24px 0 12px">Offres</h2>
    <div class="grid grid-2">
      <section v-for="p in plans" :key="p.id" class="card plan" :class="{ current: auth.user?.plan === p.id }">
        <div class="card-head"><h2>{{ p.name }}</h2><strong>{{ p.price }}</strong></div>
        <ul><li v-for="f in p.features" :key="f">{{ f }}</li></ul>
        <span v-if="auth.user?.plan === p.id" class="badge">Offre actuelle</span>
      </section>
    </div>
  </div>
</template>

<style scoped>
dl { display: grid; grid-template-columns: 100px 1fr; gap: 8px; margin: 12px 0 0; }
dt { color: var(--muted); }
dd { margin: 0; }
.plan ul { padding-left: 18px; color: var(--text-2); }
.plan.current { border-color: var(--accent); }
</style>
