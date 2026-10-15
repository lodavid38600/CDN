<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import DataChart from './DataChart.vue';
import ChartLegend from './ChartLegend.vue';
import KpiCard from './KpiCard.vue';
import Loader from './Loader.vue';
import { eur, sharePct } from '../format.js';
import { flowKpis } from '../lib/kpis.js';
import { hbarHeight } from '../lib/specs.js';
import { downloadDataUrl, renderChartImage, slug } from '../lib/chart.js';
import { useMetaStore } from '../stores/meta.js';
import { useReportsStore } from '../stores/reports.js';
import { widgetPeriod, fetchWidgetData, widgetSpec, describeFilters, periodText } from '../lib/widgets.js';

// Un graphique du tableau de bord : suivi (recalculé à chaque ouverture) ou figé (chiffres enregistrés).
const props = defineProps({
  widget: { type: Object, required: true },
  index: { type: Number, default: 0 },
  count: { type: Number, default: 1 },
  preview: Boolean,
});
const emit = defineEmits(['edit', 'remove', 'move', 'resize', 'freeze', 'follow', 'duplicate', 'data']);
const meta = useMetaStore();
const reports = useReportsStore();
const data = ref(null);
const loading = ref(false);
const error = ref('');
const menuOpen = ref(false);
const root = ref(null);
let seq = 0;

const w = computed(() => props.widget);
const period = computed(() => widgetPeriod(w.value, meta.lastPeriod));
const frozen = computed(() => w.value.mode === 'fixed' && w.value.snapshot);
const shown = computed(() => (frozen.value ? w.value.snapshot : data.value));
const spec = computed(() => (shown.value && w.value.type !== 'kpi' ? widgetSpec(w.value, shown.value) : null));
const kpis = computed(() => (w.value.type === 'kpi' && shown.value?.summary ? flowKpis(shown.value.summary, w.value.params.measure) : []));
const height = computed(() => (w.value.type === 'rank' ? hbarHeight(spec.value?.labels.length || 5, w.value.params.flow ? 1 : 2) : w.value.size === 'full' ? 300 : 240));
const hasData = computed(() => (spec.value ? spec.value.labels.length > 0 : kpis.value.length > 0));
const filters = computed(() => describeFilters(w.value, meta.countryName));

async function load() {
  if (frozen.value) { data.value = null; return; }
  const id = ++seq;
  loading.value = true;
  error.value = '';
  try {
    await meta.load();
    const d = await fetchWidgetData(w.value, period.value);
    if (id !== seq) return;
    data.value = d;
    emit('data', d);
  } catch (e) {
    if (id === seq) error.value = e.message;
  } finally {
    if (id === seq) loading.value = false;
  }
}
const key = computed(() => JSON.stringify([w.value.type, w.value.params, w.value.mode, w.value.months, w.value.from, w.value.to, Boolean(w.value.snapshot), meta.lastPeriod]));
watch(key, load);
onMounted(load);

function act(name, ...args) { menuOpen.value = false; emit(name, ...args); }
function toReport() {
  menuOpen.value = false;
  if (spec.value) reports.add([{ type: 'chart', spec: JSON.parse(JSON.stringify({ ...spec.value, subtitle: `${filters.value} · ${periodText(w.value, period.value)}` })) }], w.value.title);
  else if (kpis.value.length) reports.add([{ type: 'kpis', items: kpis.value.map((k) => ({ label: k.label, value: k.value, sub: k.extra.join(' · ') })) }], w.value.title);
}
function png() {
  menuOpen.value = false;
  downloadDataUrl(renderChartImage(spec.value), `${slug(w.value.title)}.png`);
}
const onDoc = (e) => { if (root.value && !root.value.contains(e.target)) menuOpen.value = false; };
onMounted(() => document.addEventListener('click', onDoc));
onBeforeUnmount(() => document.removeEventListener('click', onDoc));
const dateFr = (d) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
defineExpose({ data: () => data.value, period });
</script>

<template>
  <section class="card widget" :class="{ full: w.size === 'full' }">
    <header class="w-head">
      <span v-if="!preview" class="grip" title="Glisser pour déplacer" aria-hidden="true">⠿</span>
      <div class="titles">
        <h2>{{ w.title }}</h2>
        <p class="hint">{{ filters }}</p>
        <p class="badges">
          <span v-if="w.mode === 'fixed'" class="badge" title="Les chiffres ne changent plus">📌 Figé · {{ periodText(w, period) }}</span>
          <span v-else class="badge badge-accent" title="Recalculé avec les dernières données à chaque ouverture">↻ Suivi · {{ periodText(w, period) }}</span>
          <span v-if="w.mode === 'fixed' && w.frozenAt" class="hint">enregistré le {{ dateFr(w.frozenAt) }}</span>
        </p>
      </div>
      <div v-if="!preview" ref="root" class="menu-wrap">
        <button class="btn btn-sm btn-icon" aria-label="Actions du graphique" title="Actions" @click="menuOpen = !menuOpen">⋯</button>
        <div v-if="menuOpen" class="menu" role="menu">
          <button role="menuitem" @click="act('edit')">✎ Modifier filtres et titre</button>
          <button role="menuitem" @click="act('resize')">{{ w.size === 'full' ? '⇤ Réduire (demi-largeur)' : '⇔ Agrandir (pleine largeur)' }}</button>
          <button role="menuitem" :disabled="index === 0" @click="act('move', -1)">↑ Déplacer avant</button>
          <button role="menuitem" :disabled="index === count - 1" @click="act('move', 1)">↓ Déplacer après</button>
          <button role="menuitem" @click="act('duplicate')">⧉ Dupliquer</button>
          <hr />
          <button v-if="w.mode === 'live'" role="menuitem" :disabled="!data" @click="act('freeze', data, period)">📌 Figer ces chiffres (garder en mémoire)</button>
          <button v-else role="menuitem" @click="act('follow')">↻ Suivre à nouveau les dernières données</button>
          <button role="menuitem" :disabled="!hasData" @click="toReport">＋ Ajouter au rapport…</button>
          <button v-if="spec" role="menuitem" :disabled="!hasData" @click="png">Image PNG</button>
          <hr />
          <button role="menuitem" class="danger" @click="act('remove')">🗑 Supprimer</button>
        </div>
      </div>
    </header>

    <Loader v-if="loading && !shown" text="Chargement du graphique…" />
    <p v-else-if="error" class="error">{{ error }} <button class="btn btn-sm" @click="load">Réessayer</button></p>
    <div v-else-if="shown" :class="{ loading }">
      <div v-if="!hasData" class="empty">Aucune donnée pour ces filtres sur cette période</div>
      <template v-else-if="spec">
        <ChartLegend v-if="spec.series.length > 1" :series="spec.series" :kind="spec.kind" class="lg" />
        <DataChart :spec="spec" :height="height" />
      </template>
      <div v-else class="kpis">
        <KpiCard v-for="k in kpis" :key="k.dot" v-bind="k" />
        <KpiCard label="Solde commercial" :value="`${shown.summary.balanceEur >= 0 ? '+' : ''}${eur(shown.summary.balanceEur)}`" :sub="`Couverture ${shown.summary.importEur ? sharePct(shown.summary.exportEur / shown.summary.importEur) : '—'}`" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.widget { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.w-head { display: flex; gap: 8px; align-items: flex-start; }
.grip { cursor: grab; color: var(--muted); font-size: 1.1rem; line-height: 1.4; user-select: none; }
.titles { flex: 1; min-width: 0; }
.titles h2 { font-size: 1rem; margin: 0; }
.titles .hint { margin: 2px 0 0; overflow: hidden; text-overflow: ellipsis; }
.badges { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 6px 0 0; }
.badge { font-size: 0.72rem; }
.menu-wrap { position: relative; }
.menu hr { border: 0; border-top: 1px solid var(--border); margin: 4px 0; }
.menu .danger { color: var(--bad); }
.lg { margin-bottom: 4px; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
</style>
