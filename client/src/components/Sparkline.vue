<script setup>
import { computed } from 'vue';

// Mini-courbe SVG (tendance), sans axes.
const props = defineProps({
  values: { type: Array, default: () => [] },
  width: { type: Number, default: 90 },
  height: { type: Number, default: 26 },
  color: { type: String, default: 'var(--accent)' },
});
const path = computed(() => {
  const v = props.values.map((x) => Number(x) || 0);
  if (v.length < 2) return '';
  const max = Math.max(...v);
  const min = Math.min(...v);
  const span = max - min || 1;
  const px = (i) => (i / (v.length - 1)) * (props.width - 4) + 2;
  const py = (x) => props.height - 3 - ((x - min) / span) * (props.height - 6);
  return v.map((x, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(x).toFixed(1)}`).join(' ');
});
const end = computed(() => {
  const v = props.values.map((x) => Number(x) || 0);
  if (v.length < 2) return null;
  const max = Math.max(...v), min = Math.min(...v), span = max - min || 1;
  return { x: props.width - 2, y: props.height - 3 - ((v.at(-1) - min) / span) * (props.height - 6) };
});
</script>

<template>
  <svg :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" class="spark" aria-hidden="true">
    <path :d="path" fill="none" :stroke="color" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
    <circle v-if="end" :cx="end.x" :cy="end.y" r="2.2" :fill="color" />
  </svg>
</template>

<style scoped>
.spark { display: block; flex: 0 1 auto; overflow: visible; max-width: 100%; height: auto; min-width: 0; }
</style>
