<script setup>
import { computed } from 'vue';
import { Bar } from 'vue-chartjs';
import { Chart, BarElement, LinearScale, CategoryScale, Tooltip } from 'chart.js';
import { useChartTheme, compactEur, compactT } from './useChartTheme.js';

Chart.register(BarElement, LinearScale, CategoryScale, Tooltip);

// Barres horizontales groupées import / export par libellé (partenaires, sections…).
const props = defineProps({
  rows: { type: Array, default: () => [] }, // [{ key, label, importEur, exportEur, ... }]
  metric: { type: String, default: 'Eur' },
  maxLabel: { type: Number, default: 26 },
});
const emit = defineEmits(['select']);
const t = useChartTheme();
const fmt = computed(() => (props.metric === 'Kg' ? compactT : compactEur));
const truncate = (s) => (s.length > props.maxLabel ? `${s.slice(0, props.maxLabel - 1)}…` : s);

const data = computed(() => ({
  labels: props.rows.map((r) => truncate(r.label || r.key)),
  datasets: [
    { label: 'Importations', data: props.rows.map((r) => r[`import${props.metric}`]), backgroundColor: t.import },
    { label: 'Exportations', data: props.rows.map((r) => r[`export${props.metric}`]), backgroundColor: t.export },
  ].map((d) => ({ ...d, borderRadius: 4, borderSkipped: 'start', borderColor: t.surface, borderWidth: { top: 1, bottom: 1 }, barPercentage: 0.85, categoryPercentage: 0.75 })),
}));

const options = computed(() => ({
  indexAxis: 'y',
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', axis: 'y', intersect: false },
  onClick: (_, els) => els.length && emit('select', props.rows[els[0].index]),
  onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: t.surface, titleColor: t.text, bodyColor: t.text2, borderColor: t.axis, borderWidth: 1, padding: 10, boxPadding: 4,
      callbacks: {
        title: (items) => props.rows[items[0].dataIndex]?.label,
        label: (c) => ` ${c.dataset.label} : ${fmt.value(c.parsed.x)}`,
      },
    },
  },
  scales: {
    x: { beginAtZero: true, grid: { color: t.grid }, border: { display: false }, ticks: { color: t.muted, callback: (v) => fmt.value(v), maxTicksLimit: 5 } },
    y: { grid: { display: false }, border: { color: t.axis }, ticks: { color: t.text2, autoSkip: false } },
  },
}));
const height = computed(() => `${Math.max(160, props.rows.length * 34 + 40)}px`);
</script>

<template>
  <div>
    <div class="legend" aria-hidden="true">
      <span><span class="dot dot-import" />Importations</span>
      <span><span class="dot dot-export" />Exportations</span>
    </div>
    <div class="chart" :style="{ height }" role="img" :aria-label="`Comparaison importations / exportations pour ${rows.length} éléments`">
      <Bar :data="data" :options="options" />
    </div>
  </div>
</template>

<style scoped>
.legend { display: flex; gap: 16px; font-size: 0.82rem; color: var(--text-2); margin-bottom: 8px; }
.chart { position: relative; }
</style>
