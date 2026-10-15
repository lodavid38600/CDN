<script setup>
import { computed, ref, watch } from 'vue';
import { api } from '../api.js';
import { eur, tonnes, perKg, percent, periodLabel } from '../format.js';
import { granularities } from '../lib/granularity.js';
import { downloadCsv, slug } from '../lib/chart.js';
import { useMetaStore } from '../stores/meta.js';
import { useReportsStore } from '../stores/reports.js';

// Tableau détaillé de la période demandée, découpé au mois, au trimestre ou à l'année
// (seulement les découpages possibles), avec la variation par rapport à la même période un an plus tôt.
const props = defineProps({
  params: { type: Object, required: true }, // filtres (product, reporters, partners…)
  from: { type: String, default: '' },
  to: { type: String, default: '' },
  granularity: { type: String, default: 'month' },
  title: { type: String, default: 'Détail par période' },
});
const emit = defineEmits(['update:granularity', 'pick']);
const meta = useMetaStore();
const reports = useReportsStore();
const rows = ref([]);
const loading = ref(false);

const opts = computed(() => granularities(props.from, props.to, meta).opts.filter((o) => o.enabled));
const shift12 = (p) => {
  const [y, m] = p.split('-').map(Number);
  return `${y - 1}-${String(m).padStart(2, '0')}`;
};
const prevKey = (period) => (period.length === 4 ? String(Number(period) - 1) : `${Number(period.slice(0, 4)) - 1}${period.slice(4)}`);

async function load() {
  loading.value = true;
  try {
    const from = props.from || meta.firstPeriod;
    const to = props.to || meta.lastPeriod;
    // On charge un an de plus en amont pour calculer les variations.
    const data = await api('/stats/timeseries', { params: { ...props.params, periodFrom: shift12(from), periodTo: to, granularity: props.granularity } });
    const byKey = new Map(data.map((r) => [r.period, r]));
    const start = props.granularity === 'year' ? from.slice(0, 4) : props.granularity === 'quarter' ? `${from.slice(0, 4)}-T${Math.ceil(Number(from.slice(5, 7)) / 3)}` : from;
    rows.value = data
      .filter((r) => r.period >= start)
      .map((r) => {
        const prev = byKey.get(prevKey(r.period));
        const comparable = prev && (!r.months || prev.months === r.months);
        return {
          ...r,
          changeImport: comparable && prev.importEur ? (r.importEur - prev.importEur) / prev.importEur : null,
          changeExport: comparable && prev.exportEur ? (r.exportEur - prev.exportEur) / prev.exportEur : null,
        };
      })
      .reverse();
  } finally {
    loading.value = false;
  }
}
watch(() => [JSON.stringify(props.params), props.from, props.to, props.granularity], load, { immediate: true });

const label = (r) => {
  const partial = r.months && ((r.quarter && r.months < 3) || (!r.quarter && !r.month && r.months < 12));
  return `${r.quarter ? periodLabel(r.period) : r.month ? periodLabel(r.period) : r.period}${partial ? ` (${r.months} mois)` : ''}`;
};
const totals = computed(() => rows.value.reduce((t, r) => ({ i: t.i + r.importEur, e: t.e + r.exportEur, ik: t.ik + r.importKg, ek: t.ek + r.exportKg }), { i: 0, e: 0, ik: 0, ek: 0 }));
const cols = ['Période', 'Importations', 'Exportations', 'Solde', 'Volume import', 'Volume export', 'Prix export', 'Var. import N-1', 'Var. export N-1'];
const asRow = (r) => [label(r), eur(r.importEur), eur(r.exportEur), eur(r.balanceEur), tonnes(r.importKg), tonnes(r.exportKg), perKg(r.exportEur / r.exportKg), percent(r.changeImport), percent(r.changeExport)];

function exportCsv() {
  downloadCsv(['Période', 'Importations (€)', 'Exportations (€)', 'Solde (€)', 'Import (kg)', 'Export (kg)', 'Var. import N-1', 'Var. export N-1'],
    rows.value.map((r) => [r.period, r.importEur, r.exportEur, r.balanceEur, r.importKg, r.exportKg, r.changeImport ?? '', r.changeExport ?? '']),
    `${slug(props.title)}-${props.granularity}.csv`);
}
function addToReport() {
  const word = { month: 'mois', quarter: 'trimestre', year: 'année' }[props.granularity];
  reports.add([{ type: 'table', title: `${props.title} — par ${word}`, columns: cols, rows: rows.value.map(asRow) }], `${props.title} par ${word}`);
}
</script>

<template>
  <section class="card" :class="{ loading }">
    <div class="card-head">
      <div>
        <h2>{{ title }}</h2>
        <p>Découpage de la période demandée · variation par rapport à la même période un an plus tôt · cliquer sur une ligne pour le détail</p>
      </div>
      <div class="row">
        <div class="seg" role="tablist" aria-label="Découpage">
          <button v-for="o in opts" :key="o.id" role="tab" :aria-selected="granularity === o.id" :class="{ on: granularity === o.id }" @click="emit('update:granularity', o.id)">
            {{ o.id === 'month' ? 'Par mois' : o.id === 'quarter' ? 'Par trimestre' : 'Par année' }} <span class="muted">({{ o.count }})</span>
          </button>
        </div>
        <button class="btn btn-sm" :disabled="!rows.length" @click="exportCsv">CSV</button>
        <button class="btn btn-sm" :disabled="!rows.length" @click="addToReport">＋ Au rapport</button>
      </div>
    </div>
    <div class="table-wrap scroll">
      <table>
        <thead>
          <tr>
            <th>Période</th>
            <th class="num"><span class="dot dot-import" />Import</th>
            <th class="num"><span class="dot dot-export" />Export</th>
            <th class="num">Solde</th>
            <th class="num">Volume import</th>
            <th class="num">Volume export</th>
            <th class="num">Prix export</th>
            <th class="num">Var. import</th>
            <th class="num">Var. export</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.period" class="clickable" @click="emit('pick', r.period)">
            <td class="per">{{ label(r) }}</td>
            <td class="num">{{ eur(r.importEur) }}</td>
            <td class="num">{{ eur(r.exportEur) }}</td>
            <td class="num" :class="r.balanceEur >= 0 ? 'up' : 'down'">{{ r.balanceEur >= 0 ? '+' : '' }}{{ eur(r.balanceEur) }}</td>
            <td class="num">{{ tonnes(r.importKg) }}</td>
            <td class="num">{{ tonnes(r.exportKg) }}</td>
            <td class="num">{{ perKg(r.exportEur / r.exportKg) }}</td>
            <td class="num" :class="{ up: r.changeImport > 0, down: r.changeImport < 0 }">{{ percent(r.changeImport) }}</td>
            <td class="num" :class="{ up: r.changeExport > 0, down: r.changeExport < 0 }">{{ percent(r.changeExport) }}</td>
          </tr>
          <tr v-if="!rows.length && !loading"><td colspan="9" class="empty">Aucune donnée</td></tr>
        </tbody>
        <tfoot v-if="rows.length > 1">
          <tr>
            <th>Total ({{ rows.length }})</th>
            <th class="num">{{ eur(totals.i) }}</th>
            <th class="num">{{ eur(totals.e) }}</th>
            <th class="num">{{ eur(totals.e - totals.i) }}</th>
            <th class="num">{{ tonnes(totals.ik) }}</th>
            <th class="num">{{ tonnes(totals.ek) }}</th>
            <th class="num">{{ perKg(totals.e / totals.ek) }}</th>
            <th /><th />
          </tr>
        </tfoot>
      </table>
    </div>
  </section>
</template>

<style scoped>
.scroll { max-height: 440px; overflow-y: auto; }
.per { white-space: nowrap; font-weight: 550; }
tr.clickable { cursor: pointer; }
tfoot th { color: var(--text); text-transform: none; font-size: 0.86rem; letter-spacing: 0; position: sticky; bottom: 0; background: var(--surface); border-top: 2px solid var(--grid); }
thead th { position: sticky; top: 0; background: var(--surface); z-index: 1; }
</style>
