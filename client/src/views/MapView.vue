<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api.js';
import { eur, tonnes, percent, rangeLabel, ncCode } from '../format.js';
import { useMetaStore } from '../stores/meta.js';
import { useReportsStore } from '../stores/reports.js';
import { trendSpec } from '../lib/specs.js';
import PeriodPicker from '../components/PeriodPicker.vue';
import NcSearch from '../components/NcSearch.vue';
import WorldMap from '../components/WorldMap.vue';
import Flag from '../components/Flag.vue';
import DataChart from '../components/DataChart.vue';
import RankTable from '../components/RankTable.vue';

// Carte de tous les pays couverts : partenaires hors UE et/ou pays UE déclarants.
const route = useRoute();
const meta = useMetaStore();
const reports = useReportsStore();
const mapRef = ref(null);

const mode = ref('partner');
const flow = ref('');
const measure = ref('value');
const period = ref({ from: '', to: '' });
const product = ref(route.query.product ? String(route.query.product) : '');
const partners = ref([]);
const reporters = ref([]);
const selected = ref('');
const panel = ref(null);
const loading = ref(false);
const error = ref('');

const mk = computed(() => (measure.value === 'quantity' ? 'Kg' : 'Eur'));
const fmt = computed(() => (measure.value === 'quantity' ? tonnes : eur));
const base = computed(() => ({ periodFrom: period.value.from, periodTo: period.value.to, product: product.value }));
const rows = computed(() => (mode.value === 'partner' ? partners.value : mode.value === 'reporter' ? reporters.value : [...partners.value, ...reporters.value]));
const valueOf = (r) => (flow.value ? r[`${flow.value}${mk.value}`] : r[`import${mk.value}`] + r[`export${mk.value}`]);
const values = computed(() => Object.fromEntries(rows.value.map((r) => [r.key, valueOf(r)])));
const details = computed(() =>
  Object.fromEntries(rows.value.map((r) => [r.key, { name: r.label, lines: [`Import : ${fmt.value(r[`import${mk.value}`])}`, `Export : ${fmt.value(r[`export${mk.value}`])}`] }]))
);
const isEu = (code) => meta.reporters.some((c) => c.code === code);
const euCodes = computed(() => meta.reporters.map((c) => c.code));
const periodText = computed(() => rangeLabel(period.value.from, period.value.to));
const sorted = computed(() => [...rows.value].sort((a, b) => valueOf(b) - valueOf(a)));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    await meta.load();
    [partners.value, reporters.value] = await Promise.all([
      api('/stats/top', { params: { ...base.value, dimension: 'partner', limit: 100 } }),
      api('/stats/top', { params: { ...base.value, dimension: 'reporter', limit: 100 } }),
    ]);
    if (selected.value) await select(selected.value);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function select(code) {
  selected.value = code;
  const eu = isEu(code);
  const scope = eu ? { reporters: [code] } : { partners: [code] };
  const p = { ...base.value, ...scope };
  const [s, ts, prods, counter] = await Promise.all([
    api('/stats/summary', { params: p }),
    api('/stats/timeseries', { params: { ...p, granularity: 'month' } }),
    product.value.length === 8 ? Promise.resolve([]) : api('/stats/top', { params: { ...p, flow: flow.value, dimension: 'product', limit: 6 } }),
    api('/stats/top', { params: { ...p, flow: flow.value, dimension: eu ? 'partner' : 'reporter', limit: 6 } }),
  ]);
  const c = meta.country(code);
  panel.value = { code, eu, name: c?.name || code, region: c?.region || '', summary: s, series: ts, products: prods, counter };
}
const panelSpec = computed(() =>
  panel.value ? trendSpec({ rows: panel.value.series, measure: measure.value, flow: flow.value, title: `Évolution mensuelle — ${panel.value.name}` }) : null
);

watch([period, product], load, { deep: true });
onMounted(load);

async function addMap() {
  const src = await mapRef.value.toImage();
  const what = mode.value === 'partner' ? 'Partenaires hors UE' : mode.value === 'reporter' ? 'Pays UE déclarants' : 'Pays couverts';
  reports.add([{ type: 'image', src, caption: `${what} — ${flow.value === 'import' ? 'importations' : flow.value === 'export' ? 'exportations' : 'échanges'}${product.value ? ` · NC ${ncCode(product.value)}` : ''} · ${periodText.value}` }], 'Carte');
}
function addPanel() {
  const p = panel.value;
  const s = p.summary;
  reports.add(
    [
      { type: 'heading', text: `${p.name}${p.eu ? ' (pays UE déclarant)' : ' (partenaire hors UE)'}`, level: 2 },
      { type: 'kpis', items: [
        { label: p.eu ? 'Importations hors UE' : "Exportations vers l'UE", value: eur(s.importEur), sub: `${percent(s.changeImport)} sur un an` },
        { label: p.eu ? 'Exportations hors UE' : "Importations depuis l'UE", value: eur(s.exportEur), sub: `${percent(s.changeExport)} sur un an` },
        { label: 'Solde (point de vue UE)', value: eur(s.balanceEur), sub: s.balanceEur >= 0 ? 'Excédent UE' : 'Déficit UE' },
      ] },
      { type: 'chart', spec: panelSpec.value },
    ],
    p.name
  );
}
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Carte du monde</h1>
        <p>Les {{ meta.reporters.length }} pays UE déclarants et {{ meta.partners.length }} partenaires hors UE couverts par les données</p>
      </div>
      <div class="page-actions"><button class="btn" @click="addMap">＋ Carte au rapport</button></div>
    </div>

    <div class="card toolbar">
      <div class="field"><span>Pays affichés</span>
        <div class="seg">
          <button :class="{ on: mode === 'partner' }" @click="mode = 'partner'">Hors UE</button>
          <button :class="{ on: mode === 'reporter' }" @click="mode = 'reporter'">UE</button>
          <button :class="{ on: mode === 'all' }" @click="mode = 'all'">Tous</button>
        </div>
      </div>
      <div class="field"><span>Flux</span>
        <div class="seg">
          <button :class="{ on: !flow }" @click="flow = ''">Les deux</button>
          <button :class="{ on: flow === 'import' }" @click="flow = 'import'">Import</button>
          <button :class="{ on: flow === 'export' }" @click="flow = 'export'">Export</button>
        </div>
      </div>
      <div class="field"><span>Mesure</span>
        <div class="seg">
          <button :class="{ on: measure === 'value' }" @click="measure = 'value'">€</button>
          <button :class="{ on: measure === 'quantity' }" @click="measure = 'quantity'">Tonnes</button>
        </div>
      </div>
      <div class="field"><span>Période</span><PeriodPicker v-model:from="period.from" v-model:to="period.to" /></div>
      <div class="field grow"><span>Produit (facultatif)</span><NcSearch v-model="product" /></div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="layout" :class="{ loading, withPanel: panel }">
      <section class="card mapcard">
        <WorldMap ref="mapRef" :values="values" :details="details" :formatter="fmt" :selected="selected" :highlight="mode === 'all' ? euCodes : []" :height="520" @select="select" />
      </section>

      <aside v-if="panel" class="card side">
        <div class="side-h">
          <Flag :code="panel.code" :size="40" />
          <div>
            <h2>{{ panel.name }}</h2>
            <p class="hint">{{ panel.eu ? 'Pays UE déclarant' : `Partenaire hors UE · ${panel.region}` }}</p>
          </div>
          <button class="btn btn-sm btn-icon close" aria-label="Fermer" @click="panel = null; selected = ''">✕</button>
        </div>
        <div class="sk">
          <div><span class="dot dot-import" />{{ panel.eu ? 'Importe (hors UE)' : "Vend à l'UE" }}<strong>{{ fmt(panel.summary[`import${mk}`]) }}</strong>
            <span :class="panel.summary.changeImport >= 0 ? 'up' : 'down'">{{ percent(panel.summary.changeImport) }} <span class="muted">1 an</span></span></div>
          <div><span class="dot dot-export" />{{ panel.eu ? 'Exporte (hors UE)' : "Achète à l'UE" }}<strong>{{ fmt(panel.summary[`export${mk}`]) }}</strong>
            <span :class="panel.summary.changeExport >= 0 ? 'up' : 'down'">{{ percent(panel.summary.changeExport) }} <span class="muted">1 an</span></span></div>
        </div>
        <DataChart v-if="panelSpec" :spec="panelSpec" :height="150" />
        <h3>{{ panel.eu ? 'Principaux partenaires hors UE' : 'Principaux pays UE' }}</h3>
        <ul class="mini">
          <li v-for="r in panel.counter" :key="r.key"><Flag :code="r.key" /> <span class="n">{{ r.label }}</span><span class="num">{{ eur(flow ? r[`${flow}Eur`] : r.totalEur) }}</span></li>
        </ul>
        <template v-if="panel.products.length">
          <h3>Produits les plus échangés</h3>
          <ul class="mini">
            <li v-for="r in panel.products" :key="r.key"><RouterLink :to="`/produits/${r.key}`" class="nc">{{ ncCode(r.key) }}</RouterLink><span class="n">{{ r.label }}</span><span class="num">{{ eur(flow ? r[`${flow}Eur`] : r.totalEur) }}</span></li>
          </ul>
        </template>
        <div class="row" style="margin-top: 12px">
          <RouterLink class="btn btn-sm btn-primary" :to="{ path: '/', query: { [panel.eu ? 'reporters' : 'partners']: panel.code, product: product || undefined, periodFrom: period.from || undefined, periodTo: period.to || undefined } }">Tableau de bord</RouterLink>
          <button class="btn btn-sm" @click="addPanel">＋ Au rapport</button>
        </div>
      </aside>
    </div>

    <section class="card" style="margin-top: 16px">
      <div class="card-head"><div><h2>Couverture des données</h2><p>{{ sorted.length }} pays · {{ periodText }}{{ product ? ` · NC ${ncCode(product)}` : '' }} · cliquer pour afficher la fiche pays</p></div></div>
      <RankTable :rows="sorted" :measure="measure" :flow="flow" key-label="Pays" @select="(r) => select(r.key)" />
    </section>
  </div>
</template>

<style scoped>
.toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin-bottom: 16px; }
.grow { flex: 1; min-width: 220px; }
.layout { display: grid; grid-template-columns: 1fr; gap: 16px; }
.layout.withPanel { grid-template-columns: minmax(0, 1fr) 360px; }
.mapcard { padding: 8px; }
.side { align-self: start; }
.side-h { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }
.close { margin-left: auto; }
.sk { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
.sk > div { display: flex; flex-direction: column; background: var(--surface-2); border-radius: 10px; padding: 8px 10px; font-size: 0.78rem; color: var(--text-2); }
.sk strong { font-size: 1.15rem; color: var(--text); }
h3 { margin: 14px 0 6px; font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
.mini { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 0.85rem; }
.mini li { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; }
.mini .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 1100px) { .layout.withPanel { grid-template-columns: 1fr; } }
</style>
