<script setup>
import { computed, ref } from 'vue';
import { api } from '../api.js';
import { eur, tonnes, percent } from '../format.js';
import { useFilterSync } from '../useFilterSync.js';
import FilterBar from '../components/FilterBar.vue';
import KpiCard from '../components/KpiCard.vue';
import TopTable from '../components/TopTable.vue';
import TrendChart from '../components/charts/TrendChart.vue';
import BarCompare from '../components/charts/BarCompare.vue';

const metric = ref('Eur');
const summary = ref(null);
const series = ref([]);
const partners = ref([]);
const reporters = ref([]);
const sections = ref([]);
const products = ref([]);
const showTable = ref(false);

const { filters, loading, error } = useFilterSync(async (params) => {
  const top = (dimension, limit) => api('/stats/top', { params: { ...params, dimension, limit } });
  [summary.value, series.value, partners.value, reporters.value, sections.value, products.value] = await Promise.all([
    api('/stats/summary', { params }),
    api('/stats/timeseries', { params }),
    top('partner', 10),
    top('reporter', 10),
    top('section', 21),
    top('product', 10),
  ]);
});

const fmt = computed(() => (metric.value === 'Kg' ? tonnes : eur));
const flowLabel = computed(() => ({ import: 'importations', export: 'exportations' })[filters.flow] || 'échanges totaux');
const period = computed(() => {
  const ys = series.value.map((r) => r.year);
  return ys.length ? (ys[0] === ys.at(-1) ? `${ys[0]}` : `${ys[0]}–${ys.at(-1)}`) : '';
});

function addFilter(key, value) {
  if (!filters[key].includes(value)) filters[key] = [...filters[key], value];
}
</script>

<template>
  <div :class="{ loading }">
    <div class="page-head">
      <div>
        <h1>Tableau de bord</h1>
        <p>Échanges des pays de l'UE avec les pays hors UE<span v-if="period"> · {{ period }}</span></p>
      </div>
      <div class="seg" role="group" aria-label="Mesure">
        <button class="btn btn-sm" :class="{ 'btn-primary': metric === 'Eur' }" @click="metric = 'Eur'">Valeur (€)</button>
        <button class="btn btn-sm" :class="{ 'btn-primary': metric === 'Kg' }" @click="metric = 'Kg'">Quantité (t)</button>
      </div>
    </div>

    <FilterBar />
    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="summary" class="kpis">
      <KpiCard dot="import" label="Importations" :value="fmt(summary[`import${metric}`])"
        :change="summary.changeImport" :change-label="summary.latestYear ? `${summary.latestYear} vs ${summary.latestYear - 1}` : ''" />
      <KpiCard dot="export" label="Exportations" :value="fmt(summary[`export${metric}`])"
        :change="summary.changeExport" :change-label="summary.latestYear ? `${summary.latestYear} vs ${summary.latestYear - 1}` : ''" />
      <KpiCard label="Solde commercial" :value="`${summary.balanceEur >= 0 ? '+' : ''}${eur(summary.balanceEur)}`"
        :sub="summary.balanceEur >= 0 ? 'Excédent (export > import)' : 'Déficit (import > export)'" />
      <KpiCard label="Taux de couverture" :value="summary.importEur ? percent(summary.exportEur / summary.importEur).replace('+', '') : '—'" sub="Exportations / importations" />
      <KpiCard label="Codes NC couverts" :value="String(summary.productCount)" :sub="`Dernière année : ${summary.latestYear ?? '—'}`" />
    </div>

    <section class="card" style="margin-bottom: 16px">
      <div class="card-head">
        <div>
          <h2>Évolution annuelle</h2>
          <p>Importations et exportations extra-UE, {{ metric === 'Kg' ? 'en tonnes' : 'en euros courants' }}</p>
        </div>
        <button class="btn btn-sm" @click="showTable = !showTable">{{ showTable ? 'Graphique' : 'Tableau' }}</button>
      </div>
      <TrendChart v-if="!showTable" :rows="series" :metric="metric" />
      <div v-else class="table-wrap">
        <table>
          <thead><tr><th>Année</th><th class="num">Importations</th><th class="num">Exportations</th><th class="num">Solde</th></tr></thead>
          <tbody>
            <tr v-for="r in series" :key="r.year">
              <td>{{ r.year }}</td><td class="num">{{ fmt(r[`import${metric}`]) }}</td><td class="num">{{ fmt(r[`export${metric}`]) }}</td><td class="num">{{ eur(r.balanceEur) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div class="grid grid-2">
      <section class="card">
        <div class="card-head"><div><h2>Principaux partenaires hors UE</h2><p>Classés par {{ flowLabel }} · cliquer pour filtrer</p></div></div>
        <BarCompare :rows="partners" :metric="metric" @select="(r) => addFilter('partners', r.key)" />
      </section>
      <section class="card">
        <div class="card-head"><div><h2>Pays UE déclarants</h2><p>Classés par {{ flowLabel }} · cliquer pour filtrer</p></div></div>
        <BarCompare :rows="reporters" :metric="metric" @select="(r) => addFilter('reporters', r.key)" />
      </section>
      <section class="card">
        <div class="card-head"><div><h2>Par catégorie (section NC)</h2><p>Cliquer pour filtrer sur une section</p></div></div>
        <BarCompare :rows="sections.map((s) => ({ ...s, label: `${s.key} · ${s.label}` }))" :metric="metric" :max-label="30" @select="(r) => addFilter('sections', r.key)" />
      </section>
      <section class="card">
        <div class="card-head"><div><h2>Top codes NC</h2><p>Classés par {{ flowLabel }}</p></div><RouterLink :to="{ path: '/explorer', query: filters.toQuery() }" class="btn btn-sm">Explorer →</RouterLink></div>
        <TopTable :rows="products" key-label="Code NC" link-products />
      </section>
    </div>
  </div>
</template>

<style scoped>
.seg { display: flex; gap: 4px; }
</style>
