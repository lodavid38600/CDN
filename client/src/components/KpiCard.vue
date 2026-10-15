<script setup>
defineProps({
  label: String,
  value: String,
  sub: String,
  change: { type: Number, default: null },
  changeLabel: String,
  dot: String, // 'import' | 'export'
});
</script>

<template>
  <div class="card kpi">
    <div class="kpi-label"><span v-if="dot" class="dot" :class="`dot-${dot}`" />{{ label }}</div>
    <div class="kpi-value">{{ value }}</div>
    <div v-if="change !== null && change !== undefined && Number.isFinite(change)" class="kpi-change" :class="change >= 0 ? 'up' : 'down'">
      <span aria-hidden="true">{{ change >= 0 ? '▲' : '▼' }}</span>
      {{ new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(change) }}
      <span class="muted">{{ changeLabel }}</span>
    </div>
    <div v-else-if="sub" class="kpi-sub muted">{{ sub }}</div>
  </div>
</template>

<style scoped>
.kpi { padding: 14px 16px; }
.kpi-label { font-size: 0.8rem; color: var(--text-2); font-weight: 500; }
.kpi-value { font-size: 1.7rem; font-weight: 650; margin-top: 2px; letter-spacing: -0.01em; }
.kpi-change, .kpi-sub { font-size: 0.8rem; margin-top: 2px; }
.kpi-change.up { color: var(--good); }
.kpi-change.down { color: var(--bad); }
</style>
