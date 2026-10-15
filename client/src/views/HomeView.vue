<script setup>
import Loader from '../components/Loader.vue';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { useAuthStore } from '../stores/auth.js';
import { ncCode, periodLabel } from '../format.js';
import { NEWS_KIND, dateFr, ago } from '../lib/labels.js';
import NcSearch from '../components/NcSearch.vue';
import WorldMap from '../components/WorldMap.vue';
import Flag from '../components/Flag.vue';

// Accueil : l'état de l'outil, sans noyer le visiteur sous les chiffres. Actualités, dernières
// mises à jour, codes NC modifiés, pays couverts / en cours / prévus.
const auth = useAuthStore();
const router = useRouter();
const home = ref(null);
const error = ref('');
const search = ref('');

onMounted(async () => {
  try { home.value = await api('/home'); } catch (e) { error.value = e.message; }
});

const firstName = computed(() => (auth.user?.name || '').split(' ')[0]);
const STATUS = {
  disponible: { label: 'Disponible', color: 'var(--s1)' },
  reconstitue: { label: 'Reconstitué d\'après ses partenaires', color: 'var(--q2)' },
  en_cours: { label: 'En cours d\'intégration', color: 'var(--s2)' },
  prevu: { label: 'Prévu', color: 'var(--s7)' },
};
const coverage = computed(() => home.value?.coverage || []);
const categories = computed(() => Object.fromEntries(coverage.value.map((c) => [c.code, STATUS[c.status]?.color])));
const details = computed(() => Object.fromEntries(coverage.value.map((c) => [c.code, { name: c.name, lines: [STATUS[c.status]?.label, c.source, c.eta ? `Prévu : ${c.eta}` : ''].filter(Boolean) }])));
const count = (s) => coverage.value.filter((c) => c.status === s).length;
const upcoming = computed(() => coverage.value.filter((c) => ['en_cours', 'prevu'].includes(c.status)).sort((a, b) => (a.status === b.status ? 0 : a.status === 'en_cours' ? -1 : 1)));
function pick(p) {
  if (p?.code) router.push(`/produits/${p.code}`);
}
</script>

<template>
  <div>
    <div class="hero card">
      <div>
        <h1>Bonjour{{ firstName ? ` ${firstName}` : '' }}</h1>
        <p v-if="home?.period" class="secondary">
          Données disponibles de <strong>{{ periodLabel(home.period.from) }}</strong> à <strong>{{ periodLabel(home.period.to) }}</strong>
          <template v-if="home.lastUpdate"> · dernière mise à jour le {{ dateFr(home.lastUpdate) }}</template>
        </p>
      </div>
      <div v-if="auth.has('explore')" class="search">
        <label class="field">Quel produit cherchez-vous ?
          <NcSearch v-model="search" placeholder="Un mot (vin, smartphones, saumon…) ou un code NC" @select="pick" />
        </label>
        <div class="shortcuts">
          <RouterLink to="/nomenclature" class="btn btn-sm">Parcourir les produits</RouterLink>
          <RouterLink to="/pays" class="btn btn-sm">Pays partenaires</RouterLink>
          <RouterLink v-if="auth.has('compare')" to="/comparateur" class="btn btn-sm">Comparer des produits</RouterLink>
          <RouterLink to="/declarations" class="btn btn-sm">Dernières déclarations</RouterLink>
        </div>
      </div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <Loader v-if="!home && !error" text="Chargement de l'accueil…" />
    <div v-if="home" class="grid grid-3" style="margin-top: 16px">
      <section class="card">
        <div class="card-head"><div><h2>Actualités</h2><p>Les nouveautés de l'outil</p></div></div>
        <ul class="feed">
          <li v-for="n in home.news" :key="n._id">
            <div class="row"><span class="pill" :class="n.kind === 'maintenance' ? 'warn' : 'info'">{{ NEWS_KIND[n.kind] }}</span><span class="hint">{{ dateFr(n.publishedAt) }}</span></div>
            <strong>{{ n.title }}</strong>
            <p v-if="n.body" class="secondary small">{{ n.body }}</p>
          </li>
        </ul>
        <p v-if="!home.news.length" class="hint">Aucune actualité pour l'instant.</p>
      </section>
      <section class="card">
        <div class="card-head"><div><h2>Dernières mises à jour</h2><p>Données ajoutées ou révisées</p></div></div>
        <ul class="feed">
          <li v-for="(u, i) in home.updates" :key="i">
            <span class="hint">{{ ago(u.at) }}</span>
            <span>{{ u.text }}</span>
          </li>
        </ul>
        <p v-if="!home.updates.length" class="hint">Les mises à jour apparaîtront ici.</p>
      </section>
      <section class="card">
        <div class="card-head"><div><h2>Codes NC modifiés</h2><p>Changements récents de nomenclature, pris en compte automatiquement</p></div></div>
        <ul class="feed">
          <li v-for="c in home.ncChanges" :key="`${c.year}${c.from.code}`">
            <span class="hint">1er janvier {{ c.year }}</span>
            <div><span class="nc">{{ ncCode(c.from.code) }}</span> <span class="secondary small">{{ c.from.label }}</span></div>
            <div v-for="t in c.to" :key="t.code" class="to">→ <RouterLink :to="`/produits/${t.code}`" class="nc">{{ ncCode(t.code) }}</RouterLink> <span class="secondary small">{{ t.label }}</span></div>
          </li>
        </ul>
        <p v-if="!home.ncChanges.length" class="hint">Aucun changement récent.</p>
      </section>
    </div>

    <section v-if="home" class="card" style="margin-top: 16px">
      <div class="card-head">
        <div><h2>Pays couverts</h2><p>{{ count('disponible') }} pays disponibles · {{ count('reconstitue') }} reconstitués d'après les déclarations de leurs partenaires · {{ count('en_cours') }} en cours d'intégration · {{ count('prevu') }} prévus</p></div>
      </div>
      <div class="cov">
        <WorldMap :categories="categories" :category-legend="Object.values(STATUS)" :details="details" :height="400" />
        <div>
          <h3 class="sub">À venir</h3>
          <ul class="upcoming">
            <li v-for="c in upcoming" :key="c.code">
              <Flag :code="c.code" />
              <div><strong>{{ c.name }}</strong><div class="hint">{{ c.source }}</div></div>
              <div class="right"><span class="pill" :class="c.status === 'en_cours' ? 'warn' : 'muted'">{{ STATUS[c.status].label }}</span><div class="hint">{{ c.eta }}</div></div>
            </li>
          </ul>
          <p v-if="!upcoming.length" class="hint">Aucun pays annoncé pour l'instant.</p>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 24px; align-items: center; padding: 24px; }
.hero h1 { font-size: 1.8rem; margin-bottom: 6px; }
.search .field { font-size: 0.9rem; color: var(--text); font-weight: 600; }
.shortcuts { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
.feed { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
.feed li { display: grid; gap: 3px; }
.to { padding-left: 10px; }
.cov { display: grid; grid-template-columns: minmax(0, 2fr) minmax(240px, 1fr); gap: 16px; }
.sub { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 8px; }
.upcoming { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.upcoming li { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; }
.right { text-align: right; }
@media (max-width: 900px) { .hero, .cov { grid-template-columns: 1fr; } }
</style>
