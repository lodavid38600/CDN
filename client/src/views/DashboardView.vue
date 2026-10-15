<script setup>
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { eur, tonnes, sharePct, rangeLabel, integer, periodLabel } from '../format.js';
import { useFilterSync } from '../useFilterSync.js';
import { useReportsStore } from '../stores/reports.js';
import { trendSpec, rankSpec, hbarHeight } from '../lib/specs.js';
import { kpiBlock, narrativeBlock, rankTableBlock, sourceBlock } from '../lib/reportBlocks.js';
import FilterBar from '../components/FilterBar.vue';
import KpiCard from '../components/KpiCard.vue';
import ChartCard from '../components/ChartCard.vue';
import RankTable from '../components/RankTable.vue';
import PeriodDrawer from '../components/PeriodDrawer.vue';
import QuickQuestion from '../components/QuickQuestion.vue';
import GranularityPicker from '../components/GranularityPicker.vue';
import { bestGranularity, GRANULARITY_WORD } from '../lib/granularity.js';

const router = useRouter();
const reports = useReportsStore();
const measure = ref('value');
const granularity = ref('month');
const chartKind = ref('line');
const withForecast = ref(true);
const summary = ref(null);
const series = ref([]);
const fc = ref(null);
const partners = ref([]);
const reporters = ref([]);
const sections = ref([]);
const products = ref([]);
const drawer = ref('');
const generating = ref(false);

const { filters, meta, loading, error, reload } = useFilterSync(async (params) => {
  const top = (dimension, limit) => api('/stats/top', { params: { ...params, dimension, limit } });
  [summary.value, series.value, partners.value, reporters.value, sections.value, products.value] = await Promise.all([
    api('/stats/summary', { params }),
    api('/stats/timeseries', { params: { ...params, granularity: granularity.value } }),
    top('partner', 12),
    top('reporter', 12),
    top('section', 21),
    top('product', 12),
  ]);
  await loadForecast(params);
});

async function loadForecast(params = filters.params) {
  fc.value = withForecast.value
    ? await api('/stats/forecast', { params: { ...params, granularity: granularity.value, horizon: { month: 12, quarter: 4, year: 3 }[granularity.value], measure: measure.value } })
    : null;
}
watch([granularity], () => reload());
// Pas de temps adapté à la période choisie (mois, trimestre ou année).
watch(() => [filters.periodFrom, filters.periodTo, meta.loaded], () => {
  if (meta.loaded) granularity.value = bestGranularity(filters.periodFrom, filters.periodTo, meta);
}, { immediate: true });
watch([withForecast, measure], () => loadForecast().catch(() => {}));

const fmt = computed(() => (measure.value === 'quantity' ? tonnes : eur));
const mk = computed(() => (measure.value === 'quantity' ? 'Kg' : 'Eur'));
const flowLabel = computed(() => ({ import: 'importations', export: 'exportations' })[filters.flow] || 'échanges totaux');
const periodText = computed(() => (summary.value?.period ? rangeLabel(summary.value.period.from, summary.value.period.to) : ''));
const refText = computed(() => (summary.value?.reference ? `${rangeLabel(summary.value.reference.from, summary.value.reference.to)} vs N-1` : ''));
const sparkImport = computed(() => series.value.slice(-24).map((r) => r[`import${mk.value}`]));
const sparkExport = computed(() => series.value.slice(-24).map((r) => r[`export${mk.value}`]));

const trend = computed(() =>
  trendSpec({
    rows: series.value, fc: chartKind.value === 'line' ? fc.value : null, measure: measure.value, kind: chartKind.value === 'line' ? 'line' : 'bar',
    title: `Évolution ${GRANULARITY_WORD[granularity.value]} des échanges`,
    subtitle: `Importations et exportations extra-UE${measure.value === 'quantity' ? ', en tonnes' : ', en euros courants'} · ${periodText.value}`,
  })
);
const partnerSpec = computed(() => rankSpec({ rows: partners.value, measure: measure.value, title: 'Principaux partenaires hors UE', subtitle: `Classés par ${flowLabel.value} · cliquer pour filtrer` }));
const reporterSpec = computed(() => rankSpec({ rows: reporters.value, measure: measure.value, title: 'Pays UE déclarants', subtitle: `Classés par ${flowLabel.value} · cliquer pour filtrer` }));
const sectionSpec = computed(() => rankSpec({ rows: sections.value, measure: measure.value, title: 'Répartition par section NC', subtitle: 'Cliquer pour filtrer sur une section', labelFn: (r) => `${r.key} · ${r.label}` }));

function pickPeriod(i) {
  const r = series.value[i];
  if (r) drawer.value = r.period;
}
function addFilter(key, value) {
  if (value && !filters[key].includes(value)) filters[key] = [...filters[key], value];
}
function applyQuestion(p) {
  Object.assign(filters, { reporters: p.reporters, partners: p.partners, product: p.product, periodFrom: p.periodFrom, periodTo: p.periodTo, flow: p.flow });
  document.querySelector('.filters')?.scrollIntoView({ behavior: 'smooth' });
}

// Rapport complet de la vue en cours, en un clic.
async function generateReport() {
  generating.value = true;
  try {
    const s = summary.value;
    const blocks = [
      { type: 'heading', text: 'Synthèse', level: 1 },
      narrativeBlock(s, { topPartner: partners.value[0], topReporter: reporters.value[0] }),
      kpiBlock(s),
      { type: 'chart', spec: trend.value },
      { type: 'chart', spec: partnerSpec.value },
      rankTableBlock(partners.value, 'Détail par partenaire hors UE', { measure: measure.value }),
      { type: 'chart', spec: reporterSpec.value },
      { type: 'chart', spec: sectionSpec.value },
      rankTableBlock(products.value, 'Codes NC les plus échangés', { measure: measure.value }),
      sourceBlock(meta.lastPeriod),
    ];
    const r = await reports.generate(`Commerce extra-UE — ${periodText.value}`, filtersDescription.value, blocks);
    router.push(`/rapports/${r._id}`);
  } finally {
    generating.value = false;
  }
}
const filtersDescription = computed(() => {
  const parts = [];
  if (filters.reporters.length) parts.push(`Déclarants : ${filters.reporters.map(meta.countryName).join(', ')}`);
  if (filters.partners.length) parts.push(`Partenaires : ${filters.partners.map(meta.countryName).join(', ')}`);
  if (filters.product) parts.push(`Codes NC ${filters.product}…`);
  if (filters.sections.length) parts.push(`Sections ${filters.sections.join(', ')}`);
  if (filters.chapters.length) parts.push(`Chapitres ${filters.chapters.join(', ')}`);
  return parts.join(' · ') || 'Tous produits, UE-27 ↔ pays hors UE';
});
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Tableau de bord</h1>
        <p>Commerce des 27 pays de l'UE avec les pays hors UE · données disponibles jusqu'à {{ meta.lastPeriod ? periodLabel(meta.lastPeriod) : '…' }}</p>
      </div>
      <div class="page-actions">
        <div class="seg" role="group" aria-label="Mesure">
          <button :class="{ on: measure === 'value' }" @click="measure = 'value'">Valeur €</button>
          <button :class="{ on: measure === 'quantity' }" @click="measure = 'quantity'">Quantité t</button>
        </div>
        <button class="btn btn-primary" :disabled="!summary || generating" @click="generateReport">{{ generating ? 'Génération…' : '📄 Générer un rapport' }}</button>
      </div>
    </div>

    <QuickQuestion @apply="applyQuestion" />
    <FilterBar />
    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="summary" class="kpis" :class="{ loading }" style="margin-bottom: 16px">
      <KpiCard dot="import" label="Importations" :value="fmt(summary[`import${mk}`])" :change="measure === 'value' ? summary.changeImport : summary.changeImportKg" :change-label="refText" :spark="sparkImport" spark-color="var(--import)" />
      <KpiCard dot="export" label="Exportations" :value="fmt(summary[`export${mk}`])" :change="measure === 'value' ? summary.changeExport : summary.changeExportKg" :change-label="refText" :spark="sparkExport" spark-color="var(--export)" />
      <KpiCard label="Solde commercial" :value="`${summary.balanceEur >= 0 ? '+' : ''}${eur(summary.balanceEur)}`" :sub="summary.balanceEur >= 0 ? 'Excédent (export > import)' : 'Déficit (import > export)'" />
      <KpiCard label="Taux de couverture" :value="summary.importEur ? sharePct(summary.exportEur / summary.importEur) : '—'" sub="Exportations / importations" />
      <KpiCard label="Couverture des données" :value="`${integer(summary.productCount)} codes NC`" :sub="`${summary.partnerCount} partenaires · ${summary.reporterCount} pays UE`" />
    </div>

    <ChartCard :spec="trend" :height="320" pickable :loading="loading" @pick="pickPeriod">
      <template #controls>
        <GranularityPicker v-model="granularity" :from="filters.periodFrom" :to="filters.periodTo" />
        <div class="seg" role="group" aria-label="Type de graphique">
          <button :class="{ on: chartKind === 'line' }" @click="chartKind = 'line'">Courbes</button>
          <button :class="{ on: chartKind === 'bar' }" @click="chartKind = 'bar'">Colonnes</button>
        </div>
        <label class="fc-toggle" :class="{ disabled: chartKind !== 'line' }"><input v-model="withForecast" type="checkbox" :disabled="chartKind !== 'line'" /> Prévision</label>
      </template>
      <p class="hint click-hint">💡 Cliquez sur un point ou une colonne pour voir le détail des échanges de la période (pays, drapeaux, produits).</p>
    </ChartCard>

    <div class="grid grid-2" style="margin-top: 16px">
      <ChartCard :spec="partnerSpec" :height="hbarHeight(partners.length)" pickable :loading="loading" @pick="(i) => addFilter('partners', partners[i]?.key)" />
      <ChartCard :spec="reporterSpec" :height="hbarHeight(reporters.length)" pickable :loading="loading" @pick="(i) => addFilter('reporters', reporters[i]?.key)" />
      <ChartCard :spec="sectionSpec" :height="hbarHeight(sections.length)" pickable :loading="loading" @pick="(i) => addFilter('sections', sections[i]?.key)" />
      <section class="card" :class="{ loading }">
        <div class="card-head">
          <div><h2>Codes NC les plus échangés</h2><p>Classés par {{ flowLabel }} · ouvrir une fiche produit</p></div>
          <RouterLink :to="{ path: '/explorer', query: filters.toQuery() }" class="btn btn-sm">Explorer →</RouterLink>
        </div>
        <RankTable :rows="products" kind="product" key-label="Code NC" :measure="measure" :flow="filters.flow" :link="(r) => `/produits/${r.key}`" />
      </section>
    </div>

    <PeriodDrawer :period="drawer" :params="filters.params" @close="drawer = ''" />
  </div>
</template>

<style scoped>
.fc-toggle { display: inline-flex; gap: 6px; align-items: center; font-size: 0.8rem; color: var(--text-2); padding: 0 4px; }
.fc-toggle.disabled { opacity: 0.5; }
.click-hint { margin-top: 8px; }
</style>
