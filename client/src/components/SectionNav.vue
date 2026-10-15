<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';

// Sommaire collant de la fiche NC : toutes les données sont sur la même page,
// ce sommaire permet d'aller directement à une partie et indique où l'on se trouve.
const props = defineProps({ sections: { type: Array, required: true } });
const active = ref(props.sections[0]?.id);
let observer;

function go(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  active.value = id;
}
onMounted(() => {
  observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible[0]) active.value = visible[0].target.id;
  }, { rootMargin: '-120px 0px -60% 0px' });
  // Les sections sont rendues avec les données : observation différée
  setTimeout(() => props.sections.forEach((s) => { const el = document.getElementById(s.id); if (el) observer.observe(el); }), 300);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <nav class="secnav" aria-label="Sommaire de la fiche">
    <button v-for="s in sections" :key="s.id" :class="{ on: active === s.id }" @click="go(s.id)">{{ s.label }}</button>
  </nav>
</template>

<style scoped>
.secnav {
  position: sticky; top: 56px; z-index: 15; display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none;
  margin: 0 0 16px; padding: 8px 0; background: var(--page);
  border-bottom: 1px solid var(--border);
}
.secnav::-webkit-scrollbar { display: none; }
.secnav button {
  flex: none; border: 0; background: transparent; color: var(--text-2); font: inherit; font-size: 0.88rem; font-weight: 550;
  padding: 6px 12px; border-radius: 999px; cursor: pointer;
}
.secnav button:hover { background: var(--surface-2); color: var(--text); }
.secnav button.on { background: var(--accent-wash); color: var(--accent); }
@media print { .secnav { display: none; } }
</style>
