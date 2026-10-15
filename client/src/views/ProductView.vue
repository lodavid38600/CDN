<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { eur, tonnes, ncCode, perKg, percent, sharePct, rangeLabel, integer } from '../format.js';
import { useMetaStore } from '../stores/meta.js';
import { useReportsStore } from '../stores/reports.js';
import { trendSpec, rankSpec, seasonalitySpec, unitPriceSpec, hbarHeight, priceBoxSpec } from '../lib/specs.js';
import { flowKpis } from '../lib/kpis.js';
import MeasureSwitch from '../components/MeasureSwitch.vue';
import NcHistory from '../components/NcHistory.vue';
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
import GranularityPicker from '../components/GranularityPicker.vue';
import PeriodTable from '../components/PeriodTable.vue';
import PriceAnalysis from '../components/PriceAnalysis.vue';
import WorldMarket from '../components/WorldMarket.vue';
import SectionNav from '../components/SectionNav.vue';
import { bestGranularity, granularities, GRANULARITY_WORD } from '../lib/granularity.js';

// Fiche complète d'un code NC8, toutes les données sur une seule page : indicateurs, valeurs,
// volumes, prix (moyen, médian, quartiles, pays les moins / plus chers), tendances, prévision,
// saisonnalité, carte et classements des partenaires, matrice, marché mondial et miroirs.
const SECTIONS = [
  { id: 'synthese', label: 'Synthèse' },
  { id: 'evolution', label: 'Évolution' },
  { id: 'prix', label: 'Prix & volumes' },
  { id: 'pays', label: 'Pays partenaires' },
  { id: 'monde', label: 'Marché mondial' },
];
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
const quarterly = ref([]);
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
  flow: route.query.flow === 'import' ? 'import' : 'export', // un sens à la fois : la fiche reste lisible
});
const measure = ref('value');
const granularity = ref('month');
const chartKind = ref('line');
const withForecast = ref(true);
const mapMode = ref('partner');
const raw = ref(false); // codes tels que déclarés (sans reconstitution de la nomenclature)
const prices = ref(null);

const params = computed(() => ({
  product: props.code, periodFrom: local.value.from, periodTo: local.value.to,
  reporters: local.value.reporters, partners: local.value.partners, nc: raw.value ? 'brut' : undefined,
}));
const series = computed(() => ({ month: monthly.value, quarter: quarterly.value, year: annual.value })[granularity.value]);
const mk = computed(() => ({ quantity: 'Kg', price: 'Price' })[measure.value] || 'Eur');
const fmt = computed(() => ({ quantity: tonnes, price: perKg })[measure.value] || eur);
const kpis = computed(() => flowKpis(summary.value, measure.value));
const periodText = computed(() => (summary.value?.period ? rangeLabel(summary.value.period.from, summary.value.period.to) : ''));
const countryOpts = (list) => list.map((c) => ({ value: c.code, label: c.name }));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    await meta.load();
    const p = params.value;
    const top = (dimension, limit = 12) => api('/stats/top', { params: { ...p, flow: local.value.flow, dimension, limit, sort: measure.value === 'price' ? 'quantity' : measure.value } });
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
    if (granularity.value === 'quarter') await loadQuarterly();
    await loadForecast();
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
async function loadQuarterly() {
  quarterly.value = await api('/stats/timeseries', { params: { ...params.value, granularity: 'quarter' } });
}
// Granularité adaptée à la période demandée : recalculée à chaque changement de période.
function fitGranularity() {
  granularity.value = bestGranularity(local.value.from, local.value.to, meta);
}
async function loadForecast() {
  fc.value = withForecast.value
    ? await api('/stats/forecast', {
        params: { ...params.value, periodFrom: '', periodTo: '', granularity: granularity.value, horizon: { month: 12, quarter: 4, year: 3 }[granularity.value], measure: measure.value },
      })
    : null;
}
watch(() => props.code, async () => { await meta.load(); fitGranularity(); load(); }, { immediate: true });
watch(() => [local.value.from, local.value.to], fitGranularity);
watch(() => JSON.stringify(local.value), () => {
  router.replace({ query: Object.fromEntries(Object.entries({ flow: local.value.flow === 'import' ? 'import' : '', periodFrom: local.value.from, periodTo: local.value.to, reporters: local.value.reporters.join(','), partners: local.value.partners.join(',') }).filter(([, v]) => v)) });
  load();
});
watch(granularity, async (g) => {
  if (!granularities(local.value.from, local.value.to, meta).opts.find((o) => o.id === g)?.enabled) return fitGranularity();
  if (g === 'quarter') await loadQuarterly().catch(() => {});
  loadForecast().catch(() => {});
});
watch(withForecast, () => loadForecast().catch(() => {}));
watch(measure, load);
watch(raw, load);
// Prix par pays (exportations : pays UE ; importations : fournisseurs hors UE)
watch(() => [params.value, local.value.flow], async () => {
  const flow = local.value.flow === 'import' ? 'import' : 'export';
  prices.value = await api('/stats/prices', { params: { ...params.value, flow, dimension: flow === 'import' ? 'partner' : 'reporter' } }).catch(() => null);
}, { immediate: true, deep: true });
const priceBox = computed(() => (prices.value?.groups?.length ? priceBoxSpec({
  groups: prices.value.groups,
  title: prices.value.flow === 'import' ? 'Prix à l\'import par pays fournisseur' : 'Prix à l\'export par pays UE',
  subtitle: `Du moins cher au plus cher · boîte = 50 % des volumes (P25–P75), trait = prix médian · ${periodText.value}`,
}) : null));

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
    rows: series.value, fc: chartKind.value === 'line' ? fc.value : null, measure: measure.value, flow: '', // les deux sens, chacun nommé
    kind: chartKind.value === 'line' ? 'line' : 'bar',
    title: `Évolution ${GRANULARITY_WORD[granularity.value]} — ${ncCode(props.code)}`,
    subtitle: `${product.value?.description || ''} · ${periodText.value}`,
  })
);
const seasonSpec = computed(() => seasonalitySpec({ rows: monthly.value, measure: measure.value, title: 'Saisonnalité', subtitle: 'Moyenne par mois calendaire sur la période' }));
const priceSpec = computed(() => unitPriceSpec({ rows: series.value, title: 'Prix moyen au kilo', subtitle: 'Valeur / quantité, import et export' }));
const partnerSpec = computed(() => rankSpec({ rows: partners.value.slice(0, 12), measure: measure.value, flow: local.value.flow, title: F.value.partners, subtitle: `${F.value.title} · ${product.value?.description || ''} · ${periodText.value}` }));
const reporterSpec = computed(() => rankSpec({ rows: reporters.value.slice(0, 12), measure: measure.value, flow: local.value.flow, title: F.value.eu, subtitle: `${F.value.title} · ${product.value?.description || ''} · ${periodText.value}` }));

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

// Le sens des échanges, dit en clair partout sur la fiche
const F = computed(() => (local.value.flow === 'import'
  ? { title: 'Importations de l\'UE', long: 'importations de l\'UE depuis les pays hors UE', partners: 'Pays d\'origine (fournisseurs hors UE)', eu: 'Pays de l\'UE importateurs', mapPartner: 'Pays d\'origine', mapEu: 'Pays de l\'UE importateurs' }
  : { title: 'Exportations de l\'UE', long: 'exportations de l\'UE vers les pays hors UE', partners: 'Pays de destination (clients hors UE)', eu: 'Pays de l\'UE exportateurs', mapPartner: 'Pays de destination', mapEu: 'Pays de l\'UE exportateurs' }));
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
    ...(priceBox.value ? [{ type: 'chart', spec: JSON.parse(JSON.stringify(priceBox.value)) }, {
      type: 'table', title: `Prix par pays (${prices.value.flow === 'import' ? 'importations, fournisseurs hors UE' : 'exportations, pays UE'})`,
      columns: ['Pays', 'Volume', 'Prix moyen', 'Prix médian', 'P25', 'P75', 'Écart au médian'],
      rows: prices.value.groups.map((g) => [g.label, tonnes(g.quantityKg), perKg(g.mean), perKg(g.median), perKg(g.p25), perKg(g.p75), percent(g.vsMedian)]),
    }] : []),
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
      <RouterLink to="/nomenclature">Produits</RouterLink>
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
          <RouterLink class="btn" :to="{ path: '/comparateur', query: { codes: code } }">⇄ Comparer avec d'autres produits</RouterLink>
          <RouterLink class="btn" :to="{ path: '/declarations', query: { product: code, periodFrom: local.from || undefined, periodTo: local.to || undefined } }">Déclarations mois par mois</RouterLink>
          <button class="btn btn-primary" :disabled="!summary" @click="generateReport">📄 Générer un rapport</button>
        </div>
      </div>

      <NcHistory v-model:raw="raw" :history="product.history" :code="code" />

      <SectionNav :sections="SECTIONS" />
      <p class="context">Vous regardez les <strong>{{ F.long }}</strong> · <strong>{{ periodText || 'toute la période' }}</strong><span v-if="local.reporters.length"> · {{ local.reporters.map(meta.countryName).join(', ') }}</span><span v-if="local.partners.length"> · avec {{ local.partners.map(meta.countryName).join(', ') }}</span></p>

      <div class="card toolbar">
        <div class="field wide"><span>Période</span><PeriodPicker v-model:from="local.from" v-model:to="local.to" /></div>
        <div class="field wide"><span>Sens des échanges</span>
          <div class="seg">
            <button :class="{ on: local.flow === 'export' }" @click="local.flow = 'export'">Exportations de l'UE</button>
            <button :class="{ on: local.flow === 'import' }" @click="local.flow = 'import'">Importations de l'UE</button>
          </div>
        </div>
        <div class="field"><span>Pays de l'UE</span><MultiSelect v-model="local.reporters" :options="countryOpts(meta.reporters)" placeholder="Toute l'UE" flags /></div>
        <div class="field"><span>Pays hors UE</span><MultiSelect v-model="local.partners" :options="countryOpts(meta.partners)" placeholder="Tous" flags /></div>
        <div class="field"><span>Mesure</span>
          <MeasureSwitch v-model="measure" />
        </div>
      </div>

      <div id="synthese" class="anchor" />
      <div v-if="summary" class="kpis" :class="{ loading }">
        <KpiCard v-for="k in kpis" :key="k.dot" v-bind="k" :spark="monthly.slice(-24).map((r) => r[`${k.dot}${mk}`])" :spark-color="`var(--${k.dot})`" />
        <KpiCard label="Solde commercial" :value="`${summary.balanceEur >= 0 ? '+' : ''}${eur(summary.balanceEur)}`" :sub="`Couverture ${summary.importEur ? sharePct(summary.exportEur / summary.importEur) : '—'}`" />
        <KpiCard :label="prices?.flow === 'import' ? 'Prix médian à l\'import' : 'Prix médian à l\'export'" :value="perKg(prices?.overall?.median ?? unitExport)" :extra="prices?.overall ? [`P25–P75 : ${perKg(prices.overall.p25)} – ${perKg(prices.overall.p75)}`] : []" sub="Pondéré par les volumes" />
        <KpiCard label="Volumes échangés" :value="tonnes(summary.importKg + summary.exportKg)" :extra="[`${tonnes(summary.exportKg)} exportées`, `${tonnes(summary.importKg)} importées`]" />
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

      <h2 id="evolution" class="sec-title">Évolution des importations et des exportations de l'UE</h2>
      <div>
        <ChartCard :spec="trend" :height="320" pickable :loading="loading" @pick="(i) => (drawer = series[i]?.period || '')">
          <template #controls>
            <GranularityPicker v-model="granularity" :from="local.from" :to="local.to" />
            <div class="seg">
              <button :class="{ on: chartKind === 'line' }" @click="chartKind = 'line'">Courbes</button>
              <button :class="{ on: chartKind === 'bar' }" @click="chartKind = 'bar'">Colonnes</button>
            </div>
            <label class="fc-toggle"><input v-model="withForecast" type="checkbox" :disabled="chartKind !== 'line'" /> Prévision</label>
          </template>
          <p class="hint" style="margin-top: 8px">💡 Cliquez sur une colonne ou un point pour le détail de la période : pays partenaires, déclarants, drapeaux. Le pas de temps (mois, trimestre, année) s'adapte à la période choisie.</p>
        </ChartCard>
      </div>

      <div style="margin-top: 16px">
        <PeriodTable v-model:granularity="granularity" :params="{ product: code, reporters: local.reporters, partners: local.partners }" :from="local.from" :to="local.to"
          :title="`${ncCode(code)} — détail de la période`" @pick="(p) => (drawer = p)" />
      </div>

      <div class="grid grid-2" style="margin-top: 16px">
        <ChartCard :spec="seasonSpec" :height="240" :loading="loading" />
        <ChartCard :spec="priceSpec" :height="240" :loading="loading" />
      </div>

      <h2 id="prix" class="sec-title">Prix et volumes par pays · {{ F.long }}</h2>
      <PriceAnalysis :product="code" :label="reportTitle" :from="local.from" :to="local.to" :reporters="local.reporters" :partners="local.partners" :raw="raw" :flow="local.flow" />

      <h2 id="pays" class="sec-title">Pays · {{ F.long }}</h2>
      <section class="card">
        <div class="card-head">
          <div><h2>Carte des {{ F.long }}</h2><p>{{ product.description }} · {{ periodText }} · cliquer sur un pays pour filtrer</p></div>
          <div class="row">
            <div class="seg">
              <button :class="{ on: mapMode === 'partner' }" @click="mapMode = 'partner'">{{ F.mapPartner }}</button>
              <button :class="{ on: mapMode === 'reporter' }" @click="mapMode = 'reporter'">{{ F.mapEu }}</button>
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
          <div class="card-head"><div><h2>{{ F.partners }} ({{ partners.length }})</h2><p>{{ F.title }} · {{ periodText }}</p></div></div>
          <div class="scroll"><RankTable :rows="partners" :measure="measure" :flow="local.flow" key-label="Pays" @select="(r) => pickCountry(r.key)" /></div>
        </section>
        <section class="card">
          <div class="card-head"><div><h2>{{ F.eu }} ({{ reporters.length }})</h2><p>{{ F.title }} · {{ periodText }}</p></div></div>
          <div class="scroll"><RankTable :rows="reporters" :measure="measure" :flow="local.flow" key-label="Pays" /></div>
        </section>
      </div>

      <section class="card" style="margin-top: 16px">
        <div class="card-head">
          <div><h2>Qui commerce avec qui ?</h2><p>{{ F.title }} · pays de l'UE (lignes) × {{ local.flow === 'import' ? 'pays d\'origine' : 'pays de destination' }} (colonnes) · {{ periodText }}</p></div>
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

      <h2 id="monde" class="sec-title">Marché mondial · tous les pays du monde</h2>
      <WorldMarket :code="code" :from="local.from" :to="local.to" :measure="measure" :flow="local.flow" />
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
.extremes { margin: 0; padding-left: 22px; display: grid; gap: 6px; }
.extremes li { display: grid; grid-template-columns: auto 1fr auto 80px; gap: 8px; align-items: center; }
.extremes .small { text-align: right; }
.ext-h { margin: 10px 0 6px; font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
.context { margin: -6px 0 14px; font-size: 0.9rem; color: var(--text-2); }
.sec-title { margin: 32px 0 12px; font-size: 1.25rem; scroll-margin-top: 120px; }
.anchor { scroll-margin-top: 120px; }
.insight { display: flex; gap: 12px; align-items: center; margin-top: 16px; background: var(--accent-wash); }
@media (max-width: 700px) { .wide { grid-column: span 1; } }
</style>
