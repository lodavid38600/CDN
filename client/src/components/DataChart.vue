<script setup>
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { Chart } from 'chart.js';
import { buildConfig, readTheme } from '../lib/chart.js';

const props = defineProps({
  spec: { type: Object, required: true },
  height: { type: Number, default: 300 },
  pickable: Boolean,
});
const emit = defineEmits(['pick']);
const canvas = ref(null);
const chart = shallowRef(null);

function render() {
  if (!canvas.value) return;
  chart.value?.destroy();
  chart.value = new Chart(
    canvas.value,
    buildConfig(props.spec, readTheme(), { onPick: props.pickable ? (i) => emit('pick', i) : undefined })
  );
}
const onTheme = () => requestAnimationFrame(render);
const mq = window.matchMedia('(prefers-color-scheme: dark)');

// Taille du conteneur fixée après la création (grille, fenêtre modale…) : on recale tout le graphique
let ro;
let lastWidth = 0;
onMounted(() => {
  render();
  ro = new ResizeObserver(([entry]) => {
    const w = Math.round(entry.contentRect.width);
    if (!w || w === lastWidth) return;
    lastWidth = w;
    requestAnimationFrame(() => { chart.value?.resize(); chart.value?.update('none'); });
  });
  if (canvas.value?.parentElement) ro.observe(canvas.value.parentElement);
  window.addEventListener('themechange', onTheme);
  mq.addEventListener('change', onTheme);
});
onBeforeUnmount(() => {
  ro?.disconnect();
  chart.value?.destroy();
  window.removeEventListener('themechange', onTheme);
  mq.removeEventListener('change', onTheme);
});
watch(() => props.spec, render, { deep: true });

defineExpose({ toImage: () => chart.value?.toBase64Image() });
</script>

<template>
  <div class="dc" :style="{ height: `${height}px` }" role="img" :aria-label="spec.title || 'Graphique'">
    <canvas ref="canvas" />
  </div>
</template>

<style scoped>
.dc { position: relative; width: 100%; }
</style>
