<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';

// Roue de chargement avec un texte ; au-delà de quelques secondes, un message rassurant.
defineProps({ text: { type: String, default: 'Chargement…' }, inline: { type: Boolean, default: false } });
const slow = ref(false);
let t;
onMounted(() => { t = setTimeout(() => { slow.value = true; }, 4000); });
onBeforeUnmount(() => clearTimeout(t));
</script>

<template>
  <div class="loader" :class="{ inline }" role="status" aria-live="polite">
    <span class="spinner" aria-hidden="true" />
    <span>{{ text }}</span>
    <span v-if="slow && !inline" class="slow">Beaucoup de données à parcourir, encore un instant…</span>
  </div>
</template>

<style scoped>
.loader { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 40px 16px; color: var(--text-2); font-size: 0.9rem; text-align: center; }
.loader.inline { flex-direction: row; padding: 0; gap: 8px; display: inline-flex; }
.loader.inline .spinner { width: 16px; height: 16px; border-width: 2px; }
.slow { font-size: 0.8rem; color: var(--muted); }
</style>
