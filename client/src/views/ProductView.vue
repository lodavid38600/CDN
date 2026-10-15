<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { eur, tonnes, ncCode, perKg, percent, sharePct, rangeLabel, integer } from '../format.js';
import { useMetaStore } from '../stores/meta.js';
import { useReportsStore } from '../stores/reports.js';
import { trendSpec, rankSpec, seasonalitySpec, unitPriceSpec, hbarHeight } from '../lib/specs.js';
import { kpiBlock, narrativeBlock, rankTableBlock, sourceBlock } from '../lib/reportBlocks.js';
import PeriodPicker from '../components/PeriodPicker.vue';
import MultiSelect from '../components/MultiSelect.vue';
import KpiCard from '../components/KpiCard.vue';
import ChartCard from '../components/ChartCard.vue';
import RankTable from '../components/RankTable.vue';
import Heatmap from '../components/Heatmap.vue';
import WorldMap from '../components/WorldMap.vue';
import Flag from '../components/Flag.vue';
import PeriodDrawer from '../components/PeriodDrawer.vue';

// Fiche complète d'un code NC8 : indicateurs, tendances, prévision, saisonnalité,
// prix unitaires, carte des partenaires, classements et matrice déclarants × partenaires.
const props = defineProps({ code: { type: String, required: true } });
const route = useRoute();
const router = useRouter();
const meta = useMetaStore();
const reports = useReportsStore();

const product = ref(null);
const node = ref(null);
const summary = ref(null);
const hs6Summary = ref(null);
const monthly = ref([]);
const annual = ref([]);
const fc = ref(null);
const partners = ref([]);
const reporters = ref([]);
const matrix = ref(null);
const error = ref('');
const loading = ref(false);
const drawer = ref('');
const mapRef = ref(null);

const local = ref({
  from: route.query.periodFrom || '', to: route.query.periodTo || '',
  reporters: route.query.reporters ? String(route.query.reporters).split(',') : [],
  partners: route.query.partners ? String(route.query.partners).split(',') : [],
  flow: '',
});
const measure = ref('value');
const granularity = ref('month');
const chartKind = ref('line');
const withForecast = ref(true);
const mapMode = ref('partner');

const params = computed(() => ({
  product: props.code, periodFrom: local.value.from, periodTo: local.value.to,
  reporters: local.value.reporters, partners: local.value.partners,
}));
const series = computed(() => (granularity.value === 'month' ? monthly.value : annual.value));
const mk = computed(() => (measure.value === 'quantity' ? 'Kg' : 'Eur'));
const fmt = computed(() => (measure.value === 'quantity' ? tonnes : eur));
const periodText = computed(() => (summary.value?.period ? rangeLabel(summary.value.period.from, summary.value.period.to) : ''));
const countryOpts = (list) => list.map((c) => ({ value: c.code, label: c.name }));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    await meta.load();
    const p = params.value;
    const top = (dimension, limit = 12) => api('/stats/top', { params: { ...p, flow: local.value.flow, dimension, limit, sort: measure.value } });
    const [prod, n, s, hs, m, a, pa, re, mx] = await Promise.all([
      api(`/products/${props.code}`),
      api(`/nomenclature/${props.code}`),
      api('/stats/summary', { params: p }),
      api('/stats/summary', { params: { ...p, product: props.code.slice(0, 6) } }),
      api('/stats/timeseries', { params: { ...p, granularity: 'month' } }),
      api('/stats/timeseries', { params: { ...p, granularity: 'year' } }),
      top('partner', 60),
      top('reporter', 27),
      api('/stats/matrix', { params: { ...p, flow: local.value.flow, size: 8 } }),
    ]);
    product.value = prod;
    node.value = n;
    summary.value = s;
    hs6Summary.value = hs;
    monthly.value = m;
    annual.value = a;
    partners.value = pa;
    reporters.value = re;
    matrix.value = mx;
    await loadForecast();
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
async function loadForecast() {
  fc.value = withForecast.value
    ? await api('/stats/forecast', {
        params: { ...params.value, periodFrom: '', periodTo: '', granularity: granularity.value, horizon: granularity.value === 'month' ? 12 : 3, measure: measure.value },
      })
    : null;
}
watch(() => props.code, load, { immediate: true });
watch(() => JSON.stringify(local.value), () => {
  router.replace({ query: Object.fromEntries(Object.entries({ periodFrom: local.value.from, periodTo: local.value.to, reporters: local.value.reporters.join(','), partners: local.value.partners.join(',') }).filter(([, v]) => v)) });
  load();
});
watch([granularity, withForecast], () => loadForecast().catch(() => {}));
watch(measure, load);

// Indicateurs dérivés
const unitImport = computed(() => (summary.value?.importKg ? summary.value.importEur / summary.value.importKg : null));
const unitExport = computed(() => (summary.value?.exportKg ? summary.value.exportEur / summary.value.exportKg : null));
const shareHs6 = computed(() => (hs6Summary.value?.totalEur ? summary.value.totalEur / hs6Summary.value.totalEur : null));
const cagr = computed(() => {
  const full = annual.value.filter((r) => r.months === 12);
  if (full.length < 2) return null;
  const span = Math.min(5, full.length - 1);
  const a = full.at(-1 - span), b = full.at(-1);
  const flow = local.value.flow || 'export';
  const v0 = a[`${flow}Eur`], v1 = b[`${flow}Eur`];
  return v0 > 0 ? { rate: (v1 / v0) ** (1 / span) - 1, from: a.year, to: b.year, flow } : null;
});
const peakMonth = computed(() => {
  const s = seasonalitySpec({ rows: monthly.value, measure: 'value' });
  const flowIdx = local.value.flow === 'import' ? 0 : 1;
  const vals = s.series[flowIdx].values;
  const max = Math.max(...vals);
  return max > 0 ? s.labels[vals.indexOf(max)] : '—';
});

const trend = computed(() =>
  trendSpec({
    rows: series.value, fc: chartKind.value === 'line' ? fc.value : null, measure: measure.value, flow: local.value.flow,
    kind: chartKind.value === 'line' ? 'line' : 'bar',
    title: `Évolution ${granularity.value === 'month' ? 'mensuelle' : 'annuelle'} — ${ncCode(props.code)}`,
    subtitle: `${product.value?.description || ''} · ${periodText.value}`,
  })
);
const seasonSpec = computed(() => seasonalitySpec({ rows: monthly.value, measure: measure.value, title: 'Saisonnalité', subtitle: 'Moyenne par mois calendaire sur la période' }));
const priceSpec = computed(() => unitPriceSpec({ rows: granularity.value === 'month' ? monthly.value : annual.value, title: 'Prix moyen au kilo', subtitle: 'Valeur / quantité, import et export' }));
const partnerSpec = computed(() => rankSpec({ rows: partners.value.slice(0, 12), measure: measure.value, flow: local.value.flow, title: 'Partenaires hors UE', subtitle: `${product.value?.description || ''} · ${periodText.value}` }));
const reporterSpec = computed(() => rankSpec({ rows: reporters.value.slice(0, 12), measure: measure.value, flow: local.value.flow, title: 'Pays UE déclarants', subtitle: `${product.value?.description || ''} · ${periodText.value}` }));

// Carte : partenaires hors UE ou pays déclarants UE
const mapRows = computed(() => (mapMode.value === 'partner' ? partners.value : reporters.value));
const mapValue = (r) => (local.value.flow ? r[`${local.value.flow}${mk.value}`] : r[`import${mk.value}`] + r[`export${mk.value}`]);
const mapValues = computed(() => Object.fromEntries(mapRows.value.map((r) => [r.key, mapValue(r)])));
const mapDetails = computed(() =>
  Object.fromEntries(mapRows.value.map((r) => [r.key, { name: r.label, lines: [`Import : ${fmt.value(r[`import${mk.value}`])}`, `Export : ${fmt.value(r[`export${mk.value}`])}`] }]))
);
function pickCountry(code) {
  const key = mapMode.value === 'partner' ? 'partners' : 'reporters';
  local.value[key] = local.value[key].includes(code) ? local.value[key].filter((c) => c !== code) : [code];
}

const reportTitle = computed(() => `${ncCode(props.code)} — ${product.value?.description || ''}`);
async function generateReport() {
  const s = summary.value;
  const mapImg = await mapRef.value?.toImage().catch(() => null);
  const blocks = [
    { type: 'heading', text: reportTitle.value, level: 1 },
    narrativeBlock(s, { scope: `les échanges extra-UE du code NC ${ncCode(props.code)} (${product.value.description})`, topPartner: partners.value[0], topReporter: reporters.value[0] }),
    kpiBlock(s),
    { type: 'chart', spec: trend.value },
    { type: 'chart', spec: seasonSpec.value },
    { type: 'chart', spec: priceSpec.value },
    ...(mapImg ? [{ type: 'image', src: mapImg, caption: `Carte des ${mapMode.value === 'partner' ? 'partenaires hors UE' : 'pays UE déclarants'} — ${periodText.value}` }] : []),
    { type: 'chart', spec: partnerSpec.value },
    rankTableBlock(partners.value.slice(0, 15), 'Détail par partenaire hors UE', { measure: measure.value }),
    { type: 'chart', spec: reporterSpec.value },
    rankTableBlock(reporters.value.slice(0, 15), 'Détail par pays UE déclarant', { measure: measure.value }),
    sourceBlock(meta.lastPeriod),
  ];
  const r = await reports.generate(reportTitle.value, `Fiche produit · ${periodText.value}`, blocks);
  router.push(`/rapports/${r._id}`);
}
function addKpisToReport() {
  reports.add([{ type: 'heading', text: reportTitle.value, level: 2 }, kpiBlock(summary.value)], 'Indicateurs');
}
async function addMapToReport() {
  const src = await mapRef.value.toImage();
  reports.add([{ type: 'image', src, caption: `${reportTitle.value} — ${mapMode.value === 'partner' ? 'partenaires hors UE' : 'pays UE déclarants'}, ${periodText.value}` }], 'Carte');
}
</script>

<template>
  <div>
    <nav class="crumbs" aria-label="Fil d'Ariane">
      <RouterLink to="/nomenclature">Nomenclature</RouterLink>
      <template v-if="node">
        <span class="sep">›</span><span>Section {{ node.section }}</span>
        <template v-for="p in node.parents" :key="p.code"><span class="sep">›</span><RouterLink :to="`/nomenclature/${p.code}`" :title="p.label">{{ ncCode(p.code) }} {{ p.level === 2 ? p.label : '' }}</RouterLink></template>
        <span class="sep">›</span><strong>{{ ncCode(code) }}</strong>
      </template>
    </nav>
    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="product">
      <div class="page-head">
        <div class="ph">
          <span class="badge badge-accent">Code NC8</span>
          <h1><span class="nc code">{{ ncCode(product.code) }}</span> {{ product.description }}</h1>
          <p>{{ product.hs6Label }} · Chapitre {{ product.chapter }} — {{ product.chapterLabel }}</p>
          <div v-if="node && node.children.length > 1" class="siblings">
            <span class="hint">Même sous-position :</span>
            <RouterLink v-for="c in node.children" :key="c.code" :to="`/produits/${c.code}`" class="chip" :class="{ on: c.current }" :title="c.label">{{ ncCode(c.code) }}</RouterLink>
          </div>
        </div>
        <div class="page-actions">
          <RouterLink class="btn" :to="{ path: '/comparateur', query: { preset: 'flows', product: code } }">⇄ Exportateurs vs importateurs</RouterLink>
          <RouterLink class="btn" :to="{ path: '/explorer', query: { product: code, periodFrom: local.from || undefined, periodTo: local.to || undefined } }">Lignes détaillées</RouterLink>
          <button class="btn btn-primary" :disabled="!summary" @click="generateReport">📄 Générer un rapport</button>
        </div>
      </div>

      <div class="card toolbar">
        <div class="field wide"><span>Période</span><PeriodPicker v-model:from="local.from" v-model:to="local.to" /></div>
        <div class="field"><span>Flux</span>
          <div class="seg">
            <button :class="{ on: !local.flow }" @click="local.flow = ''">Les deux</button>
            <button :class="{ on: local.flow === 'import' }" @click="local.flow = 'import'">Import</button>
            <button :class="{ on: local.flow === 'export' }" @click="local.flow = 'export'">Export</button>
          </div>
        </div>
        <div class="field"><span>Pays UE déclarant</span><MultiSelect v-model="local.reporters" :options="countryOpts(meta.reporters)" placeholder="Toute l'UE" flags /></div>
        <div class="field"><span>Partenaire hors UE</span><MultiSelect v-model="local.partners" :options="countryOpts(meta.partners)" placeholder="Tous" flags /></div>
        <div class="field"><span>Mesure</span>
          <div class="seg">
            <button :class="{ on: measure === 'value' }" @click="measure = 'value'">Valeur €</button>
            <button :class="{ on: measure === 'quantity' }" @click="measure = 'quantity'">Quantité t</button>
          </div>
        </div>
      </div>

      <div v-if="summary" class="kpis" :class="{ loading }">
        <KpiCard dot="import" label="Importations" :value="fmt(summary[`import${mk}`])" :change="measure === 'value' ? summary.changeImport : summary.changeImportKg" change-label="sur un an" :spark="monthly.slice(-24).map((r) => r[`import${mk}`])" spark-color="var(--import)" />
        <KpiCard dot="export" label="Exportations" :value="fmt(summary[`export${mk}`])" :change="measure === 'value' ? summary.changeExport : summary.changeExportKg" change-label="sur un an" :spark="monthly.slice(-24).map((r) => r[`export${mk}`])" spark-color="var(--export)" />
        <KpiCard label="Solde commercial" :value="`${summary.balanceEur >= 0 ? '+' : ''}${eur(summary.balanceEur)}`" :sub="`Couverture ${summary.importEur ? sharePct(summary.exportEur / summary.importEur) : '—'}`" />
        <KpiCard label="Prix moyen import" :value="perKg(unitImport)" :sub="`${tonnes(summary.importKg)} importées`" />
        <KpiCard label="Prix moyen export" :value="perKg(unitExport)" :sub="`${tonnes(summary.exportKg)} exportées`" />
      </div>
      <div v-if="summary" class="kpis" :class="{ loading }" style="margin-top: 12px">
        <KpiCard :label="`Croissance annuelle moyenne (${cagr?.flow === 'import' ? 'import' : 'export'})`" :value="cagr ? percent(cagr.rate) : '—'" :sub="cagr ? `TCAM ${cagr.from} → ${cagr.to}` : 'Historique insuffisant'" />
        <KpiCard label="Poids dans la sous-position" :value="shareHs6 !== null ? sharePct(shareHs6) : '—'" :sub="`des échanges NC ${ncCode(code.slice(0, 6))}`" />
        <KpiCard label="Mois de pointe" :value="peakMonth" :sub="`des ${local.flow === 'import' ? 'importations' : 'exportations'} (moyenne)`" />
        <KpiCard label="Partenaires hors UE" :value="integer(summary.partnerCount)" :sub="`${summary.reporterCount} pays UE déclarants`" />
        <div class="card kpi-actions">
          <button class="btn btn-sm" @click="addKpisToReport">＋ Indicateurs au rapport</button>
          <span class="hint">{{ periodText }}</span>
        </div>
      </div>

      <div style="margin-top: 16px">
        <ChartCard :spec="trend" :height="320" pickable :loading="loading" @pick="(i) => (drawer = series[i]?.period || '')">
          <template #controls>
            <div class="seg">
              <button :class="{ on: granularity === 'month' }" @click="granularity = 'month'">Mois</button>
              <button :class="{ on: granularity === 'year' }" @click="granularity = 'year'">Année</button>
            </div>
            <div class="seg">
              <button :class="{ on: chartKind === 'line' }" @click="chartKind = 'line'">Courbes</button>
              <button :class="{ on: chartKind === 'bar' }" @click="chartKind = 'bar'">Colonnes</button>
            </div>
            <label class="fc-toggle"><input v-model="withForecast" type="checkbox" :disabled="chartKind !== 'line'" /> Prévision</label>
          </template>
          <p class="hint" style="margin-top: 8px">💡 Cliquez sur une colonne ou un point pour le détail du mois : pays partenaires, déclarants, drapeaux.</p>
        </ChartCard>
      </div>

      <div class="grid grid-2" style="margin-top: 16px">
        <ChartCard :spec="seasonSpec" :height="240" :loading="loading" />
        <ChartCard :spec="priceSpec" :height="240" :loading="loading" />
      </div>

      <section class="card" style="margin-top: 16px">
        <div class="card-head">
          <div><h2>Carte des échanges</h2><p>{{ product.description }} · {{ periodText }} · cliquer sur un pays pour filtrer</p></div>
          <div class="row">
            <div class="seg">
              <button :class="{ on: mapMode === 'partner' }" @click="mapMode = 'partner'">Partenaires hors UE</button>
              <button :class="{ on: mapMode === 'reporter' }" @click="mapMode = 'reporter'">Pays UE</button>
            </div>
            <button class="btn btn-sm" @click="addMapToReport">＋ Au rapport</button>
          </div>
        </div>
        <WorldMap ref="mapRef" :values="mapValues" :details="mapDetails" :formatter="fmt" :height="420"
          :selected="(mapMode === 'partner' ? local.partners : local.reporters)[0] || ''" @select="pickCountry" />
      </section>

      <div class="grid grid-2" style="margin-top: 16px">
        <ChartCard :spec="partnerSpec" :height="hbarHeight(Math.min(12, partners.length), local.flow ? 1 : 2)" pickable :loading="loading" @pick="(i) => pickCountry(partners[i]?.key)" />
        <ChartCard :spec="reporterSpec" :height="hbarHeight(Math.min(12, reporters.length), local.flow ? 1 : 2)" :loading="loading" />
        <section class="card">
          <div class="card-head"><h2>Tous les partenaires ({{ partners.length }})</h2></div>
          <div class="scroll"><RankTable :rows="partners" :measure="measure" :flow="local.flow" key-label="Pays" @select="(r) => pickCountry(r.key)" /></div>
        </section>
        <section class="card">
          <div class="card-head"><h2>Pays UE déclarants ({{ reporters.length }})</h2></div>
          <div class="scroll"><RankTable :rows="reporters" :measure="measure" :flow="local.flow" key-label="Pays" /></div>
        </section>
      </div>

      <section class="card" style="margin-top: 16px">
        <div class="card-head">
          <div><h2>Qui commerce avec qui ?</h2><p>Principaux pays UE déclarants × partenaires hors UE · {{ local.flow === 'import' ? 'importations' : local.flow === 'export' ? 'exportations' : 'import + export' }}</p></div>
        </div>
        <Heatmap :data="matrix" />
      </section>

      <section v-if="partners[0]" class="card insight">
        <Flag :code="partners[0].key" :size="28" />
        <p>
          <strong>{{ partners[0].label }}</strong> est le premier partenaire hors UE pour ce produit ({{ sharePct(partners[0].totalEur / (summary.totalEur || 1)) }} des échanges).
          <template v-if="reporters[0]"> Côté UE, <strong>{{ reporters[0].label }}</strong> concentre {{ sharePct(reporters[0].totalEur / (summary.totalEur || 1)) }} du commerce extra-UE.</template>
        </p>
      </section>
    </template>
    <PeriodDrawer :period="drawer" :params="{ product: code, reporters: local.reporters, partners: local.partners }" :context="`NC ${ncCode(code)}`" @close="drawer = ''" />
  </div>
</template>

<style scoped>
.ph { max-width: 780px; }
.ph h1 { margin-top: 6px; }
.code { color: var(--accent); margin-right: 6px; }
.siblings { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 10px; }
.toolbar { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px 12px; align-items: end; margin-bottom: 16px; }
.wide { grid-column: span 2; }
.fc-toggle { display: inline-flex; gap: 6px; align-items: center; font-size: 0.8rem; color: var(--text-2); }
.kpi-actions { display: flex; flex-direction: column; justify-content: center; gap: 6px; align-items: flex-start; }
.scroll { max-height: 420px; overflow-y: auto; }
.insight { display: flex; gap: 12px; align-items: center; margin-top: 16px; background: var(--accent-wash); }
@media (max-width: 700px) { .wide { grid-column: span 1; } }
</style>
