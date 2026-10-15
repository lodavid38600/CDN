<script setup>
import { percent } from '../format.js';
import Sparkline from './Sparkline.vue';

defineProps({
  label: String,
  value: String,
  sub: String,
  extra: { type: Array, default: () => [] }, // mesures complémentaires (ex. volume, prix)
  change: { type: Number, default: null },
  changeLabel: String,
  dot: String, // 'import' | 'export'
  spark: { type: Array, default: null },
  sparkColor: { type: String, default: 'var(--accent)' },
});
</script>

<template>
  <div class="card kpi">
    <div class="kpi-label"><span v-if="dot" class="dot" :class="`dot-${dot}`" />{{ label }}</div>
    <div class="kpi-main">
      <div class="kpi-value">{{ value }}</div>
      <Sparkline v-if="spark && spark.length > 2" :values="spark" :color="sparkColor" :width="72" :height="28" />
    </div>
    <div v-if="extra.length" class="kpi-extra">{{ extra.filter(Boolean).join(' · ') }}</div>
    <div v-if="change !== null && change !== undefined && Number.isFinite(change)" class="kpi-change" :class="change >= 0 ? 'up' : 'down'">
      <span aria-hidden="true">{{ change >= 0 ? '▲' : '▼' }}</span> {{ percent(change) }}
      <span class="muted">{{ changeLabel }}</span>
    </div>
    <div v-else-if="sub" class="kpi-sub muted">{{ sub }}</div>
  </div>
</template>

<style scoped>
.kpi { padding: 14px 16px; }
.kpi-label { font-size: 0.78rem; color: var(--text-2); font-weight: 500; }
.kpi-main { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; min-width: 0; }
.kpi-value { font-size: 1.6rem; font-weight: 650; margin-top: 2px; letter-spacing: -0.01em; white-space: nowrap; }
.kpi-extra { font-size: 0.82rem; color: var(--text-2); font-variant-numeric: tabular-nums; margin-top: 1px; }
.kpi-change, .kpi-sub { font-size: 0.78rem; margin-top: 2px; }
</style>
