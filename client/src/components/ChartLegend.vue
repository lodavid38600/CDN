<script setup>
defineProps({ series: { type: Array, default: () => [] }, kind: { type: String, default: 'line' } });
// Variables CSS : la légende suit le thème sans recalcul.
const cssColor = (c) => (c === 'import' ? 'var(--s1)' : c === 'export' ? 'var(--s2)' : `var(--s${((Number(c) || 1) - 1) % 8 + 1})`);
</script>

<template>
  <div class="legend" aria-hidden="true">
    <span v-for="s in series" :key="s.name">
      <span v-if="kind === 'line'" class="line" :style="{ borderColor: cssColor(s.color), borderTopStyle: s.dashed ? 'dashed' : 'solid' }" />
      <span v-else class="dot" :style="{ background: cssColor(s.color), opacity: s.dashed ? 0.5 : 1 }" />{{ s.name }}
    </span>
  </div>
</template>
