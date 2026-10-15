<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import Flag from './Flag.vue';

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  options: { type: Array, default: () => [] }, // [{ value, label, group? }]
  placeholder: { type: String, default: 'Tous' },
  flags: Boolean,
});
const emit = defineEmits(['update:modelValue']);

const open = ref(false);
const search = ref('');
const root = ref(null);

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return q ? props.options.filter((o) => `${o.value} ${o.label}`.toLowerCase().includes(q)) : props.options;
});
const summary = computed(() => {
  const n = props.modelValue.length;
  if (!n) return props.placeholder;
  if (n <= 2) return props.modelValue.map((v) => props.options.find((o) => o.value === v)?.label || v).join(', ');
  return `${n} sélectionnés`;
});

function toggle(value) {
  const set = new Set(props.modelValue);
  set.has(value) ? set.delete(value) : set.add(value);
  emit('update:modelValue', [...set]);
}
function onDoc(e) {
  if (root.value && !root.value.contains(e.target)) open.value = false;
}
onMounted(() => document.addEventListener('click', onDoc));
onBeforeUnmount(() => document.removeEventListener('click', onDoc));
</script>

<template>
  <div ref="root" class="ms">
    <button type="button" class="ms-btn" :class="{ set: modelValue.length }" :aria-expanded="open" @click="open = !open">
      <span class="ms-summary"><template v-if="flags && modelValue.length && modelValue.length <= 3"><Flag v-for="v in modelValue" :key="v" :code="v" class="mf" /></template>{{ summary }}</span><span aria-hidden="true">▾</span>
    </button>
    <div v-if="open" class="ms-pop" @keydown.esc="open = false">
      <input v-model="search" type="search" placeholder="Rechercher…" aria-label="Rechercher" />
      <div class="ms-list" role="listbox" aria-multiselectable="true">
        <label v-for="o in filtered" :key="o.value" class="ms-item">
          <input type="checkbox" :checked="modelValue.includes(o.value)" @change="toggle(o.value)" />
          <Flag v-if="flags" :code="o.value" />
          <span v-else class="mono muted">{{ o.value }}</span>
          <span>{{ o.label }}</span>
        </label>
        <div v-if="!filtered.length" class="muted ms-none">Aucun résultat</div>
      </div>
      <div class="ms-foot">
        <button type="button" class="btn btn-sm" @click="emit('update:modelValue', [])">Effacer</button>
        <button type="button" class="btn btn-sm btn-primary" @click="open = false">OK</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ms { position: relative; }
.ms-btn {
  width: 100%; display: flex; justify-content: space-between; gap: 8px; align-items: center;
  font: inherit; font-size: 0.9rem; color: var(--text); background: var(--surface);
  border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; cursor: pointer; text-align: left;
}
.ms-btn.set { border-color: var(--accent); }
.ms-summary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mf { margin-right: 4px; }
.ms-pop {
  position: absolute; z-index: 40; top: calc(100% + 4px); left: 0; width: max(100%, 280px);
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15); padding: 8px; display: flex; flex-direction: column; gap: 6px;
}
.ms-list { max-height: 260px; overflow-y: auto; }
.ms-item { display: grid; grid-template-columns: auto 30px 1fr; gap: 6px; align-items: center; padding: 5px 6px; border-radius: 6px; font-size: 0.88rem; cursor: pointer; }
.ms-item:hover { background: var(--surface-2); }
.ms-none { padding: 8px; font-size: 0.85rem; }
.ms-foot { display: flex; justify-content: space-between; }
</style>
