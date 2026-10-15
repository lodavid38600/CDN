<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api } from '../api.js';
import { ncCode } from '../format.js';

// Champ de recherche d'un code NC (code ou désignation), avec suggestions.
const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: 'Code NC ou produit (ex. 2204, choux…)' },
});
const emit = defineEmits(['update:modelValue', 'select']);
const text = ref(props.modelValue);
const results = ref([]);
const open = ref(false);
const active = ref(-1);
const root = ref(null);
const input = ref(null);
let timer;

watch(() => props.modelValue, (v) => { if (v !== text.value.replace(/\D/g, '')) text.value = v; });
watch(text, (v) => {
  clearTimeout(timer);
  const q = v.trim();
  if (/^\d[\d\s.]*$/.test(q) || !q) emit('update:modelValue', q.replace(/\D/g, ''));
  if (q.length < 2) { results.value = []; return; }
  timer = setTimeout(async () => {
    try {
      results.value = (await api('/products', { params: { q, limit: 8 } })).rows;
      // Les suggestions ne s'ouvrent que pendant la saisie (pas au remplissage depuis l'URL).
      open.value = document.activeElement === input.value;
      active.value = -1;
    } catch { results.value = []; }
  }, 200);
});

function choose(p) {
  text.value = p.code;
  emit('update:modelValue', p.code);
  emit('select', p);
  open.value = false;
}
function onKey(e) {
  if (!open.value || !results.value.length) return;
  if (e.key === 'ArrowDown') { active.value = (active.value + 1) % results.value.length; e.preventDefault(); }
  else if (e.key === 'ArrowUp') { active.value = (active.value - 1 + results.value.length) % results.value.length; e.preventDefault(); }
  else if (e.key === 'Enter' && active.value >= 0) { choose(results.value[active.value]); e.preventDefault(); }
  else if (e.key === 'Escape') open.value = false;
}
function clear() {
  text.value = '';
  emit('update:modelValue', '');
}
const onDoc = (e) => { if (root.value && !root.value.contains(e.target)) open.value = false; };
onMounted(() => document.addEventListener('click', onDoc));
onBeforeUnmount(() => document.removeEventListener('click', onDoc));
</script>

<template>
  <div ref="root" class="ncs">
    <input ref="input" v-model="text" type="search" :placeholder="placeholder" autocomplete="off" role="combobox" :aria-expanded="open" @focus="open = results.length > 0" @keydown="onKey" />
    <button v-if="text" type="button" class="x" aria-label="Effacer" @click="clear">×</button>
    <ul v-if="open && results.length" class="sug" role="listbox">
      <li v-for="(p, i) in results" :key="p.code" role="option" :aria-selected="i === active" :class="{ on: i === active }" @mousedown.prevent="choose(p)">
        <span class="nc code">{{ ncCode(p.code) }}</span>
        <span class="d">{{ p.description }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.ncs { position: relative; }
.ncs input { width: 100%; padding-right: 28px; }
.x { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); border: 0; background: none; color: var(--muted); font-size: 1.1rem; cursor: pointer; }
.sug { position: absolute; z-index: 45; top: calc(100% + 4px); left: 0; width: max(100%, 380px); list-style: none; margin: 0; padding: 4px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow-pop); }
.sug li { display: grid; grid-template-columns: 96px 1fr; gap: 8px; padding: 7px 8px; border-radius: 6px; cursor: pointer; font-size: 0.86rem; }
.sug li:hover, .sug li.on { background: var(--surface-2); }
.code { color: var(--accent); }
.d { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
