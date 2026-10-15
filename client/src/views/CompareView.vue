<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { eur, tonnes, perKg, ncCode, rangeLabel, percent } from '../format.js';
import { useMetaStore } from '../stores/meta.js';
import { useReportsStore } from '../stores/reports.js';
import { axisLabel, hbarHeight } from '../lib/specs.js';
import PeriodPicker from '../components/PeriodPicker.vue';
import MultiSelect from '../components/MultiSelect.vue';
import NcSearch from '../components/NcSearch.vue';
import ChartCard from '../components/ChartCard.vue';

// Comparateur : 2 à 4 jeux de données (produit × flux × pays) sur un même graphique,
// dans le temps ou par pays. Un seul axe : la base 100 permet de comparer des ordres de grandeur différents.
const route = useRoute();
const router = useRouter();
const meta = useMetaStore();
const reports = useReportsStore();

let uid = 0;
const newSeries = (o = {}) => ({ id: ++uid, product: '', flow: 'export', reporters: [], partners: [], ...o });
const series = ref([]);
const mode = ref('time');
const dimension = ref('reporter');
const granularity = ref('year');
const measure = ref('value');
const base100 = ref(false);
const chartKind = ref('line');
const period = ref({ from: '', to: '' });
const results = ref([]);
const labels = ref({});
const loading = ref(false);
const error = ref('');

const PRESETS = [
  { id: 'flows', label: 'Exportateurs vs importateurs', desc: "Un produit : qui exporte, qui importe ? (ex. les choux)" },
  { id: 'countries', label: 'Deux pays UE', desc: 'France vs Allemagne sur un même produit' },
  { id: 'products', label: 'Deux produits', desc: 'Vins vs bières, à l\'export' },
  { id: 'partners', label: 'Deux partenaires', desc: 'États-Unis vs Chine' },
];
function applyPreset(id, product = '') {
  if (id === 'flows') {
    const p = product || '070490';
    series.value = [newSeries({ product: p, flow: 'export' }), newSeries({ product: p, flow: 'import' })];
    mode.value = 'country';
    dimension.value = 'reporter';
  } else if (id === 'countries') {
    const p = product || '2204';
    series.value = [newSeries({ product: p, reporters: ['FR'] }), newSeries({ product: p, reporters: ['DE'] })];
    mode.value = 'time';
  } else if (id === 'products') {
    series.value = [newSeries({ product: product || '2204' }), newSeries({ product: '2203' })];
    mode.value = 'time';
  } else if (id === 'partners') {
    series.value = [newSeries({ product, partners: ['US'] }), newSeries({ product, partners: ['CN'] })];
    mode.value = 'time';
  }
}

const flowName = (f) => ({ export: 'Exportations', import: 'Importations', both: 'Échanges' })[f];
async function productLabel(code) {
  if (!code || labels.value[code] !== undefined) return;
  labels.value[code] = '';
  try {
    if (code.length === 8) labels.value[code] = (await api(`/products/${code}`)).description;
    else if (code.length === 2 || code.length === 6) labels.value[code] = (await api(`/nomenclature/${code}`)).label;
  } catch { /* libellé facultatif */ }
}
const shortLabel = (code) => {
  const l = labels.value[code];
  if (!code) return 'Tous produits';
  const t = l ? (l.length > 28 ? `${l.slice(0, 27)}…` : l) : `NC ${ncCode(code)}`;
  return `${t} (${ncCode(code)})`;
};
const seriesName = (s) => {
  const parts = [flowName(s.flow), shortLabel(s.product)];
  if (s.reporters.length) parts.push(s.reporters.map(meta.countryName).join(', '));
  if (s.partners.length) parts.push(`${s.flow === 'import' ? 'depuis' : 'vers'} ${s.partners.map(meta.countryName).join(', ')}`);
  return parts.join(' · ');
};

const mk = computed(() => (measure.value === 'quantity' ? 'Kg' : 'Eur'));
function pick(row, flow) {
  const get = (m) => (flow === 'both' ? row[`import${m}`] + row[`export${m}`] : row[`${flow}${m}`]);
  if (measure.value === 'price') {
    const q = get('Kg');
    return q > 0 ? get('Eur') / q : null;
  }
  return get(mk.value);
}

async function run() {
  loading.value = true;
  error.value = '';
  try {
    await Promise.all(series.value.map((s) => productLabel(s.product)));
    results.value = await Promise.all(
      series.value.map(async (s) => {
        const p = { product: s.product, reporters: s.reporters, partners: s.partners, periodFrom: period.value.from, periodTo: period.value.to };
        const [summary, data] = await Promise.all([
          api('/stats/summary', { params: p }),
          mode.value === 'time'
            ? api('/stats/timeseries', { params: { ...p, granularity: granularity.value } })
            : api('/stats/top', { params: { ...p, dimension: dimension.value, flow: s.flow === 'both' ? '' : s.flow, limit: 30, sort: measure.value === 'quantity' ? 'quantity' : 'value' } }),
        ]);
        return { s, summary, data };
      })
    );
    router.replace({ query: { s: JSON.stringify({ series: series.value.map(({ id, ...x }) => x), mode: mode.value, dimension: dimension.value, granularity: granularity.value, measure: measure.value, base100: base100.value, period: period.value }) } });
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

const unit = computed(() => (base100.value && mode.value === 'time' ? 'index' : measure.value === 'quantity' ? 'kg' : measure.value === 'price' ? 'eurkg' : 'eur'));
const spec = computed(() => {
  const title = mode.value === 'time' ? 'Comparaison dans le temps' : `Comparaison par ${dimension.value === 'reporter' ? 'pays UE déclarant' : 'partenaire hors UE'}`;
  const subtitle = `${measure.value === 'quantity' ? 'Quantités (t)' : measure.value === 'price' ? 'Prix moyen (€/kg)' : 'Valeurs (€)'}${base100.value && mode.value === 'time' ? ', base 100 au début de la période' : ''} · ${rangeLabel(period.value.from, period.value.to)}`;
  if (!results.value.length) return { kind: 'line', title, subtitle, labels: [], series: [], unit: unit.value };

  if (mode.value === 'time') {
    const rows0 = results.value[0].data;
    const out = results.value.map((r, i) => {
      let values = r.data.map((row) => pick(row, r.s.flow));
      if (base100.value) {
        const first = values.find((v) => v > 0);
        values = values.map((v) => (first && v !== null ? (v / first) * 100 : null));
      }
      return { name: seriesName(r.s), color: i + 1, values };
    });
    return { kind: chartKind.value === 'line' ? 'line' : 'bar', title, subtitle, labels: rows0.map(axisLabel), series: out, unit: unit.value };
  }

  // Par pays : union des pays, triés par valeur maximale toutes séries confondues.
  const byKey = new Map();
  results.value.forEach((r, i) => {
    for (const row of r.data) {
      const e = byKey.get(row.key) || { key: row.key, label: row.label, vals: Array(results.value.length).fill(0) };
      e.vals[i] = pick(row, r.s.flow) || 0;
      byKey.set(row.key, e);
    }
  });
  const keys = [...byKey.values()].sort((a, b) => Math.max(...b.vals) - Math.max(...a.vals)).slice(0, 15);
  return {
    kind: 'hbar', title, subtitle, unit: unit.value,
    labels: keys.map((k) => k.label), keys: keys.map((k) => k.key),
    series: results.value.map((r, i) => ({ name: seriesName(r.s), color: i + 1, values: keys.map((k) => k.vals[i]) })),
  };
});
const chartHeight = computed(() => (mode.value === 'time' ? 360 : hbarHeight(spec.value.labels.length, results.value.length) + results.value.length * 6));

const fmtTotal = (r) => {
  const s = r.summary;
  const v = (m) => (r.s.flow === 'both' ? s[`import${m}`] + s[`export${m}`] : s[`${r.s.flow}${m}`]);
  return { value: eur(v('Eur')), qty: tonnes(v('Kg')), price: perKg(v('Eur') / v('Kg')), change: r.s.flow === 'import' ? s.changeImport : r.s.flow === 'export' ? s.changeExport : null };
};

function add() {
  if (series.value.length < 4) series.value.push(newSeries({ product: series.value.at(-1)?.product || '' }));
}
function remove(i) {
  series.value.splice(i, 1);
}
function addToReport() {
  reports.add([
    { type: 'chart', spec: JSON.parse(JSON.stringify(spec.value)) },
    {
      type: 'table', title: 'Totaux sur la période',
      columns: ['Jeu de données', 'Valeur', 'Quantité', 'Prix moyen'],
      rows: results.value.map((r) => { const t = fmtTotal(r); return [seriesName(r.s), t.value, t.qty, t.price]; }),
    },
  ], 'Comparaison');
}

let timer;
watch([series, mode, dimension, granularity, period, measure], () => { clearTimeout(timer); timer = setTimeout(run, 300); }, { deep: true });
onMounted(async () => {
  await meta.load();
  if (route.query.s) {
    try {
      const st = JSON.parse(String(route.query.s));
      series.value = (st.series || []).slice(0, 4).map((x) => newSeries(x));
      Object.assign(period.value, st.period || {});
      mode.value = st.mode || 'time'; dimension.value = st.dimension || 'reporter'; granularity.value = st.granularity || 'year';
      measure.value = st.measure || 'value'; base100.value = Boolean(st.base100);
    } catch { applyPreset('flows'); }
  } else applyPreset(String(route.query.preset || 'flows'), String(route.query.product || ''));
});
const countryOpts = (list) => list.map((c) => ({ value: c.code, label: c.name }));
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Comparateur</h1>
        <p>Superposez jusqu'à 4 jeux de données sur le même graphique : produits, flux, pays déclarants, partenaires.</p>
      </div>
      <div class="page-actions"><button class="btn btn-primary" :disabled="!results.length" @click="addToReport">＋ Ajouter au rapport</button></div>
    </div>

    <div class="presets">
      <button v-for="p in PRESETS" :key="p.id" class="preset card" @click="applyPreset(p.id)">
        <strong>{{ p.label }}</strong><span class="hint">{{ p.desc }}</span>
      </button>
    </div>

    <div class="series">
      <div v-for="(s, i) in series" :key="s.id" class="card serie" :style="{ '--c': `var(--s${i + 1})` }">
        <div class="serie-h">
          <span class="swatch" /> <strong>Jeu {{ String.fromCharCode(65 + i) }}</strong>
          <span class="hint name">{{ seriesName(s) }}</span>
          <button v-if="series.length > 1" class="btn btn-sm btn-ghost" aria-label="Retirer" @click="remove(i)">✕</button>
        </div>
        <div class="serie-f">
          <div class="field"><span>Produit</span><NcSearch v-model="s.product" placeholder="Tous produits" /></div>
          <div class="field"><span>Flux</span>
            <div class="seg">
              <button :class="{ on: s.flow === 'export' }" @click="s.flow = 'export'">Export</button>
              <button :class="{ on: s.flow === 'import' }" @click="s.flow = 'import'">Import</button>
              <button :class="{ on: s.flow === 'both' }" @click="s.flow = 'both'">Les deux</button>
            </div>
          </div>
          <div class="field"><span>Pays UE</span><MultiSelect v-model="s.reporters" :options="countryOpts(meta.reporters)" placeholder="Toute l'UE" flags /></div>
          <div class="field"><span>Partenaires</span><MultiSelect v-model="s.partners" :options="countryOpts(meta.partners)" placeholder="Tous" flags /></div>
        </div>
      </div>
      <button v-if="series.length < 4" class="card add" @click="add">＋ Ajouter un jeu de données</button>
    </div>

    <div class="card toolbar">
      <div class="field"><span>Comparer</span>
        <div class="seg">
          <button :class="{ on: mode === 'time' }" @click="mode = 'time'">Dans le temps</button>
          <button :class="{ on: mode === 'country' }" @click="mode = 'country'">Par pays</button>
        </div>
      </div>
      <div v-if="mode === 'country'" class="field"><span>Pays</span>
        <div class="seg">
          <button :class="{ on: dimension === 'reporter' }" @click="dimension = 'reporter'">UE déclarants</button>
          <button :class="{ on: dimension === 'partner' }" @click="dimension = 'partner'">Partenaires hors UE</button>
        </div>
      </div>
      <div v-if="mode === 'time'" class="field"><span>Pas de temps</span>
        <div class="seg">
          <button :class="{ on: granularity === 'month' }" @click="granularity = 'month'">Mois</button>
          <button :class="{ on: granularity === 'year' }" @click="granularity = 'year'">Année</button>
        </div>
      </div>
      <div class="field"><span>Mesure</span>
        <div class="seg">
          <button :class="{ on: measure === 'value' }" @click="measure = 'value'">Valeur €</button>
          <button :class="{ on: measure === 'quantity' }" @click="measure = 'quantity'">Quantité</button>
          <button :class="{ on: measure === 'price' }" @click="measure = 'price'">Prix €/kg</button>
        </div>
      </div>
      <div class="field"><span>Période</span><PeriodPicker v-model:from="period.from" v-model:to="period.to" /></div>
      <label v-if="mode === 'time'" class="chk" title="Chaque série vaut 100 au début de la période : compare les évolutions, quels que soient les ordres de grandeur"><input v-model="base100" type="checkbox" /> Base 100</label>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <ChartCard :spec="spec" :height="chartHeight" :loading="loading">
      <template v-if="mode === 'time'" #controls>
        <div class="seg">
          <button :class="{ on: chartKind === 'line' }" @click="chartKind = 'line'">Courbes</button>
          <button :class="{ on: chartKind === 'bar' }" @click="chartKind = 'bar'">Colonnes</button>
        </div>
      </template>
    </ChartCard>

    <div class="totals">
      <div v-for="(r, i) in results" :key="r.s.id" class="card total" :style="{ '--c': `var(--s${i + 1})` }">
        <div class="serie-h"><span class="swatch" /><strong>Jeu {{ String.fromCharCode(65 + i) }}</strong></div>
        <p class="hint">{{ seriesName(r.s) }}</p>
        <div class="tv">{{ fmtTotal(r).value }}</div>
        <div class="small secondary">{{ fmtTotal(r).qty }} · {{ fmtTotal(r).price }}</div>
        <div v-if="fmtTotal(r).change !== null" class="small" :class="fmtTotal(r).change >= 0 ? 'up' : 'down'">{{ percent(fmtTotal(r).change) }} <span class="muted">sur un an</span></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.presets { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-bottom: 16px; }
.preset { display: flex; flex-direction: column; gap: 2px; text-align: left; cursor: pointer; font: inherit; color: var(--text); padding: 12px 14px; }
.preset:hover { border-color: var(--accent); }
.series { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 12px; margin-bottom: 16px; }
.serie { border-top: 4px solid var(--c); }
.serie-h { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
.swatch { width: 12px; height: 12px; border-radius: 3px; background: var(--c); flex: none; }
.name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.serie-f { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.add { border: 2px dashed var(--border); background: transparent; color: var(--text-2); font: inherit; cursor: pointer; box-shadow: none; min-height: 120px; }
.add:hover { border-color: var(--accent); color: var(--text); }
.toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin-bottom: 16px; }
.chk { display: flex; gap: 6px; align-items: center; font-size: 0.85rem; color: var(--text-2); padding-bottom: 8px; }
.totals { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top: 16px; }
.total { border-left: 4px solid var(--c); }
.tv { font-size: 1.5rem; font-weight: 700; margin-top: 4px; }
@media (max-width: 600px) { .series { grid-template-columns: 1fr; } .serie-f { grid-template-columns: 1fr; } }
</style>
