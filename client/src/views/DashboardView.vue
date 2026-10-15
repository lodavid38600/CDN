<script setup>
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { eur, tonnes, perKg, sharePct, rangeLabel, integer, periodLabel, ncCode } from '../format.js';
import { useFilterSync } from '../useFilterSync.js';
import { useReportsStore } from '../stores/reports.js';
import { trendSpec, rankSpec, hbarHeight } from '../lib/specs.js';
import { flowKpis } from '../lib/kpis.js';
import { withArticle } from '../lib/countries.js';
import { kpiBlock, narrativeBlock, rankTableBlock, sourceBlock } from '../lib/reportBlocks.js';
import { bestGranularity, GRANULARITY_WORD } from '../lib/granularity.js';
import FilterBar from '../components/FilterBar.vue';
import KpiCard from '../components/KpiCard.vue';
import ChartCard from '../components/ChartCard.vue';
import RankTable from '../components/RankTable.vue';
import PeriodDrawer from '../components/PeriodDrawer.vue';
import GranularityPicker from '../components/GranularityPicker.vue';
import MeasureSwitch from '../components/MeasureSwitch.vue';

const router = useRouter();
const reports = useReportsStore();
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
const productLabel = ref('');

const { filters, meta, loading, error, reload } = useFilterSync(async (params) => {
  const sort = filters.measure;
  const top = (dimension, limit) => api('/stats/top', { params: { ...params, dimension, limit, sort: sort === 'price' ? 'quantity' : sort } });
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
    ? await api('/stats/forecast', { params: { ...params, granularity: granularity.value, horizon: { month: 12, quarter: 4, year: 3 }[granularity.value], measure: filters.measure } })
    : null;
}
watch([granularity], () => reload());
watch(() => filters.measure, () => reload());
watch(withForecast, () => loadForecast().catch(() => {}));
watch(() => [filters.periodFrom, filters.periodTo, meta.loaded], () => {
  if (meta.loaded) granularity.value = bestGranularity(filters.periodFrom, filters.periodTo, meta);
}, { immediate: true });
watch(() => filters.product, async (code) => {
  productLabel.value = '';
  if (!code || code.length < 2) return;
  try {
    productLabel.value = code.length === 8 ? (await api(`/products/${code}`)).description : [2, 6].includes(code.length) ? (await api(`/nomenclature/${code}`)).label : '';
  } catch { /* libellé facultatif */ }
}, { immediate: true });

const m = computed(() => filters.measure);
const mk = computed(() => filters.measureKey);
const periodText = computed(() => (summary.value?.period ? rangeLabel(summary.value.period.from, summary.value.period.to) : ''));
const refText = computed(() => (summary.value?.reference ? `${rangeLabel(summary.value.reference.from, summary.value.reference.to)} vs N-1` : ''));
const kpis = computed(() => flowKpis(summary.value, m.value, refText.value));
const flowLabel = computed(() => ({ import: 'importations', export: 'exportations' })[filters.flow] || 'échanges totaux');
const measureWord = computed(() => ({ value: 'en valeur', quantity: 'en volume', price: 'par volume' })[m.value]);

// Phrase de synthèse générée à partir des filtres : la réponse, sans rien régler de plus.
const sentence = computed(() => {
  const s = summary.value;
  if (!s?.period) return '';
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const who = filters.reporters.length === 1 ? withArticle(filters.reporters[0], meta.countryName(filters.reporters[0])) : filters.reporters.length ? `${filters.reporters.length} pays de l'UE` : "l'Union européenne";
  const where = filters.partners.length === 1 ? withArticle(filters.partners[0], meta.countryName(filters.partners[0])) : filters.partners.length ? `${filters.partners.length} pays partenaires` : 'les pays hors UE';
  const what = filters.product
    ? productLabel.value ? `${productLabel.value.replace(/^./, (c) => c.toLowerCase())} (NC ${ncCode(filters.product)})` : `produits du code NC ${ncCode(filters.product)}`
    : 'marchandises';
  const when = s.period.from === s.period.to ? `en ${periodLabel(s.period.from)}` : `de ${periodLabel(s.period.from)} à ${periodLabel(s.period.to)}`;
  const parts = [];
  if (filters.flow !== 'import') parts.push(`${cap(who)} a exporté ${tonnes(s.exportKg)} de ${what} vers ${where} pour ${eur(s.exportEur)} (${perKg(s.exportPrice)})`);
  if (filters.flow !== 'export') parts.push(`${filters.flow === 'import' ? cap(who) : 'et'} a importé ${tonnes(s.importKg)} pour ${eur(s.importEur)} (${perKg(s.importPrice)})`);
  return `${parts.join(' ')}, ${when}.`;
});

const trend = computed(() =>
  trendSpec({
    rows: series.value, fc: chartKind.value === 'line' ? fc.value : null, measure: m.value, kind: chartKind.value === 'line' ? 'line' : 'bar',
    title: `${{ value: 'Valeur', quantity: 'Volume', price: 'Prix moyen' }[m.value]} des échanges — évolution ${GRANULARITY_WORD[granularity.value]}`,
    subtitle: `Importations et exportations extra-UE ${m.value === 'quantity' ? 'en tonnes (unité adaptée)' : m.value === 'price' ? 'en €/kg' : 'en euros courants'} · ${periodText.value}`,
  })
);
const rankTitle = (t) => `${t} — ${measureWord.value}`;
const partnerSpec = computed(() => rankSpec({ rows: partners.value, measure: m.value, title: rankTitle('Principaux partenaires hors UE'), subtitle: `Classés par ${flowLabel.value} · cliquer pour filtrer` }));
const reporterSpec = computed(() => rankSpec({ rows: reporters.value, measure: m.value, title: rankTitle('Pays UE déclarants'), subtitle: `Classés par ${flowLabel.value} · cliquer pour filtrer` }));
const sectionSpec = computed(() => rankSpec({ rows: sections.value, measure: m.value, title: rankTitle('Répartition par section NC'), subtitle: 'Cliquer pour filtrer sur une section', labelFn: (r) => `${r.key} · ${r.label}` }));

function pickPeriod(i) {
  const r = series.value[i];
  if (r) drawer.value = r.period;
}
function addFilter(key, value) {
  if (value && !filters[key].includes(value)) filters[key] = [...filters[key], value];
}

async function generateReport() {
  generating.value = true;
  try {
    const s = summary.value;
    const blocks = [
      { type: 'heading', text: 'Synthèse', level: 1 },
      { type: 'text', html: `<p>${sentence.value}</p>` },
      narrativeBlock(s, { topPartner: partners.value[0], topReporter: reporters.value[0] }),
      kpiBlock(s),
      { type: 'chart', spec: trend.value },
      { type: 'chart', spec: partnerSpec.value },
      rankTableBlock(partners.value, 'Détail par partenaire hors UE', { measure: m.value }),
      { type: 'chart', spec: reporterSpec.value },
      { type: 'chart', spec: sectionSpec.value },
      rankTableBlock(products.value, 'Codes NC les plus échangés', { measure: m.value }),
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
  if (filters.product) parts.push(`NC ${ncCode(filters.product)}`);
  if (filters.sections.length) parts.push(`Sections ${filters.sections.join(', ')}`);
  if (filters.chapters.length) parts.push(`Chapitres ${filters.chapters.join(', ')}`);
  return parts.join(' · ') || 'Tous produits, UE-27 ↔ pays hors UE';
});
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Vue d'ensemble</h1>
        <p>Commerce des 27 pays de l'UE avec les pays hors UE · données jusqu'à {{ meta.lastPeriod ? periodLabel(meta.lastPeriod) : '…' }}</p>
      </div>
      <div class="page-actions">
        <MeasureSwitch v-model="filters.measure" />
        <button class="btn btn-primary" :disabled="!summary || generating" @click="generateReport">{{ generating ? 'Génération…' : '📄 Générer un rapport' }}</button>
      </div>
    </div>

    <FilterBar />
    <p v-if="error" class="error">{{ error }}</p>

    <p v-if="sentence" class="sentence" :class="{ loading }">{{ sentence }}</p>

    <div v-if="summary" class="kpis" :class="{ loading }" style="margin-bottom: 16px">
      <KpiCard v-for="k in kpis" :key="k.dot" v-bind="k" :spark="series.slice(-24).map((r) => r[`${k.dot}${mk}`])" :spark-color="`var(--${k.dot})`" />
      <KpiCard label="Solde commercial" :value="`${summary.balanceEur >= 0 ? '+' : ''}${eur(summary.balanceEur)}`"
        :extra="[`${summary.balanceKg >= 0 ? '+' : ''}${tonnes(summary.balanceKg)} en volume`]" :sub="summary.balanceEur >= 0 ? 'Excédent' : 'Déficit'" />
      <KpiCard label="Taux de couverture" :value="summary.importEur ? sharePct(summary.exportEur / summary.importEur) : '—'"
        :extra="[summary.importKg ? `${sharePct(summary.exportKg / summary.importKg)} en volume` : '']" sub="Exportations / importations" />
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
      <p class="hint click-hint">💡 Cliquez sur une période pour le détail des échanges (pays, drapeaux, produits).</p>
    </ChartCard>

    <div class="grid grid-2" style="margin-top: 16px">
      <ChartCard :spec="partnerSpec" :height="hbarHeight(partners.length)" pickable :loading="loading" @pick="(i) => addFilter('partners', partners[i]?.key)" />
      <ChartCard :spec="reporterSpec" :height="hbarHeight(reporters.length)" pickable :loading="loading" @pick="(i) => addFilter('reporters', reporters[i]?.key)" />
    </div>
    <section class="card" :class="{ loading }" style="margin-top: 16px">
      <div class="card-head">
        <div><h2>Codes NC les plus échangés</h2><p>Valeur, volume et prix moyen · nomenclature actuelle (anciens codes convertis automatiquement)</p></div>
        <div class="row">
          <RouterLink v-if="products[0]" :to="{ path: `/produits/${products[0].key}`, hash: '#prix' }" class="btn btn-sm">Prix du n° 1 →</RouterLink>
          <RouterLink :to="{ path: '/explorer', query: filters.toQuery() }" class="btn btn-sm">Lignes détaillées →</RouterLink>
        </div>
      </div>
      <RankTable :rows="products" kind="product" key-label="Code NC" :measure="m" :flow="filters.flow" :link="(r) => `/produits/${r.key}`" />
    </section>
    <div class="grid grid-2" style="margin-top: 16px">
      <ChartCard :spec="sectionSpec" :height="hbarHeight(sections.length)" pickable :loading="loading" @pick="(i) => addFilter('sections', sections[i]?.key)" />
      <section class="card" :class="{ loading }">
        <div class="card-head"><div><h2>Partenaires hors UE</h2><p>Cliquer pour filtrer</p></div></div>
        <RankTable :rows="partners" :measure="m" :flow="filters.flow" key-label="Pays" @select="(r) => addFilter('partners', r.key)" />
      </section>
    </div>

    <PeriodDrawer :period="drawer" :params="filters.params" @close="drawer = ''" />
  </div>
</template>

<style scoped>
.sentence { font-size: 1.05rem; line-height: 1.55; margin: 0 0 16px; padding: 14px 16px; border-radius: 12px; background: linear-gradient(135deg, var(--accent-wash), transparent 70%), var(--surface); border: 1px solid var(--border); }
.fc-toggle { display: inline-flex; gap: 6px; align-items: center; font-size: 0.8rem; color: var(--text-2); padding: 0 4px; }
.fc-toggle.disabled { opacity: 0.5; }
.click-hint { margin-top: 8px; }
</style>
