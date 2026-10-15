<script setup>
import Loader from '../components/Loader.vue';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { eur, tonnes, perKg, ncCode, rangeLabel, percent, sharePct } from '../format.js';
import { useMetaStore } from '../stores/meta.js';
import { useAuthStore } from '../stores/auth.js';
import { useReportsStore } from '../stores/reports.js';
import { axisLabel, hbarHeight } from '../lib/specs.js';
import { bestGranularity } from '../lib/granularity.js';
import PeriodPicker from '../components/PeriodPicker.vue';
import MultiSelect from '../components/MultiSelect.vue';
import NcSearch from '../components/NcSearch.vue';
import ChartCard from '../components/ChartCard.vue';
import Flag from '../components/Flag.vue';

// Comparateur de produits : 2 à 4 codes NC8, dans le même sens d'échange et sur la même période.
// Pour chacun : valeur, volume, prix moyen et médian, évolution sur un an, principaux pays ;
// puis évolution superposée et marchés communs.
const route = useRoute();
const router = useRouter();
const meta = useMetaStore();
const auth = useAuthStore();
const reports = useReportsStore();

const codes = ref(String(route.query.codes || '').split(',').filter((c) => /^\d{8}$/.test(c)).slice(0, 4));
const flow = ref(route.query.flow === 'import' ? 'import' : 'export');
const reporters = ref(route.query.reporters ? String(route.query.reporters).split(',') : []);
const period = ref({ from: String(route.query.periodFrom || ''), to: String(route.query.periodTo || '') });
const measure = ref('value');
const base100 = ref(false);
const picker = ref('');
const data = ref({});
const loading = ref(false);
const error = ref('');

const FLOW = {
  export: { title: 'Exportations de l\'UE', partners: 'Principaux pays de destination', eu: 'Principaux pays exportateurs de l\'UE' },
  import: { title: 'Importations de l\'UE', partners: 'Principaux pays d\'origine', eu: 'Principaux pays importateurs de l\'UE' },
};
const COLORS = [1, 2, 3, 7];

function add(p) {
  if (!p?.code || codes.value.includes(p.code) || codes.value.length >= 4) return;
  codes.value = [...codes.value, p.code];
  picker.value = '';
}
const remove = (c) => { codes.value = codes.value.filter((x) => x !== c); };

const granularity = computed(() => bestGranularity(period.value.from, period.value.to, meta));
async function loadOne(code) {
  const p = { product: code, reporters: reporters.value, periodFrom: period.value.from, periodTo: period.value.to };
  const [info, summary, series, partners, eu, prices] = await Promise.all([
    api(`/products/${code}`),
    api('/stats/summary', { params: p }),
    api('/stats/timeseries', { params: { ...p, granularity: granularity.value } }),
    api('/stats/top', { params: { ...p, flow: flow.value, dimension: 'partner', limit: 10 } }),
    reporters.value.length ? Promise.resolve([]) : api('/stats/top', { params: { ...p, flow: flow.value, dimension: 'reporter', limit: 5 } }),
    auth.has('prices') ? api('/stats/prices', { params: { ...p, flow: flow.value, dimension: flow.value === 'import' ? 'partner' : 'reporter' } }).catch(() => null) : null,
  ]);
  return { code, info, summary, series, partners, eu, prices };
}
async function load() {
  router.replace({ query: { codes: codes.value.join(',') || undefined, flow: flow.value, reporters: reporters.value.join(',') || undefined, periodFrom: period.value.from || undefined, periodTo: period.value.to || undefined } });
  if (!codes.value.length) { data.value = {}; return; }
  loading.value = true;
  error.value = '';
  try {
    await meta.load();
    const all = await Promise.all(codes.value.map(loadOne));
    data.value = Object.fromEntries(all.map((d) => [d.code, d]));
  } catch (e) { error.value = e.message; } finally { loading.value = false; }
}
watch([codes, flow, reporters], load, { deep: true });
watch(period, load, { deep: true });
onMounted(load);

const items = computed(() => codes.value.map((c, i) => ({ ...data.value[c], color: COLORS[i] })).filter((d) => d.info));
const k = computed(() => (flow.value === 'import' ? 'import' : 'export'));
const val = (d) => d.summary[`${k.value}Eur`];
const kg = (d) => d.summary[`${k.value}Kg`];
const change = (d) => d.summary[`change${k.value === 'import' ? 'Import' : 'Export'}`];
const periodText = computed(() => {
  const p = items.value[0]?.summary?.period;
  return p ? rangeLabel(p.from, p.to) : '';
});
const short = (d) => (d.info.description.length > 40 ? `${d.info.description.slice(0, 39)}…` : d.info.description);

// Évolution superposée (un seul axe ; base 100 pour comparer des ordres de grandeur différents)
const trend = computed(() => {
  if (!items.value.length) return null;
  const key = { value: 'Eur', quantity: 'Kg', price: 'Price' }[measure.value];
  const rows = items.value[0].series;
  const series = items.value.map((d) => {
    let values = d.series.map((r) => r[`${k.value}${key}`] ?? null);
    if (base100.value) {
      const first = values.find((v) => v > 0);
      values = values.map((v) => (first && v !== null ? (v / first) * 100 : null));
    }
    return { name: `${ncCode(d.code)} ${short(d)}`, color: d.color, values };
  });
  return {
    kind: 'line', unit: base100.value ? 'index' : { value: 'eur', quantity: 'kg', price: 'eurkg' }[measure.value],
    title: `${FLOW[flow.value].title} — ${{ value: 'valeur', quantity: 'volume', price: 'prix moyen au kilo' }[measure.value]}${base100.value ? ' (base 100 au début de la période)' : ''}`,
    subtitle: `${periodText.value}${reporters.value.length ? ` · ${reporters.value.map(meta.countryName).join(', ')}` : ' · ensemble de l\'UE'}`,
    labels: rows.map(axisLabel), series,
  };
});

// Marchés communs : pays partenaires des produits comparés, valeur par produit
const markets = computed(() => {
  const keys = new Map();
  for (const d of items.value) for (const p of d.partners) if (!keys.has(p.key)) keys.set(p.key, p.label);
  return [...keys.entries()].map(([key, label]) => ({
    key, label,
    values: items.value.map((d) => d.partners.find((p) => p.key === key)?.[`${k.value}Eur`] || 0),
  })).sort((a, b) => b.values.reduce((s, v) => s + v, 0) - a.values.reduce((s, v) => s + v, 0)).slice(0, 15);
});
const marketSpec = computed(() => (markets.value.length ? {
  kind: 'hbar', unit: 'eur', title: FLOW[flow.value].partners, subtitle: `Valeur par produit · ${periodText.value}`,
  labels: markets.value.map((m) => m.label), keys: markets.value.map((m) => m.key),
  series: items.value.map((d, i) => ({ name: `${ncCode(d.code)} ${short(d)}`, color: d.color, values: markets.value.map((m) => m.values[i]) })),
} : null));

function addToReport() {
  reports.add([
    { type: 'heading', text: `Comparaison — ${FLOW[flow.value].title}`, level: 1 },
    {
      type: 'table', title: `Produits comparés · ${periodText.value}`,
      columns: ['Code NC', 'Produit', 'Valeur', 'Volume', 'Prix moyen', 'Prix médian', 'Sur un an'],
      rows: items.value.map((d) => [ncCode(d.code), d.info.description, eur(val(d)), tonnes(kg(d)), perKg(kg(d) ? val(d) / kg(d) : null), perKg(d.prices?.overall?.median), percent(change(d))]),
    },
    ...(trend.value ? [{ type: 'chart', spec: JSON.parse(JSON.stringify(trend.value)) }] : []),
    ...(marketSpec.value ? [{ type: 'chart', spec: JSON.parse(JSON.stringify(marketSpec.value)) }] : []),
  ], 'Comparaison');
}
const countryOpts = computed(() => meta.reporters.map((c) => ({ value: c.code, label: c.name })));
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Comparer des produits</h1>
        <p>Choisissez jusqu'à 4 codes NC à 8 chiffres : mêmes indicateurs, même période, même sens d'échange.</p>
      </div>
      <button class="btn btn-primary" :disabled="!items.length" @click="addToReport">＋ Ajouter au rapport</button>
    </div>

    <div class="card setup">
      <div class="chosen">
        <span v-for="(c, i) in codes" :key="c" class="chip" :style="{ borderColor: `var(--s${COLORS[i]})` }">
          <span class="sw" :style="{ background: `var(--s${COLORS[i]})` }" />
          <span class="nc">{{ ncCode(c) }}</span> <span class="lbl">{{ data[c] ? short(data[c]) : '' }}</span>
          <button class="x" :aria-label="`Retirer ${c}`" @click="remove(c)">×</button>
        </span>
        <div v-if="codes.length < 4" class="add"><NcSearch v-model="picker" placeholder="Ajouter un produit : mot ou code NC8" @select="add" /></div>
      </div>
      <div class="opts">
        <div class="field"><span>Sens des échanges</span>
          <div class="seg">
            <button :class="{ on: flow === 'export' }" @click="flow = 'export'">Exportations de l'UE</button>
            <button :class="{ on: flow === 'import' }" @click="flow = 'import'">Importations de l'UE</button>
          </div>
        </div>
        <div class="field"><span>Période</span><PeriodPicker v-model:from="period.from" v-model:to="period.to" /></div>
        <div class="field"><span>Pays de l'UE</span><MultiSelect v-model="reporters" :options="countryOpts" placeholder="Toute l'UE" flags /></div>
      </div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="!codes.length" class="empty card">Ajoutez au moins deux produits pour les comparer. Par exemple « vins mousseux » et « vins tranquilles », ou deux variétés de fromage.</p>

    <Loader v-if="codes.length && !items.length && loading" class="card" text="Chargement de la comparaison…" />
    <template v-if="items.length">
      <div class="cards" :class="{ loading }">
        <section v-for="d in items" :key="d.code" class="card prod" :style="{ borderTopColor: `var(--s${d.color})` }">
          <RouterLink :to="`/produits/${d.code}`" class="nc code">{{ ncCode(d.code) }}</RouterLink>
          <h2>{{ d.info.description }}</h2>
          <p class="hint">{{ d.info.hs6Label }}</p>
          <dl>
            <dt>{{ FLOW[flow].title }}</dt><dd><strong>{{ eur(val(d)) }}</strong> <span :class="change(d) >= 0 ? 'up' : 'down'" class="small">{{ percent(change(d)) }} sur un an</span></dd>
            <dt>Volume</dt><dd>{{ tonnes(kg(d)) }}</dd>
            <dt>Prix moyen</dt><dd>{{ perKg(kg(d) ? val(d) / kg(d) : null) }}</dd>
            <dt v-if="d.prices">Prix médian</dt><dd v-if="d.prices">{{ perKg(d.prices.overall?.median) }} <span class="hint">P25–P75 {{ perKg(d.prices.overall?.p25) }} – {{ perKg(d.prices.overall?.p75) }}</span></dd>
          </dl>
          <h3>{{ FLOW[flow].partners }}</h3>
          <ol class="top">
            <li v-for="p in d.partners.slice(0, 5)" :key="p.key"><Flag :code="p.key" /> <span>{{ p.label }}</span><span class="num">{{ sharePct(p[`${k}Eur`] / (val(d) || 1)) }}</span></li>
          </ol>
          <template v-if="d.eu.length">
            <h3>{{ FLOW[flow].eu }}</h3>
            <ol class="top">
              <li v-for="p in d.eu.slice(0, 3)" :key="p.key"><Flag :code="p.key" /> <span>{{ p.label }}</span><span class="num">{{ sharePct(p[`${k}Eur`] / (val(d) || 1)) }}</span></li>
            </ol>
          </template>
        </section>
      </div>

      <div style="margin-top: 16px">
        <ChartCard v-if="trend" :spec="trend" :height="320" :loading="loading">
          <template #controls>
            <div class="seg">
              <button :class="{ on: measure === 'value' }" @click="measure = 'value'">Valeur</button>
              <button :class="{ on: measure === 'quantity' }" @click="measure = 'quantity'">Volume</button>
              <button :class="{ on: measure === 'price' }" @click="measure = 'price'">Prix au kg</button>
            </div>
            <label class="toggle"><input v-model="base100" type="checkbox" /> Base 100</label>
          </template>
        </ChartCard>
      </div>
      <div style="margin-top: 16px">
        <ChartCard v-if="marketSpec" :spec="marketSpec" :height="hbarHeight(markets.length, items.length)" :loading="loading" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.setup { display: grid; gap: 14px; margin-bottom: 16px; }
.chosen { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 8px 6px 10px; border-radius: 10px; border: 2px solid var(--border); background: var(--surface); max-width: 360px; }
.chip .nc { white-space: nowrap; }
.chip .lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.86rem; color: var(--text-2); }
.sw { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.x { border: 0; background: none; color: var(--muted); font-size: 1.1rem; cursor: pointer; }
.add { flex: 1; min-width: 280px; }
.opts { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
.opts .field { min-width: 200px; }
.cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.prod { border-top: 4px solid; display: flex; flex-direction: column; gap: 4px; }
.prod .code { font-weight: 700; }
.prod h2 { font-size: 0.98rem; line-height: 1.3; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; margin: 10px 0 4px; font-size: 0.88rem; }
dt { color: var(--text-2); }
dd { margin: 0; }
h3 { margin: 10px 0 4px; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
.top { margin: 0; padding-left: 18px; display: grid; gap: 3px; font-size: 0.86rem; }
.top li > span:nth-of-type(1) { margin-right: auto; }
.top li { display: list-item; }
.top .num { float: right; color: var(--text-2); }
.toggle { display: inline-flex; gap: 6px; align-items: center; font-size: 0.82rem; color: var(--text-2); }
</style>
