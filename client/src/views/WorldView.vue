<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { eur, tonnes, perKg, percent, sharePct, rangeLabel, ncCode } from '../format.js';
import { useMetaStore } from '../stores/meta.js';
import { useReportsStore } from '../stores/reports.js';
import { trendSpec, rankSpec, hbarHeight } from '../lib/specs.js';
import { flowKpis } from '../lib/kpis.js';
import NcSearch from '../components/NcSearch.vue';
import PeriodPicker from '../components/PeriodPicker.vue';
import MeasureSwitch from '../components/MeasureSwitch.vue';
import ChartCard from '../components/ChartCard.vue';
import KpiCard from '../components/KpiCard.vue';
import RankTable from '../components/RankTable.vue';
import WorldMap from '../components/WorldMap.vue';
import Flag from '../components/Flag.vue';

// Marché mondial (SH6) : tous les pays déclarants, y compris hors UE (sources nationales,
// UN Comtrade) et pays reconstitués en miroir. Le commerce intra-UE n'est pas inclus.
const route = useRoute();
const router = useRouter();
const meta = useMetaStore();
const reports = useReportsStore();
const mapRef = ref(null);

const product = ref(String(route.query.product || '220421'));
const flow = ref(route.query.flow === 'import' ? 'import' : 'export');
const measure = ref('value');
const period = ref({ from: '', to: '' });
const summary = ref(null);
const series = ref([]);
const rows = ref([]);
const label = ref('');
const mirror = ref(null);
const mirrorPair = ref({ a: 'FR', b: 'US' });
const loading = ref(false);
const error = ref('');

const code6 = computed(() => (product.value || '').slice(0, 6));
const base = computed(() => ({ source: 'world', product: code6.value, periodFrom: period.value.from, periodTo: period.value.to }));
const mk = computed(() => ({ value: 'Eur', quantity: 'Kg', price: 'Price' })[measure.value]);
const fmt = computed(() => ({ value: eur, quantity: tonnes, price: perKg })[measure.value]);
const key = (r) => r[`${flow.value}${mk.value}`];

async function load() {
  loading.value = true;
  error.value = '';
  try {
    await meta.load();
    const sort = measure.value === 'price' ? 'quantity' : measure.value;
    const [s, ts, top] = await Promise.all([
      api('/stats/summary', { params: base.value }),
      api('/stats/timeseries', { params: { ...base.value, granularity: 'year' } }),
      api('/stats/top', { params: { ...base.value, dimension: 'reporter', flow: flow.value, limit: 80, sort } }),
    ]);
    summary.value = s;
    series.value = ts;
    rows.value = top;
    label.value = code6.value.length >= 2 ? (await api(`/nomenclature/${code6.value.length >= 6 ? code6.value : code6.value.slice(0, 2)}`).catch(() => ({}))).label || '' : '';
    router.replace({ query: { product: product.value || undefined, flow: flow.value } });
    await loadMirror();
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
async function loadMirror() {
  mirror.value = code6.value.length === 6
    ? await api('/stats/mirror', { params: { product: code6.value, reporters: mirrorPair.value.a, partners: mirrorPair.value.b, periodFrom: period.value.from, periodTo: period.value.to } }).catch(() => null)
    : null;
}
watch([product, flow, measure], load);
watch(period, load, { deep: true });
watch(mirrorPair, loadMirror, { deep: true });
onMounted(load);

const country = (c) => meta.worldCountries.find((x) => x.code === c);
const isMirror = (c) => country(c)?.mirrorOnly;
const SOURCE_LABEL = { eurostat: 'Eurostat', 'us-census': 'US Census', 'uk-hmrc': 'HMRC', ssb: 'SSB', comtrade: 'ONU', mirror: 'miroir', demo: 'démo' };
const badges = computed(() => Object.fromEntries(rows.value.map((r) => {
  const c = country(r.key);
  const src = c?.mirrorOnly ? 'miroir' : (c?.sources || []).filter((x) => x !== 'mirror').map((x) => SOURCE_LABEL[x] || x).join(', ');
  return [r.key, src];
})));
const top = computed(() => rows.value[0]);
const euShare = computed(() => {
  const tot = rows.value.reduce((s, r) => s + (r[`${flow.value}Eur`] || 0), 0);
  const eu = rows.value.filter((r) => meta.euCodes.has(r.key)).reduce((s, r) => s + (r[`${flow.value}Eur`] || 0), 0);
  return tot ? eu / tot : null;
});
const periodText = computed(() => (summary.value?.period ? rangeLabel(summary.value.period.from, summary.value.period.to) : ''));
const flowWord = computed(() => (flow.value === 'export' ? 'exportateurs' : 'importateurs'));
const kpis = computed(() => flowKpis(summary.value, measure.value, 'sur un an'));

const values = computed(() => Object.fromEntries(rows.value.map((r) => [r.key, key(r) || 0])));
const details = computed(() => Object.fromEntries(rows.value.map((r) => [r.key, {
  name: `${r.label}${isMirror(r.key) ? ' (miroir)' : ''}`,
  lines: [`${flow.value === 'export' ? 'Export' : 'Import'} : ${eur(r[`${flow.value}Eur`])}`, `Volume : ${tonnes(r[`${flow.value}Kg`])}`, `Prix : ${perKg(r[`${flow.value}Price`])}`],
}])));
const rankC = computed(() => rankSpec({ rows: rows.value.slice(0, 15), measure: measure.value, flow: flow.value, title: `Principaux ${flowWord.value} mondiaux`, subtitle: `SH ${ncCode(code6.value)} · ${periodText.value} · tous pays déclarants (hors commerce intra-UE)` }));
const trendC = computed(() => trendSpec({ rows: series.value, measure: measure.value, title: 'Commerce mondial couvert — évolution annuelle', subtitle: `SH ${ncCode(code6.value)} · somme des déclarations de tous les pays` }));
const mirrorSpec = computed(() => (mirror.value ? {
  kind: 'bar', unit: 'eur',
  title: `Exportations de ${meta.countryName(mirror.value.reporter)} vers ${meta.countryName(mirror.value.partner)}, vues des deux côtés`,
  subtitle: 'Les écarts viennent des valorisations (FAB à l\'export, CAF à l\'import), des délais et des devises',
  labels: mirror.value.years.map((y) => String(y.year)),
  series: [
    { name: `Déclarées par ${meta.countryName(mirror.value.reporter)} (exportations)`, color: 1, values: mirror.value.years.map((y) => y.aExports) },
    { name: `Déclarées par ${meta.countryName(mirror.value.partner)} (importations)`, color: 3, values: mirror.value.years.map((y) => y.bImportsFromA) },
  ],
} : null));
const pairOptions = computed(() => meta.worldCountries.filter((c) => !c.mirrorOnly));

async function addToReport() {
  const img = await mapRef.value?.toImage().catch(() => null);
  reports.add([
    { type: 'heading', text: `Marché mondial — SH ${ncCode(code6.value)} ${label.value}`, level: 1 },
    { type: 'kpis', items: kpis.value.map((k) => ({ label: k.label, value: k.value, sub: k.extra.join(' · ') })) },
    ...(img ? [{ type: 'image', src: img, caption: `Principaux ${flowWord.value} — ${periodText.value}` }] : []),
    { type: 'chart', spec: JSON.parse(JSON.stringify(rankC.value)) },
    ...(mirrorSpec.value ? [{ type: 'chart', spec: JSON.parse(JSON.stringify(mirrorSpec.value)) }] : []),
  ], 'Marché mondial');
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Marché mondial</h1>
        <p>Tous les pays, y compris ceux qu'Eurostat ne couvre pas : sources nationales, Nations unies, et reconstitution miroir des pays qui ne publient pas.</p>
      </div>
      <div class="page-actions">
        <MeasureSwitch v-model="measure" />
        <button class="btn btn-primary" :disabled="!summary" @click="addToReport">＋ Ajouter au rapport</button>
      </div>
    </div>

    <div class="card toolbar">
      <div class="field grow"><span>Produit (SH à 6 chiffres, ou préfixe)</span><NcSearch v-model="product" placeholder="ex. 2204 21, vins, smartphones…" /></div>
      <div class="field"><span>Point de vue</span>
        <div class="seg">
          <button :class="{ on: flow === 'export' }" @click="flow = 'export'">Exportateurs</button>
          <button :class="{ on: flow === 'import' }" @click="flow = 'import'">Importateurs</button>
        </div>
      </div>
      <div class="field"><span>Période</span><PeriodPicker v-model:from="period.from" v-model:to="period.to" /></div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="summary" class="kpis" :class="{ loading }">
      <KpiCard v-for="k in kpis" :key="k.dot" v-bind="k" />
      <div v-if="top" class="card kpi-country">
        <div class="kl">Premier {{ flow === 'export' ? 'exportateur' : 'importateur' }}</div>
        <div class="kc"><Flag :code="top.key" :size="26" /><strong>{{ top.label }}</strong></div>
        <div class="kv">{{ fmt(key(top)) }}</div>
        <div class="hint">{{ badges[top.key] }}</div>
      </div>
      <KpiCard label="Part de l'UE" :value="euShare === null ? '—' : sharePct(euShare)" :sub="`des ${flowWord} déclarés (hors intra-UE)`" />
      <KpiCard label="Pays couverts" :value="String(summary.reporterCount)" :sub="`${meta.worldCountries.filter((c) => c.mirrorOnly).length} reconstitués en miroir`" />
    </div>

    <section class="card" style="margin-top: 16px">
      <div class="card-head">
        <div><h2>Carte des {{ flowWord }}</h2><p>SH {{ ncCode(code6) }} {{ label }} · {{ periodText }} · intensité selon {{ measure === 'value' ? 'la valeur' : measure === 'quantity' ? 'le volume' : 'le prix moyen' }}</p></div>
      </div>
      <WorldMap ref="mapRef" :values="values" :details="details" :formatter="fmt" :height="440" />
    </section>

    <div class="grid grid-2" style="margin-top: 16px">
      <ChartCard :spec="rankC" :height="hbarHeight(Math.min(15, rows.length), 1)" :loading="loading" />
      <ChartCard :spec="trendC" :height="300" :loading="loading" />
    </div>

    <section class="card" style="margin-top: 16px">
      <div class="card-head"><div><h2>Tous les {{ flowWord }} ({{ rows.length }})</h2><p>Valeur, volume, prix moyen · source des données pour chaque pays</p></div>
        <RouterLink class="btn btn-sm" :to="{ path: '/prix', query: { product: code6, scope: 'world', flow } }">Comparer les prix →</RouterLink>
      </div>
      <RankTable :rows="rows" :measure="measure" :flow="flow" key-label="Pays" :badges="badges" />
    </section>

    <section v-if="code6.length === 6" class="card" style="margin-top: 16px">
      <div class="card-head">
        <div><h2>Comparaison miroir</h2><p>Un même flux déclaré par l'exportateur et par l'importateur : un contrôle de cohérence des données</p></div>
        <div class="row">
          <label class="field">Exportateur <select v-model="mirrorPair.a"><option v-for="c in pairOptions" :key="c.code" :value="c.code">{{ c.name }}</option></select></label>
          <label class="field">Importateur <select v-model="mirrorPair.b"><option v-for="c in pairOptions" :key="c.code" :value="c.code">{{ c.name }}</option></select></label>
        </div>
      </div>
      <template v-if="mirror && mirrorSpec">
        <div class="mirror-kpis">
          <div><Flag :code="mirror.reporter" /> {{ eur(mirror.totals.aExports) }} <span class="muted">déclarés à l'export</span></div>
          <div><Flag :code="mirror.partner" /> {{ eur(mirror.totals.bImportsFromA) }} <span class="muted">déclarés à l'import</span></div>
          <div>Écart : <strong>{{ mirror.totals.aExports ? percent(mirror.totals.bImportsFromA / mirror.totals.aExports - 1) : '—' }}</strong></div>
        </div>
        <ChartCard :spec="mirrorSpec" :height="260" />
      </template>
      <p v-else class="empty">Pas de déclaration croisée pour ces deux pays sur ce produit.</p>
    </section>

    <section class="card" style="margin-top: 16px">
      <div class="card-head"><div><h2>Sources des données</h2><p>Mises à jour automatiquement ; une source plus fiable n'est jamais remplacée par une moins fiable</p></div></div>
      <div class="sources">
        <div v-for="s in meta.sources" :key="s.id" class="src">
          <strong>{{ s.name }}</strong>
          <span class="hint">{{ s.coverage }}</span>
          <span class="hint">{{ s.level }} · {{ s.frequency }} · {{ s.currency }}{{ s.currency !== 'EUR' ? ' converti en € (taux BCE)' : '' }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin-bottom: 16px; }
.grow { flex: 1; min-width: 260px; }
.kpi-country { padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; }
.kl { font-size: 0.78rem; color: var(--text-2); font-weight: 500; }
.kc { display: flex; gap: 8px; align-items: center; font-size: 1.05rem; }
.kv { font-size: 1.35rem; font-weight: 650; }
.mirror-kpis { display: flex; flex-wrap: wrap; gap: 8px 28px; margin-bottom: 10px; font-size: 0.95rem; }
.sources { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
.src { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 10px; background: var(--surface-2); }
.field select { min-width: 160px; }
</style>
