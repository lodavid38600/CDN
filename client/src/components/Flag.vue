<script setup>
import { computed } from 'vue';

// Drapeaux SVG (flag-icons) : seules les URL sont incluses, les fichiers sont chargés à la demande.
const FLAGS = import.meta.glob('/node_modules/flag-icons/flags/4x3/*.svg', { eager: true, query: '?url', import: 'default' });

const props = defineProps({ code: { type: String, required: true }, size: { type: Number, default: 16 } });
const src = computed(() => {
  const iso = props.code === 'EL' ? 'gr' : props.code === 'UK' ? 'gb' : props.code.toLowerCase();
  return FLAGS[`/node_modules/flag-icons/flags/4x3/${iso}.svg`];
});
</script>

<template>
  <img v-if="src" :src="src" :alt="code" class="flag" :style="{ height: `${size * 0.75}px`, width: `${size}px` }" loading="lazy" />
  <span v-else class="flag flag-none" :style="{ height: `${size * 0.75}px`, width: `${size}px` }">{{ code }}</span>
</template>

<style scoped>
.flag { display: inline-block; border-radius: 2px; object-fit: cover; vertical-align: -2px; box-shadow: 0 0 0 1px var(--border); flex: none; }
.flag-none { font-size: 8px; background: var(--surface-3); text-align: center; line-height: 1.4; }
</style>
