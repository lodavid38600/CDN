<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import DataChart from './DataChart.vue';
import ChartLegend from './ChartLegend.vue';
import { downloadCsv, downloadDataUrl, renderChartImage, specToTable, slug } from '../lib/chart.js';
import { useReportsStore } from '../stores/reports.js';

// Carte de graphique : titre, contrôles, légende, vue tableau et menu d'export
// (PNG, CSV, ajout à un rapport).
const props = defineProps({
  spec: { type: Object, required: true },
  height: { type: Number, default: 300 },
  pickable: Boolean,
  loading: Boolean,
});
const emit = defineEmits(['pick']);
const reports = useReportsStore();
const showTable = ref(false);
const menuOpen = ref(false);
const root = ref(null);

const table = computed(() => specToTable(props.spec));
const visibleSeries = computed(() => props.spec.series || []);
const hasData = computed(() => (props.spec.labels || []).length > 0);

function exportPng() {
  menuOpen.value = false;
  downloadDataUrl(renderChartImage(props.spec), `${slug(props.spec.title)}.png`);
}
function exportCsv() {
  menuOpen.value = false;
  downloadCsv(table.value.columns, table.value.raw, `${slug(props.spec.title)}.csv`);
}
function addToReport() {
  menuOpen.value = false;
  reports.add([{ type: 'chart', spec: JSON.parse(JSON.stringify(props.spec)) }], props.spec.title);
}
function onDoc(e) {
  if (root.value && !root.value.contains(e.target)) menuOpen.value = false;
}
onMounted(() => document.addEventListener('click', onDoc));
onBeforeUnmount(() => document.removeEventListener('click', onDoc));
</script>

<template>
  <section class="card chart-card" :class="{ loading }">
    <div class="card-head">
      <div class="titles">
        <h2>{{ spec.title }}</h2>
        <p v-if="spec.subtitle">{{ spec.subtitle }}</p>
      </div>
      <div ref="root" class="tools">
        <slot name="controls" />
        <div class="seg" role="group" aria-label="Affichage">
          <button :class="{ on: !showTable }" @click="showTable = false">Graphique</button>
          <button :class="{ on: showTable }" @click="showTable = true">Tableau</button>
        </div>
        <div class="menu-wrap">
          <button class="btn btn-sm btn-icon" aria-label="Exporter" title="Exporter / ajouter au rapport" @click="menuOpen = !menuOpen">
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3v10.6l3.3-3.3 1.4 1.4L12 16.4l-4.7-4.7 1.4-1.4 3.3 3.3V3zM5 19h14v2H5z" /></svg>
          </button>
          <div v-if="menuOpen" class="menu" role="menu">
            <button role="menuitem" @click="addToReport">＋ Ajouter au rapport…</button>
            <hr />
            <button role="menuitem" :disabled="!hasData" @click="exportPng">Image PNG</button>
            <button role="menuitem" :disabled="!hasData" @click="exportCsv">Données CSV</button>
          </div>
        </div>
      </div>
    </div>
    <ChartLegend v-if="!showTable && visibleSeries.length > 1" :series="visibleSeries" :kind="spec.kind" class="lg" />
    <div v-if="!hasData" class="empty" :style="{ height: `${height}px` }">Aucune donnée pour cette sélection</div>
    <DataChart v-else-if="!showTable" :spec="spec" :height="height" :pickable="pickable" @pick="(i) => emit('pick', i)" />
    <div v-else class="table-wrap" :style="{ maxHeight: `${height + 40}px` }">
      <table>
        <thead><tr><th v-for="(c, i) in table.columns" :key="i" :class="{ num: i > 0 }">{{ c }}</th></tr></thead>
        <tbody><tr v-for="(r, i) in table.rows" :key="i"><td v-for="(v, j) in r" :key="j" :class="{ num: j > 0 }">{{ v }}</td></tr></tbody>
      </table>
    </div>
    <p v-if="spec.note" class="hint note">{{ spec.note }}</p>
    <slot />
  </section>
</template>

<style scoped>
.titles { min-width: 0; flex: 1 1 240px; }
.tools { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; position: relative; }
.menu-wrap { position: relative; }
.lg { margin-bottom: 8px; }
.empty { display: grid; place-items: center; }
.note { margin-top: 8px; }
</style>
