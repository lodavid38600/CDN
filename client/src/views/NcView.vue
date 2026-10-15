<script setup>
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { eur, tonnes, ncCode, sharePct, rangeLabel } from '../format.js';
import { useMetaStore } from '../stores/meta.js';
import { useReportsStore } from '../stores/reports.js';
import { trendSpec, rankSpec, hbarHeight } from '../lib/specs.js';
import { kpiBlock, narrativeBlock, rankTableBlock, sourceBlock } from '../lib/reportBlocks.js';
import PeriodPicker from '../components/PeriodPicker.vue';
import KpiCard from '../components/KpiCard.vue';
import ChartCard from '../components/ChartCard.vue';
import RankTable from '../components/RankTable.vue';
import Sparkline from '../components/Sparkline.vue';
import PeriodDrawer from '../components/PeriodDrawer.vue';
import GranularityPicker from '../components/GranularityPicker.vue';
import PeriodTable from '../components/PeriodTable.vue';
import { bestGranularity, GRANULARITY_WORD } from '../lib/granularity.js';

// Niveau intermédiaire de navigation : chapitre NC02 (enfants NC06) ou sous-position NC06 (enfants NC08).
const props = defineProps({ code: { type: String, required: true } });
const router = useRouter();
const meta = useMetaStore();
const reports = useReportsStore();

const node = ref(null);
const summary = ref(null);
const series = ref([]);
const fc = ref(null);
const childStats = ref({});
const childSparks = ref({});
const partners = ref([]);
const reporters = ref([]);
const period = ref({ from: '', to: '' });
const flow = ref('');
const drawer = ref('');
const granularity = ref('month');
const loading = ref(false);
const error = ref('');

const childDim = computed(() => (props.code.length === 2 ? 'hs6' : 'product'));
const params = computed(() => ({ product: props.code, periodFrom: period.value.from, periodTo: period.value.to }));
const childLink = (c) => (c.level === 8 ? `/produits/${c.code}` : `/nomenclature/${c.code}`);
const val = (code) => {
  const s = childStats.value[code];
  if (!s) return 0;
  return flow.value === 'import' ? s.importEur : flow.value === 'export' ? s.exportEur : s.totalEur;
};
const childTotal = computed(() => Object.keys(childStats.value).reduce((t, k) => t + val(k), 0) || 1);
const children = computed(() => [...(node.value?.children || [])].sort((a, b) => val(b.code) - val(a.code)));
const periodText = computed(() => (summary.value?.period ? rangeLabel(summary.value.period.from, summary.value.period.to) : ''));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    await meta.load();
    const p = params.value;
    const [n, s, ts, f, kids, sp, pa, re] = await Promise.all([
      api(`/nomenclature/${props.code}`),
      api('/stats/summary', { params: p }),
      api('/stats/timeseries', { params: { ...p, granularity: granularity.value } }),
      api('/stats/forecast', { params: { product: props.code, granularity: granularity.value, horizon: { month: 12, quarter: 4, year: 3 }[granularity.value] } }),
      api('/stats/top', { params: { ...p, dimension: childDim.value, limit: 200 } }),
      api('/stats/sparklines', { params: { product: props.code, dimension: childDim.value, flow: flow.value } }),
      api('/stats/top', { params: { ...p, flow: flow.value, dimension: 'partner', limit: 10 } }),
      api('/stats/top', { params: { ...p, flow: flow.value, dimension: 'reporter', limit: 10 } }),
    ]);
    node.value = n;
    summary.value = s;
    series.value = ts;
    fc.value = f;
    childStats.value = Object.fromEntries(kids.map((r) => [r.key, r]));
    childSparks.value = sp.series;
    partners.value = pa;
    reporters.value = re;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
function fit() {
  granularity.value = bestGranularity(period.value.from, period.value.to, meta);
}
watch(() => props.code, async () => { await meta.load(); fit(); load(); }, { immediate: true });
watch(() => [period.value.from, period.value.to], fit);
watch(granularity, load);
watch([period, flow], load, { deep: true });

const trend = computed(() =>
  trendSpec({
    rows: series.value, fc: fc.value, measure: 'value', flow: flow.value,
    title: `Évolution ${GRANULARITY_WORD[granularity.value]} — NC ${ncCode(props.code)}`,
    subtitle: `${node.value?.label || ''} · ${periodText.value}`,
  })
);
const partnerSpec = computed(() => rankSpec({ rows: partners.value, flow: flow.value, title: 'Partenaires hors UE', subtitle: node.value?.label }));
const reporterSpec = computed(() => rankSpec({ rows: reporters.value, flow: flow.value, title: 'Pays UE déclarants', subtitle: node.value?.label }));

async function generateReport() {
  const blocks = [
    { type: 'heading', text: `NC ${ncCode(props.code)} — ${node.value.label}`, level: 1 },
    narrativeBlock(summary.value, { scope: `les échanges extra-UE du code NC ${ncCode(props.code)}`, topPartner: partners.value[0], topReporter: reporters.value[0] }),
    kpiBlock(summary.value),
    { type: 'chart', spec: trend.value },
    { type: 'chart', spec: partnerSpec.value },
    { type: 'chart', spec: reporterSpec.value },
    rankTableBlock(children.value.filter((c) => childStats.value[c.code]).map((c) => ({ ...childStats.value[c.code], label: c.label })), `Détail par ${props.code.length === 2 ? 'sous-position NC06' : 'code NC8'}`),
    sourceBlock(meta.lastPeriod),
  ];
  const r = await reports.generate(`NC ${ncCode(props.code)} — ${node.value.label}`, periodText.value, blocks);
  router.push(`/rapports/${r._id}`);
}
</script>

<template>
  <div>
    <nav class="crumbs" aria-label="Fil d'Ariane">
      <RouterLink to="/nomenclature">Nomenclature</RouterLink>
      <template v-if="node">
        <span class="sep">›</span><span>Section {{ node.section }}</span>
        <template v-for="p in node.parents" :key="p.code"><span class="sep">›</span><RouterLink :to="`/nomenclature/${p.code}`">{{ ncCode(p.code) }}</RouterLink></template>
        <span class="sep">›</span><strong>{{ ncCode(node.code) }}</strong>
      </template>
    </nav>
    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="node">
      <div class="page-head">
        <div>
          <span class="badge badge-accent">{{ node.level === 2 ? 'Chapitre NC02' : 'Sous-position NC06' }}</span>
          <h1 class="title"><span class="nc code">{{ ncCode(node.code) }}</span> {{ node.label }}</h1>
          <p>Section {{ node.section }} · {{ node.sectionLabel }}</p>
        </div>
        <div class="page-actions">
          <RouterLink class="btn" :to="{ path: '/comparateur', query: { preset: 'flows', product: code } }">Comparer</RouterLink>
          <RouterLink class="btn" :to="{ path: '/carte', query: { product: code } }">Carte</RouterLink>
          <button class="btn btn-primary" :disabled="!summary" @click="generateReport">📄 Générer un rapport</button>
        </div>
      </div>

      <div class="card toolbar">
        <div class="field"><span>Période</span><PeriodPicker v-model:from="period.from" v-model:to="period.to" /></div>
        <div class="field"><span>Flux</span>
          <div class="seg">
            <button :class="{ on: !flow }" @click="flow = ''">Les deux</button>
            <button :class="{ on: flow === 'import' }" @click="flow = 'import'">Import</button>
            <button :class="{ on: flow === 'export' }" @click="flow = 'export'">Export</button>
          </div>
        </div>
      </div>

      <div v-if="summary" class="kpis" :class="{ loading }" style="margin-bottom: 16px">
        <KpiCard dot="import" label="Importations" :value="eur(summary.importEur)" :change="summary.changeImport" change-label="sur un an" :spark="series.slice(-24).map((r) => r.importEur)" spark-color="var(--import)" />
        <KpiCard dot="export" label="Exportations" :value="eur(summary.exportEur)" :change="summary.changeExport" change-label="sur un an" :spark="series.slice(-24).map((r) => r.exportEur)" spark-color="var(--export)" />
        <KpiCard label="Solde" :value="`${summary.balanceEur >= 0 ? '+' : ''}${eur(summary.balanceEur)}`" :sub="summary.balanceEur >= 0 ? 'Excédent' : 'Déficit'" />
        <KpiCard label="Volumes" :value="tonnes(summary.importKg + summary.exportKg)" :sub="`${tonnes(summary.exportKg)} exportées`" />
        <KpiCard :label="code.length === 2 ? 'Sous-positions NC06' : 'Codes NC8'" :value="String(children.length)" :sub="`${summary.partnerCount} partenaires hors UE`" />
      </div>

      <section class="card" style="margin-bottom: 16px">
        <div class="card-head">
          <div>
            <h2>{{ code.length === 2 ? 'Sous-positions NC06' : 'Codes NC8' }} de {{ ncCode(code) }}</h2>
            <p>Classés par {{ flow === 'import' ? 'importations' : flow === 'export' ? 'exportations' : 'échanges totaux' }} · {{ periodText }} · cliquer pour descendre d'un niveau</p>
          </div>
        </div>
        <div class="tiles">
          <RouterLink v-for="c in children" :key="c.code" :to="childLink(c)" class="tile">
            <div class="t-top">
              <span class="t-code nc">{{ ncCode(c.code) }}</span>
              <Sparkline v-if="childSparks[c.code]" :values="childSparks[c.code]" :width="64" :height="22" />
            </div>
            <div class="t-label">{{ c.label }}</div>
            <div class="t-foot">
              <strong>{{ val(c.code) ? eur(val(c.code)) : '—' }}</strong>
              <span class="muted">{{ val(c.code) ? sharePct(val(c.code) / childTotal) : '' }}</span>
            </div>
            <div class="share-bar"><span :style="{ width: `${(val(c.code) / childTotal) * 100}%` }" /></div>
          </RouterLink>
        </div>
      </section>

      <ChartCard :spec="trend" :height="300" pickable :loading="loading" @pick="(i) => (drawer = series[i]?.period || '')">
        <template #controls><GranularityPicker v-model="granularity" :from="period.from" :to="period.to" /></template>
        <p class="hint" style="margin-top: 8px">💡 Cliquez sur une période pour le détail par pays.</p>
      </ChartCard>

      <div style="margin-top: 16px">
        <PeriodTable v-model:granularity="granularity" :params="{ product: code }" :from="period.from" :to="period.to" :title="`NC ${ncCode(code)} — détail de la période`" @pick="(p) => (drawer = p)" />
      </div>

      <div class="grid grid-2" style="margin-top: 16px">
        <ChartCard :spec="partnerSpec" :height="hbarHeight(partners.length, flow ? 1 : 2)" :loading="loading" />
        <ChartCard :spec="reporterSpec" :height="hbarHeight(reporters.length, flow ? 1 : 2)" :loading="loading" />
        <section class="card"><div class="card-head"><h2>Partenaires hors UE</h2></div><RankTable :rows="partners" :flow="flow" key-label="Pays" /></section>
        <section class="card"><div class="card-head"><h2>Pays UE déclarants</h2></div><RankTable :rows="reporters" :flow="flow" key-label="Pays" /></section>
      </div>
    </template>
    <PeriodDrawer :period="drawer" :params="{ product: code }" :context="`NC ${ncCode(code)}`" @close="drawer = ''" />
  </div>
</template>

<style scoped>
.title { margin-top: 6px; }
.code { color: var(--accent); margin-right: 6px; }
.toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin-bottom: 16px; }
.toolbar .field { min-width: 220px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
.tile { display: flex; flex-direction: column; gap: 6px; padding: 12px; border-radius: 12px; color: var(--text); background: var(--surface); border: 1px solid var(--border); transition: transform 0.12s, border-color 0.12s; }
.tile:hover { text-decoration: none; border-color: var(--accent); transform: translateY(-2px); }
.t-top { display: flex; justify-content: space-between; align-items: center; }
.t-code { font-size: 1.15rem; font-weight: 700; color: var(--accent); }
.t-label { font-size: 0.85rem; color: var(--text-2); line-height: 1.3; flex: 1; }
.t-foot { display: flex; justify-content: space-between; font-size: 0.86rem; font-variant-numeric: tabular-nums; }
</style>
