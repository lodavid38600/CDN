<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api.js';
import { eur, tonnes, perKg, percent, rangeLabel, ncCode } from '../format.js';
import { useMetaStore } from '../stores/meta.js';
import { useReportsStore } from '../stores/reports.js';
import { useAuthStore } from '../stores/auth.js';
import { useDashboardStore } from '../stores/dashboard.js';
import { trendSpec } from '../lib/specs.js';
import PeriodPicker from '../components/PeriodPicker.vue';
import NcSearch from '../components/NcSearch.vue';
import Flag from '../components/Flag.vue';
import DataChart from '../components/DataChart.vue';
import RankTable from '../components/RankTable.vue';
import MeasureSwitch from '../components/MeasureSwitch.vue';
import Loader from '../components/Loader.vue';

// Carte de tous les pays couverts : partenaires hors UE et/ou pays UE déclarants.
const route = useRoute();
const meta = useMetaStore();
const reports = useReportsStore();
const auth = useAuthStore();
const dashboard = useDashboardStore();

const mode = ref('partner');
const flow = ref('');
const measure = ref('value');
const period = ref({ from: '', to: '' });
const product = ref(route.query.product ? String(route.query.product) : '');
const partners = ref([]);
const reporters = ref([]);
const selected = ref('');
const panel = ref(null);
const panelLoading = ref(false);
const loading = ref(false);
const loaded = ref(false);
let selSeq = 0;
const error = ref('');

const mk = computed(() => ({ quantity: 'Kg', price: 'Price' })[measure.value] || 'Eur');
const fmt = computed(() => ({ quantity: tonnes, price: perKg })[measure.value] || eur);
const base = computed(() => ({ periodFrom: period.value.from, periodTo: period.value.to, product: product.value }));
const rows = computed(() => (mode.value === 'partner' ? partners.value : mode.value === 'reporter' ? reporters.value : [...partners.value, ...reporters.value]));
const valueOf = (r) => {
  if (measure.value === 'price') {
    if (flow.value) return r[`${flow.value}Price`] ?? 0;
    return r.totalKg ? r.totalEur / r.totalKg : 0; // prix moyen tous flux
  }
  return flow.value ? r[`${flow.value}${mk.value}`] : r[`import${mk.value}`] + r[`export${mk.value}`];
};
const isEu = (code) => meta.reporters.some((c) => c.code === code);
const periodText = computed(() => rangeLabel(period.value.from, period.value.to));
const sorted = computed(() => [...rows.value].sort((a, b) => valueOf(b) - valueOf(a)));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    await meta.load();
    [partners.value, reporters.value] = await Promise.all([
      api('/stats/top', { params: { ...base.value, dimension: 'partner', limit: 300 } }),
      api('/stats/top', { params: { ...base.value, dimension: 'reporter', limit: 300 } }),
    ]);
    loaded.value = true;
    if (selected.value) await select(selected.value);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function select(code) {
  const id = ++selSeq;
  selected.value = code;
  const eu = isEu(code);
  const c = meta.country(code);
  // La fiche s'ouvre tout de suite ; les chiffres arrivent ensuite
  if (panel.value?.code !== code) panel.value = { code, eu, name: c?.name || code, region: c?.region || '', summary: null, series: [], products: [], counter: [] };
  panelLoading.value = true;
  const scope = eu ? { reporters: [code] } : { partners: [code] };
  const p = { ...base.value, ...scope };
  // Sans produit choisi : chapitres (tables de synthèse) ; avec un chapitre ou une position : ses codes
  const prodDim = product.value ? 'product' : 'chapter';
  try {
    const [s, ts, prods, counter] = await Promise.all([
      api('/stats/summary', { params: { ...p, counts: 0 } }),
      api('/stats/timeseries', { params: { ...p, granularity: 'month' } }),
      product.value.length === 8 ? Promise.resolve([]) : api('/stats/top', { params: { ...p, flow: flow.value, dimension: prodDim, limit: 6 } }),
      api('/stats/top', { params: { ...p, flow: flow.value, dimension: eu ? 'partner' : 'reporter', limit: 6 } }),
    ]);
    if (id !== selSeq) return; // un autre pays a été choisi entre-temps
    panel.value = { code, eu, name: c?.name || code, region: c?.region || '', summary: s, series: ts, products: prods.map((r) => ({ ...r, prodDim })), counter };
  } catch (e) {
    if (id === selSeq) error.value = e.message;
  } finally {
    if (id === selSeq) panelLoading.value = false;
  }
}
function closePanel() { selSeq += 1; panel.value = null; selected.value = ''; panelLoading.value = false; }
const panelSpec = computed(() =>
  panel.value?.summary ? trendSpec({ rows: panel.value.series, measure: measure.value, flow: flow.value, title: `Évolution mensuelle — ${panel.value.name}` }) : null
);

watch([period, product], load, { deep: true });
onMounted(load);

/** Graphique d'évolution du pays, avec les filtres en cours, vers le tableau de bord. */
function pinPanel() {
  const p = panel.value;
  const fixed = Boolean(period.value.from && period.value.to);
  dashboard.openBuilder({
    type: 'trend', title: `Évolution — ${p.name}`, mode: fixed ? 'fixed' : 'live', months: 24, from: period.value.from, to: period.value.to,
    params: { product: product.value, flow: flow.value, measure: measure.value, granularity: 'month', [p.eu ? 'reporters' : 'partners']: [p.code] },
  });
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
        <h1>Pays partenaires</h1>
        <p v-if="loaded">{{ reporters.length }} pays de l'Union et {{ partners.length }} partenaires hors Union ont échangé sur la période : choisissez un pays pour voir sa fiche.</p>
        <p v-else>Les pays de l'Union et leurs partenaires hors Union : choisissez un pays pour voir sa fiche.</p>
      </div>
    </div>

    <div class="card toolbar">
      <div class="field"><span>Pays affichés</span>
        <div class="seg">
          <button :class="{ on: mode === 'partner' }" @click="mode = 'partner'">Partenaires hors UE</button>
          <button :class="{ on: mode === 'reporter' }" @click="mode = 'reporter'">Pays de l'UE</button>
          <button :class="{ on: mode === 'all' }" @click="mode = 'all'">Tous</button>
        </div>
      </div>
      <div class="field"><span>Flux</span>
        <div class="seg">
          <button :class="{ on: !flow }" @click="flow = ''">Les deux sens</button>
          <button :class="{ on: flow === 'export' }" @click="flow = 'export'">Exportations de l'UE</button>
          <button :class="{ on: flow === 'import' }" @click="flow = 'import'">Importations de l'UE</button>
        </div>
      </div>
      <div class="field"><span>Mesure</span><MeasureSwitch v-model="measure" /></div>
      <div class="field"><span>Période</span><PeriodPicker v-model:from="period.from" v-model:to="period.to" /></div>
      <div class="field grow"><span>Produit (facultatif)</span><NcSearch v-model="product" /></div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="layout" :class="{ withPanel: panel }">
      <section class="card" :class="{ loading: loading && loaded }">
        <div class="card-head"><div><h2>{{ loaded ? `${sorted.length} pays` : 'Pays' }}</h2><p>{{ periodText }}{{ product ? ` · NC ${ncCode(product)}` : '' }} · cliquer sur un pays pour afficher sa fiche</p></div></div>
        <Loader v-if="!loaded && loading" text="Chargement des pays…" />
        <RankTable v-else :rows="sorted" :measure="measure" :flow="flow" key-label="Pays" :selected="selected" @select="(r) => select(r.key)" />
      </section>

      <aside v-if="panel" class="card side">
        <div class="side-h">
          <Flag :code="panel.code" :size="40" />
          <div>
            <h2>{{ panel.name }}</h2>
            <p class="hint">{{ panel.eu ? 'Pays UE déclarant' : `Partenaire hors UE · ${panel.region}` }}</p>
          </div>
          <button class="btn btn-sm btn-icon close" aria-label="Fermer" @click="closePanel">✕</button>
        </div>
        <Loader v-if="!panel.summary" text="Chargement de la fiche…" />
        <template v-else>
        <div :class="{ loading: panelLoading }">
        <div class="sk">
          <div><span class="dot dot-import" />{{ panel.eu ? 'Importe depuis les pays hors UE' : "Vend à l'UE (importations de l'UE)" }}<strong>{{ fmt(panel.summary[`import${mk}`]) }}</strong>
            <span :class="panel.summary.changeImport >= 0 ? 'up' : 'down'">{{ percent(panel.summary.changeImport) }} <span class="muted">1 an</span></span></div>
          <div><span class="dot dot-export" />{{ panel.eu ? 'Exporte vers les pays hors UE' : "Achète à l'UE (exportations de l'UE)" }}<strong>{{ fmt(panel.summary[`export${mk}`]) }}</strong>
            <span :class="panel.summary.changeExport >= 0 ? 'up' : 'down'">{{ percent(panel.summary.changeExport) }} <span class="muted">1 an</span></span></div>
        </div>
        <DataChart v-if="panelSpec" :spec="panelSpec" :height="150" />
        <h3>{{ panel.eu ? 'Principaux partenaires hors UE' : 'Principaux pays UE' }}</h3>
        <ul class="mini">
          <li v-for="r in panel.counter" :key="r.key"><Flag :code="r.key" /> <span class="n">{{ r.label }}</span><span class="num">{{ eur(flow ? r[`${flow}Eur`] : r.totalEur) }}</span></li>
        </ul>
        <template v-if="panel.products.length">
          <h3>{{ panel.products[0].prodDim === 'chapter' ? 'Chapitres les plus échangés' : 'Produits les plus échangés' }}</h3>
          <ul class="mini">
            <li v-for="r in panel.products" :key="r.key"><RouterLink :to="r.prodDim === 'chapter' ? `/nomenclature/${r.key}` : `/produits/${r.key}`" class="nc">{{ r.prodDim === 'chapter' ? `Ch. ${r.key}` : ncCode(r.key) }}</RouterLink><span class="n">{{ r.label }}</span><span class="num">{{ eur(flow ? r[`${flow}Eur`] : r.totalEur) }}</span></li>
          </ul>
        </template>
        </div>
        <div class="row" style="margin-top: 12px">
          <RouterLink class="btn btn-sm btn-primary" :to="{ path: '/declarations', query: { [panel.eu ? 'reporters' : 'partners']: panel.code, product: product || undefined } }">Ses déclarations</RouterLink>
          <button class="btn btn-sm" @click="addPanel">＋ Au rapport</button>
          <button v-if="auth.has('dashboard')" class="btn btn-sm" @click="pinPanel">＋ Au tableau de bord</button>
        </div>
        </template>
      </aside>
    </div>

  </div>
</template>

<style scoped>
.toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin-bottom: 16px; }
.grow { flex: 1; min-width: 220px; }
.layout { display: grid; grid-template-columns: 1fr; gap: 16px; }
.layout.withPanel { grid-template-columns: minmax(0, 1fr) 380px; }
.side { align-self: start; position: sticky; top: 72px; }
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
