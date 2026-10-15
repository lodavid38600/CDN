<script setup>
import { computed, ref, watch } from 'vue';
import { api } from '../api.js';
import { eur, tonnes, perKg, percent, sharePct, rangeLabel, integer } from '../format.js';
import { useMetaStore } from '../stores/meta.js';
import { useReportsStore } from '../stores/reports.js';
import { priceBoxSpec, priceScatterSpec, priceTrendSpec, hbarHeight } from '../lib/specs.js';
import ChartCard from './ChartCard.vue';
import KpiCard from './KpiCard.vue';
import Flag from './Flag.vue';

// Prix unitaires (€/kg) et volumes d'un produit, pays par pays, intégrés à la fiche NC.
// Répond sans réglage : qui exporte au prix médian le plus bas, le plus haut, avec quels volumes,
// et comment le prix évolue. Les filtres (période, pays, codes bruts) sont ceux de la fiche.
const props = defineProps({
  product: { type: String, required: true },
  label: { type: String, default: '' },
  from: { type: String, default: '' },
  to: { type: String, default: '' },
  reporters: { type: Array, default: () => [] },
  partners: { type: Array, default: () => [] },
  raw: { type: Boolean, default: false },
  flow: { type: String, default: '' }, // flux choisi sur la fiche ('' = les deux → export par défaut)
});
const meta = useMetaStore();
const reports = useReportsStore();

const flow = ref(props.flow === 'import' ? 'import' : 'export');
watch(() => props.flow, (f) => { if (f) flow.value = f; });
const scope = ref('eu');
const data = ref(null);
const loading = ref(false);
const error = ref('');
const sortBy = ref('median');
const sortDir = ref(1);

// Point de vue : pays UE (déclarants), partenaires hors UE, ou tous les pays (données mondiales)
const SCOPES = computed(() => [
  { id: 'eu', label: flow.value === 'export' ? 'Pays UE exportateurs' : 'Pays UE importateurs', dimension: 'reporter', source: 'eu' },
  { id: 'partner', label: flow.value === 'export' ? 'Clients hors UE' : 'Fournisseurs hors UE', dimension: 'partner', source: 'eu' },
  { id: 'world', label: flow.value === 'export' ? 'Tous les exportateurs (monde)' : 'Tous les importateurs (monde)', dimension: 'reporter', source: 'world' },
]);
const scopeDef = computed(() => SCOPES.value.find((s) => s.id === scope.value));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const world = scopeDef.value.source === 'world';
    data.value = await api('/stats/prices', {
      params: {
        product: world ? props.product.slice(0, 6) : props.product, flow: flow.value, dimension: scopeDef.value.dimension, source: scopeDef.value.source,
        periodFrom: props.from, periodTo: props.to, nc: props.raw ? 'brut' : undefined,
        reporters: world ? undefined : props.reporters, partners: world ? undefined : props.partners,
      },
    });
  } catch (e) {
    error.value = e.message;
    data.value = null;
  } finally {
    loading.value = false;
  }
}
watch(() => [props.product, props.from, props.to, props.raw, props.reporters.join(), props.partners.join(), flow.value, scope.value], load, { immediate: true });

const groups = computed(() => data.value?.groups || []);
const o = computed(() => data.value?.overall);
const cheapest = computed(() => groups.value[0]);
const priciest = computed(() => groups.value.at(-1));
const biggest = computed(() => [...groups.value].sort((a, b) => b.quantityKg - a.quantityKg)[0]);
const periodText = computed(() => (data.value?.period ? rangeLabel(data.value.period.from, data.value.period.to) : ''));
const flowWord = computed(() => (flow.value === 'export' ? 'exportations' : 'importations'));

const sorted = computed(() => [...groups.value].sort((a, b) => ((a[sortBy.value] ?? 0) - (b[sortBy.value] ?? 0)) * sortDir.value));
function sort(k) {
  if (sortBy.value === k) sortDir.value = -sortDir.value;
  else {
    sortBy.value = k;
    sortDir.value = ['median', 'mean', 'p25', 'p75', 'min', 'max', 'spread', 'vsMedian'].includes(k) ? 1 : -1;
  }
}
const COLS = [
  ['quantityKg', 'Volume', tonnes], ['share', 'Part vol.', sharePct], ['valueEur', 'Valeur', eur], ['mean', 'Prix moyen', perKg], ['median', 'Prix médian', perKg],
  ['p25', 'P25', perKg], ['p75', 'P75', perKg], ['min', 'Min', perKg], ['max', 'Max', perKg],
  ['vsMedian', 'Écart au médian', (v) => percent(v)], ['spread', 'Dispersion', (v) => (v === null ? '—' : sharePct(v))], ['observations', 'Obs.', integer],
];

const boxSpec = computed(() => priceBoxSpec({
  groups: groups.value.slice(0, 40),
  title: `Prix ${flow.value === 'export' ? 'à l\'export' : 'à l\'import'} par pays — du moins cher au plus cher`,
  subtitle: `${props.label} · ${periodText.value} · boîte = 50 % des volumes (P25–P75), trait = médiane`,
}));
const scatterSpec = computed(() => priceScatterSpec({
  groups: groups.value, eu: meta.euCodes,
  title: 'Positionnement prix / volume',
  subtitle: `Chaque point est un pays · taille = volume${scope.value === 'world' ? ' · bleu : UE, orange : hors UE' : ''}`,
}));
const trendSpecC = computed(() => (data.value?.periods?.length ? priceTrendSpec({
  periods: data.value.periods, title: 'Évolution du prix médian (mois par mois)',
  subtitle: `Bande : 50 % des volumes échangés (P25–P75) · pointillés : prix moyen · ${periodText.value}`,
}) : null));

function addToReport() {
  reports.add([
    { type: 'heading', text: `Prix et volumes — ${props.label}`, level: 2 },
    {
      type: 'kpis',
      items: [
        { label: 'Prix médian', value: perKg(o.value.median), sub: `P25–P75 : ${perKg(o.value.p25)} – ${perKg(o.value.p75)}` },
        { label: 'Prix moyen', value: perKg(o.value.mean), sub: `${tonnes(o.value.quantityKg)} · ${eur(o.value.valueEur)}` },
        { label: 'Le moins cher', value: cheapest.value?.label || '—', sub: perKg(cheapest.value?.median) },
        { label: 'Le plus cher', value: priciest.value?.label || '—', sub: perKg(priciest.value?.median) },
      ],
    },
    { type: 'chart', spec: JSON.parse(JSON.stringify(boxSpec.value)) },
    ...(trendSpecC.value ? [{ type: 'chart', spec: JSON.parse(JSON.stringify(trendSpecC.value)) }] : []),
    {
      type: 'table', title: `Prix par pays (${flowWord.value} · ${scopeDef.value.label})`,
      columns: ['Pays', 'Volume', 'Prix moyen', 'Prix médian', 'P25', 'P75', 'Écart au médian'],
      rows: groups.value.map((g) => [g.label, tonnes(g.quantityKg), perKg(g.mean), perKg(g.median), perKg(g.p25), perKg(g.p75), percent(g.vsMedian)]),
    },
  ], 'Prix');
}
defineExpose({ addToReport, ready: () => !!o.value });
</script>

<template>
  <div>
    <div class="card toolbar">
      <div class="field"><span>Flux</span>
        <div class="seg">
          <button :class="{ on: flow === 'export' }" @click="flow = 'export'">Exportations</button>
          <button :class="{ on: flow === 'import' }" @click="flow = 'import'">Importations</button>
        </div>
      </div>
      <div class="field"><span>Pays comparés</span>
        <div class="seg">
          <button v-for="s in SCOPES" :key="s.id" :class="{ on: scope === s.id }" @click="scope = s.id">{{ s.label }}</button>
        </div>
      </div>
      <button class="btn btn-sm push" :disabled="!o" @click="addToReport">＋ Prix au rapport</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="data && o">
      <div class="kpis" :class="{ loading }">
        <KpiCard label="Prix médian" :value="perKg(o.median)" :extra="[`50 % des volumes entre ${perKg(o.p25)} et ${perKg(o.p75)}`]" sub="Pondéré par les volumes" />
        <KpiCard label="Prix moyen" :value="perKg(o.mean)" :extra="[`${tonnes(o.quantityKg)} pour ${eur(o.valueEur)}`]" sub="Valeur totale / volume total" />
        <div class="card kpi-country">
          <div class="kl">Prix médian le plus bas</div>
          <div class="kc"><Flag :code="cheapest.key" :size="26" /><strong>{{ cheapest.label }}</strong></div>
          <div class="kv">{{ perKg(cheapest.median) }} <span class="muted small">{{ percent(cheapest.vsMedian) }} vs médian</span></div>
          <div class="hint">{{ tonnes(cheapest.quantityKg) }} · {{ sharePct(cheapest.share) }} des volumes</div>
        </div>
        <div class="card kpi-country">
          <div class="kl">Prix médian le plus haut</div>
          <div class="kc"><Flag :code="priciest.key" :size="26" /><strong>{{ priciest.label }}</strong></div>
          <div class="kv">{{ perKg(priciest.median) }} <span class="muted small">{{ percent(priciest.vsMedian) }} vs médian</span></div>
          <div class="hint">{{ tonnes(priciest.quantityKg) }} · {{ sharePct(priciest.share) }} des volumes</div>
        </div>
        <div v-if="biggest" class="card kpi-country">
          <div class="kl">Premier en volume</div>
          <div class="kc"><Flag :code="biggest.key" :size="26" /><strong>{{ biggest.label }}</strong></div>
          <div class="kv">{{ tonnes(biggest.quantityKg) }}</div>
          <div class="hint">{{ sharePct(biggest.share) }} des volumes · {{ perKg(biggest.median) }}</div>
        </div>
      </div>

      <div class="grid grid-2" style="margin-top: 16px">
        <ChartCard :spec="boxSpec" :height="hbarHeight(Math.min(40, groups.length), 1) + 20" :loading="loading" />
        <div class="stack">
          <ChartCard :spec="scatterSpec" :height="300" :loading="loading" />
          <ChartCard v-if="trendSpecC" :spec="trendSpecC" :height="260" :loading="loading" />
        </div>
      </div>

      <section class="card" style="margin-top: 16px">
        <div class="card-head">
          <div><h2>Prix et volumes de tous les pays ({{ groups.length }})</h2><p>{{ scopeDef.label }} · {{ periodText }} · cliquer sur une colonne pour trier · {{ o.outliers }} valeur(s) aberrante(s) écartée(s) des bornes</p></div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pays</th>
                <th v-for="[k, l] in COLS" :key="k" class="num sortable" :class="{ em: sortBy === k }" @click="sort(k)">{{ l }}{{ sortBy === k ? (sortDir > 0 ? ' ↑' : ' ↓') : '' }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="g in sorted" :key="g.key" :class="{ low: g.key === cheapest?.key, high: g.key === priciest?.key }">
                <td class="pays"><Flag :code="g.key" /> {{ g.label }}
                  <span v-if="g.key === cheapest?.key" class="badge">le moins cher</span>
                  <span v-if="g.key === priciest?.key" class="badge">le plus cher</span>
                </td>
                <td v-for="[k, , f] in COLS" :key="k" class="num" :class="{ em: sortBy === k, up: k === 'vsMedian' && g[k] > 0, down: k === 'vsMedian' && g[k] < 0 }">{{ g[k] === null || g[k] === undefined ? '—' : f(g[k]) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="hint" style="margin-top: 8px">Prix médian : prix auquel s'échange la moitié des volumes. Dispersion : (P75 − P25) / médiane. Les déclarations au prix unitaire aberrant (au-delà de 3 écarts interquartiles, en échelle logarithmique) sont comptées mais exclues des minimums, maximums et quartiles.</p>
      </section>
    </template>
    <p v-else-if="!loading && !error" class="empty card">Aucune donnée de prix pour ce produit sur la période.</p>
  </div>
</template>

<style scoped>
.toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin-bottom: 16px; }
.push { margin-left: auto; }
.kpi-country { padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; }
.kl { font-size: 0.78rem; color: var(--text-2); font-weight: 500; }
.kc { display: flex; gap: 8px; align-items: center; font-size: 1.05rem; }
.kv { font-size: 1.35rem; font-weight: 650; }
td.num { color: var(--muted); }
td.num.em, th.em { color: var(--text); font-weight: 600; }
td.num.up { color: var(--good); }
td.num.down { color: var(--bad); }
.pays { white-space: nowrap; }
tr.low td { background: color-mix(in srgb, var(--s3) 10%, transparent); }
tr.high td { background: color-mix(in srgb, var(--s2) 10%, transparent); }
.badge { margin-left: 6px; }
</style>
