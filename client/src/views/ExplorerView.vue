<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api } from '../api.js';
import { eurFull, tonnes, perKg, ncCode, periodLabel } from '../format.js';
import Flag from '../components/Flag.vue';
import { useFilterSync } from '../useFilterSync.js';
import { useAuthStore } from '../stores/auth.js';
import FilterBar from '../components/FilterBar.vue';
import Loader from '../components/Loader.vue';

// Déclarations : une ligne = un flux (pays de l'UE, partenaire, produit, sens) sur un mois.
// Deux vues : le flux des dernières déclarations (affichage progressif), et la recherche
// paginée, triée par défaut de la plus récente à la plus ancienne.
const auth = useAuthStore();
const tab = ref('live');
const result = ref({ rows: [], total: 0, page: 1, pages: 0 });
const page = ref(1);
const limit = 50;
const sort = ref('recent');
const order = ref('desc');
const exporting = ref(false);

const { filters, loading, error, reload } = useFilterSync(async (params) => {
  if (tab.value !== 'search') return;
  result.value = await api('/trade/mois', { params: { ...params, page: page.value, limit, sort: sort.value, order: order.value } });
});
// Un filtre choisi : on passe à la recherche
watch(() => JSON.stringify(filters.params), () => { page.value = 1; if (filters.activeCount) tab.value = 'search'; });
watch(tab, (t) => { if (t === 'search') reload(); else startLive(); });

const SORTS = [['recent', 'Plus récentes'], ['value', 'Valeur'], ['quantity', 'Volume'], ['price', 'Prix au kg']];
function setSort(k) {
  if (sort.value === k) order.value = order.value === 'desc' ? 'asc' : 'desc';
  else { sort.value = k; order.value = 'desc'; }
  page.value = 1;
  reload();
}
function go(p) { page.value = p; reload(); }

async function exportCsv() {
  exporting.value = true;
  try {
    const res = await api('/trade/mois.csv', { params: { ...filters.params, sort: sort.value, order: order.value }, raw: true });
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: 'declarations-mensuelles.csv' }).click();
    URL.revokeObjectURL(url);
  } catch (e) { error.value = e.message; } finally { exporting.value = false; }
}

// --- Flux des dernières déclarations : un stock de 500 lignes qui apparaissent progressivement
const BUFFER = 500;
const VISIBLE = 40;
const feed = ref([]);
const buffer = ref([]);
const livePeriod = ref('');
const paused = ref(false);
const liveLoading = ref(false);
let liveTimer;
let uid = 0;
async function startLive() {
  clearTimeout(liveTimer);
  liveLoading.value = !feed.value.length;
  try {
    const r = await api('/trade/mois', { params: { limit: BUFFER, sort: 'recent' } });
    livePeriod.value = r.window?.to || '';
    const rows = r.rows.map((x) => ({ ...x, uid: uid++ }));
    // Ordre d'apparition aléatoire ; les premières lignes s'affichent tout de suite
    for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
    feed.value = rows.splice(0, 15);
    buffer.value = rows;
    tick();
  } catch (e) { error.value = e.message; } finally { liveLoading.value = false; }
}
function tick() {
  liveTimer = setTimeout(() => {
    if (!paused.value && buffer.value.length && tab.value === 'live') {
      feed.value = [{ ...buffer.value.shift(), fresh: true }, ...feed.value].slice(0, VISIBLE);
      const row = feed.value[0]; // version réactive : le surlignage s'estompe
      setTimeout(() => { row.fresh = false; }, 1500);
    }
    if (!buffer.value.length) { startLive(); return; } // stock épuisé : on recommence avec un nouveau tirage
    tick();
  }, 900 + Math.random() * 3200);
}
onMounted(() => { if (filters.activeCount) tab.value = 'search'; else startLive(); });
onBeforeUnmount(() => clearTimeout(liveTimer));

const flowLabel = (f) => (f === 'export' ? 'Export UE' : 'Import UE');
const windowText = computed(() => {
  const w = result.value.window;
  if (!w) return '';
  return w.from === w.to ? periodLabel(w.from) : `${periodLabel(w.from)} → ${periodLabel(w.to)}`;
});
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Déclarations</h1>
        <p>Chaque ligne : les échanges d'un pays de l'UE avec un pays hors UE, pour un produit, sur un mois.</p>
      </div>
    </div>
    <div class="tabs" role="tablist">
      <button :class="{ on: tab === 'live' }" role="tab" @click="tab = 'live'"><span class="dot" />Dernières déclarations</button>
      <button :class="{ on: tab === 'search' }" role="tab" @click="tab = 'search'">Rechercher</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <section v-if="tab === 'live'" class="card">
      <div class="card-head">
        <div><h2>Déclarations de {{ livePeriod ? periodLabel(livePeriod) : '…' }}</h2><p>Le mois le plus récent de nos données · {{ buffer.length }} déclarations à venir</p></div>
        <button class="btn btn-sm" @click="paused = !paused">{{ paused ? '▶ Reprendre' : '❚❚ Pause' }}</button>
      </div>
      <Loader v-if="liveLoading" text="Chargement des dernières déclarations…" />
      <div v-else class="table-wrap">
        <table class="feed">
          <thead><tr><th>Mois</th><th>Sens</th><th>Pays de l'UE</th><th>Partenaire</th><th>Produit</th><th class="num">Valeur</th><th class="num">Volume</th><th class="num">Prix</th></tr></thead>
          <TransitionGroup tag="tbody" name="row">
            <tr v-for="r in feed" :key="r.uid" :class="{ fresh: r.fresh }">
              <td class="nowrap">{{ periodLabel(r.period, true) }}</td>
              <td><span class="pill" :class="r.flow === 'export' ? 'info' : 'warn'">{{ flowLabel(r.flow) }}</span></td>
              <td class="nowrap"><Flag :code="r.reporter" /> {{ r.reporterName }}</td>
              <td class="nowrap"><Flag :code="r.partner" /> {{ r.partnerName }}</td>
              <td class="prod"><RouterLink :to="`/produits/${r.product}`" class="nc">{{ ncCode(r.product) }}</RouterLink> <span class="desc">{{ r.description }}</span></td>
              <td class="num">{{ eurFull(r.valueEur) }}</td>
              <td class="num">{{ tonnes(r.quantityKg) }}</td>
              <td class="num">{{ perKg(r.unitPrice) }}</td>
            </tr>
          </TransitionGroup>
        </table>
      </div>
    </section>

    <template v-else>
      <FilterBar />
      <section class="card" :class="{ loading }">
        <div class="card-head">
          <div>
            <h2 v-if="loading && !result.rows.length">Déclarations</h2>
            <h2 v-else>{{ new Intl.NumberFormat('fr-FR').format(result.total) }}{{ result.capped ? '+' : '' }} déclarations</h2>
            <p>{{ windowText }}<span v-if="result.window?.kind !== 'product'"> · {{ result.window?.kind === 'country' ? 'avec seulement des pays, la recherche porte sur 12 mois au plus' : 'sans filtre, la recherche porte sur 3 mois au plus' }} : choisissez un produit pour tout l'historique</span></p>
          </div>
          <div class="row">
            <div class="seg" role="group" aria-label="Trier par">
              <button v-for="[k, l] in SORTS" :key="k" :class="{ on: sort === k }" @click="setSort(k)">{{ l }}{{ sort === k ? (order === 'desc' ? ' ↓' : ' ↑') : '' }}</button>
            </div>
            <button v-if="auth.has('export')" class="btn btn-sm" :disabled="exporting || !result.total" @click="exportCsv">{{ exporting ? 'Export…' : 'Exporter en CSV' }}</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Mois</th><th>Sens</th><th>Pays de l'UE</th><th>Partenaire</th><th>Produit</th><th class="num">Valeur</th><th class="num">Volume</th><th class="num">Prix</th></tr></thead>
            <tbody>
              <tr v-for="r in result.rows" :key="`${r.period}${r.reporter}${r.partner}${r.product}${r.flow}`">
                <td class="nowrap">{{ periodLabel(r.period, true) }}</td>
                <td><span class="pill" :class="r.flow === 'export' ? 'info' : 'warn'">{{ flowLabel(r.flow) }}</span></td>
                <td class="nowrap"><Flag :code="r.reporter" /> {{ r.reporterName }}</td>
                <td class="nowrap"><Flag :code="r.partner" /> {{ r.partnerName }}</td>
                <td class="prod"><RouterLink :to="`/produits/${r.product}`" class="nc">{{ ncCode(r.product) }}</RouterLink> <span class="desc">{{ r.description }}</span></td>
                <td class="num">{{ eurFull(r.valueEur) }}</td>
                <td class="num">{{ tonnes(r.quantityKg) }}</td>
                <td class="num">{{ perKg(r.unitPrice) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <Loader v-if="loading && !result.rows.length" text="Recherche des déclarations…" />
        <p v-else-if="!loading && !result.rows.length" class="empty">Aucune déclaration pour ces critères.</p>
        <div v-if="result.pages > 1" class="pager">
          <button class="btn btn-sm" :disabled="page <= 1" @click="go(page - 1)">‹ Précédent</button>
          <span class="hint">Page {{ page }} / {{ result.pages }}</span>
          <button class="btn btn-sm" :disabled="page >= result.pages" @click="go(page + 1)">Suivant ›</button>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--good); margin-right: 8px; animation: pulse 1.6s infinite; }
@keyframes pulse { 50% { opacity: 0.3; } }
.nowrap { white-space: nowrap; }
.prod { min-width: 240px; }
.desc { color: var(--text-2); font-size: 0.86rem; }
.feed tbody tr.fresh td { background: var(--accent-wash); }
.feed tbody td { transition: background 1.2s; }
.row-enter-from { opacity: 0; transform: translateY(-8px); }
.row-enter-active { transition: opacity 0.4s, transform 0.4s; }
.row-leave-active { display: none; }
.pager { display: flex; gap: 12px; justify-content: center; align-items: center; margin-top: 12px; }
</style>
