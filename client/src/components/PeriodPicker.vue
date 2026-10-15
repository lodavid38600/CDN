<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { MONTHS, rangeLabel } from '../format.js';
import { useMetaStore } from '../stores/meta.js';

// Sélecteur de période au mois près : préréglages en liste + plage personnalisée.
const props = defineProps({ from: { type: String, default: '' }, to: { type: String, default: '' } });
const emit = defineEmits(['update:from', 'update:to']);
const meta = useMetaStore();
const open = ref(false);
const root = ref(null);

const last = computed(() => meta.lastPeriod || `${new Date().getFullYear()}-12`);
const shift = (p, n) => {
  const [y, m] = p.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
};
const lastY = computed(() => Number(last.value.slice(0, 4)));
const fullYears = computed(() => meta.years.filter((y) => y < lastY.value || last.value.endsWith('-12')).slice(-6).reverse());

const presets = computed(() => [
  { label: 'Toute la période', from: '', to: '' },
  { label: '12 derniers mois', from: shift(last.value, -11), to: last.value },
  { label: `Depuis janvier ${lastY.value}`, from: `${lastY.value}-01`, to: last.value },
  { label: '3 dernières années', from: shift(last.value, -35), to: last.value },
  ...fullYears.value.map((y) => ({ label: `Année ${y}`, from: `${y}-01`, to: `${y}-12` })),
]);
const isSel = (p) => p.from === (props.from || '') && p.to === (props.to || '');

const custom = ref({ fy: null, fm: 1, ty: null, tm: 12 });
watch(open, (o) => {
  if (!o) return;
  const [fy, fm] = (props.from || meta.firstPeriod || '2015-01').split('-').map(Number);
  const [ty, tm] = (props.to || last.value).split('-').map(Number);
  custom.value = { fy, fm, ty, tm };
});
const customValid = computed(() => custom.value.fy * 100 + custom.value.fm <= custom.value.ty * 100 + custom.value.tm);

function apply(from, to) {
  emit('update:from', from);
  emit('update:to', to);
  open.value = false;
}
function applyCustom() {
  const c = custom.value;
  apply(`${c.fy}-${String(c.fm).padStart(2, '0')}`, `${c.ty}-${String(c.tm).padStart(2, '0')}`);
}
const label = computed(() => presets.value.find(isSel)?.label || rangeLabel(props.from, props.to));
const onDoc = (e) => { if (root.value && !root.value.contains(e.target)) open.value = false; };
onMounted(() => document.addEventListener('click', onDoc));
onBeforeUnmount(() => document.removeEventListener('click', onDoc));
</script>

<template>
  <div ref="root" class="pp">
    <button type="button" class="pp-btn" :class="{ set: from || to }" :aria-expanded="open" @click="open = !open">
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2zm-2 8h14v9H5z" /></svg>
      <span class="lbl">{{ label }}</span><span aria-hidden="true">▾</span>
    </button>
    <div v-if="open" class="pp-pop" role="dialog" aria-label="Choisir une période">
      <button v-for="p in presets" :key="p.label" type="button" class="preset" :class="{ on: isSel(p) }" @click="apply(p.from, p.to)">
        <span class="check">{{ isSel(p) ? '✓' : '' }}</span>{{ p.label }}
      </button>
      <div class="custom">
        <div class="hint">Période personnalisée (au mois près)</div>
        <div class="crow">
          <span>Du</span>
          <select v-model.number="custom.fm" aria-label="Mois de début"><option v-for="(m, i) in MONTHS" :key="m" :value="i + 1">{{ m }}</option></select>
          <select v-model.number="custom.fy" aria-label="Année de début"><option v-for="y in meta.years" :key="y" :value="y">{{ y }}</option></select>
        </div>
        <div class="crow">
          <span>au</span>
          <select v-model.number="custom.tm" aria-label="Mois de fin"><option v-for="(m, i) in MONTHS" :key="m" :value="i + 1">{{ m }}</option></select>
          <select v-model.number="custom.ty" aria-label="Année de fin"><option v-for="y in meta.years" :key="y" :value="y">{{ y }}</option></select>
        </div>
        <button type="button" class="btn btn-primary btn-sm" :disabled="!customValid" @click="applyCustom">Appliquer</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pp { position: relative; }
.pp-btn {
  width: 100%; display: flex; gap: 8px; align-items: center; font: inherit; font-size: 0.9rem; color: var(--text);
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; cursor: pointer; text-align: left;
}
.pp-btn.set { border-color: var(--accent); }
.lbl { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pp-pop {
  position: absolute; z-index: 45; top: calc(100% + 4px); left: 0; width: 300px; background: var(--surface);
  border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow-pop); padding: 6px;
}
.preset { display: flex; gap: 8px; width: 100%; border: 0; background: none; color: var(--text); font: inherit; font-size: 0.88rem; padding: 7px 8px; border-radius: 6px; cursor: pointer; text-align: left; }
.preset:hover { background: var(--surface-2); }
.preset.on { font-weight: 600; }
.check { width: 16px; font-weight: 800; color: var(--accent); }
.custom { border-top: 1px solid var(--grid); margin-top: 6px; padding: 10px 8px 6px; display: grid; gap: 8px; }
.crow { display: grid; grid-template-columns: 22px 1fr 84px; gap: 6px; align-items: center; font-size: 0.85rem; color: var(--text-2); }
</style>
