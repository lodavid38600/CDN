<script setup>
import { computed } from 'vue';
import { Line } from 'vue-chartjs';
import { Chart, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler } from 'chart.js';
import { useChartTheme, compactEur, compactT } from './useChartTheme.js';

Chart.register(LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler);

// Évolution annuelle des importations et exportations (un seul axe : même unité).
const props = defineProps({
  rows: { type: Array, default: () => [] }, // [{ year, importEur, exportEur, importKg, exportKg }]
  metric: { type: String, default: 'Eur' }, // 'Eur' | 'Kg'
});
const t = useChartTheme();
const fmt = computed(() => (props.metric === 'Kg' ? compactT : compactEur));

const data = computed(() => ({
  labels: props.rows.map((r) => r.year),
  datasets: [
    { label: 'Importations', data: props.rows.map((r) => r[`import${props.metric}`]), borderColor: t.import, backgroundColor: t.import },
    { label: 'Exportations', data: props.rows.map((r) => r[`export${props.metric}`]), borderColor: t.export, backgroundColor: t.export },
  ].map((d) => ({ ...d, borderWidth: 2, pointRadius: 3, pointHoverRadius: 6, pointBorderColor: t.surface, pointBorderWidth: 2, tension: 0.25 })),
}));

const options = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: t.surface, titleColor: t.text, bodyColor: t.text2, borderColor: t.axis, borderWidth: 1,
      padding: 10, boxPadding: 4, usePointStyle: true,
      callbacks: { label: (c) => ` ${c.dataset.label} : ${fmt.value(c.parsed.y)}` },
    },
  },
  scales: {
    x: { grid: { display: false }, border: { color: t.axis }, ticks: { color: t.muted } },
    y: { beginAtZero: true, grid: { color: t.grid }, border: { display: false }, ticks: { color: t.muted, callback: (v) => fmt.value(v), maxTicksLimit: 6 } },
  },
}));
</script>

<template>
  <div>
    <div class="legend" aria-hidden="true">
      <span><span class="dot dot-import" />Importations (hors UE → UE)</span>
      <span><span class="dot dot-export" />Exportations (UE → hors UE)</span>
    </div>
    <div class="chart" role="img" :aria-label="`Évolution annuelle des importations et exportations, ${rows.length} années`">
      <Line :data="data" :options="options" />
    </div>
  </div>
</template>

<style scoped>
.legend { display: flex; gap: 16px; flex-wrap: wrap; font-size: 0.82rem; color: var(--text-2); margin-bottom: 8px; }
.chart { position: relative; height: 280px; }
</style>
