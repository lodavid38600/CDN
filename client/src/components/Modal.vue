<script setup>
// Fenêtre modale générique (Échap ou clic à l'extérieur pour fermer).
import { onBeforeUnmount, onMounted } from 'vue';

defineProps({ title: { type: String, required: true }, wide: Boolean });
const emit = defineEmits(['close']);
const onKey = (e) => { if (e.key === 'Escape') emit('close'); };
onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="modal" :class="{ wide }" role="dialog" aria-modal="true" :aria-label="title">
      <div class="m-head">
        <h2>{{ title }}</h2>
        <button class="btn btn-sm btn-ghost" aria-label="Fermer" @click="emit('close')">✕</button>
      </div>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.m-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.modal.wide { width: min(760px, calc(100vw - 32px)); }
</style>
