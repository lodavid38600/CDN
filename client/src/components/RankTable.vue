<script setup>
import { computed, ref } from 'vue';
import Flag from './Flag.vue';
import { eur, tonnes, perKg, ncCode, sharePct } from '../format.js';

// Classement avec drapeaux (pays) ou codes NC : valeur, volume et prix moyen côte à côte,
// tri par colonne, part calculée sur la mesure choisie (valeur ou volume).
const props = defineProps({
  rows: { type: Array, default: () => [] },
  kind: { type: String, default: 'country' }, // country | product | hs6 | chapter | section
  keyLabel: { type: String, default: 'Libellé' },
  measure: { type: String, default: 'value' },
  flow: { type: String, default: '' },
  link: { type: Function, default: null },
  max: { type: Number, default: 0 },
  badges: { type: Object, default: () => ({}) }, // { key: 'texte' } (ex. source des données)
  selected: { type: String, default: '' }, // ligne mise en évidence (fiche ouverte)
});
const emit = defineEmits(['select']);
const sortBy = ref(null);
const sortDir = ref(-1);

const flows = computed(() => (props.flow ? [props.flow] : ['import', 'export']));
const shareBase = computed(() => (props.measure === 'value' ? 'Eur' : 'Kg'));
const amount = (r, f) => r[`${f}${shareBase.value}`] || 0;
const totalAmount = (r) => flows.value.reduce((s, f) => s + amount(r, f), 0);
const total = computed(() => props.rows.reduce((s, r) => s + totalAmount(r), 0));
const share = (r) => (total.value ? totalAmount(r) / total.value : 0);

const COLS = computed(() => {
  const cols = [];
  for (const f of flows.value) {
    const w = f === 'import' ? 'Import' : 'Export';
    cols.push({ id: `${f}Eur`, label: props.flow ? 'Valeur' : `${w} €`, fmt: eur, dot: props.flow ? null : f });
    cols.push({ id: `${f}Kg`, label: props.flow ? 'Volume' : `${w} vol.`, fmt: tonnes });
    cols.push({ id: `${f}Price`, label: props.flow ? 'Prix moyen' : `Prix ${w.toLowerCase()}`, fmt: perKg });
  }
  if (!props.flow) cols.push({ id: 'balanceEur', label: 'Solde', fmt: (v) => `${v >= 0 ? '+' : ''}${eur(v)}`, tone: true });
  return cols;
});
// Colonnes mises en avant selon la mesure ; les autres restent visibles mais discrètes.
const emphasis = (id) => (props.measure === 'value' && id.endsWith('Eur')) || (props.measure === 'quantity' && id.endsWith('Kg')) || (props.measure === 'price' && id.endsWith('Price'));

const sorted = computed(() => {
  let list = [...props.rows];
  if (sortBy.value) list.sort((a, b) => ((a[sortBy.value] ?? -Infinity) - (b[sortBy.value] ?? -Infinity)) * sortDir.value);
  return props.max ? list.slice(0, props.max) : list;
});
function sort(id) {
  if (sortBy.value === id) sortDir.value = -sortDir.value;
  else {
    sortBy.value = id;
    sortDir.value = id.endsWith('Price') ? 1 : -1;
  }
}
const code = (k) => (props.kind === 'product' || props.kind === 'hs6' ? ncCode(k) : k);
</script>

<template>
  <div class="table-wrap">
    <table class="rank">
      <thead>
        <tr>
          <th>{{ keyLabel }}</th>
          <th v-for="c in COLS" :key="c.id" class="num sortable" :class="{ em: emphasis(c.id) }" :aria-sort="sortBy === c.id ? (sortDir > 0 ? 'ascending' : 'descending') : undefined" @click="sort(c.id)">
            <span v-if="c.dot" class="dot" :class="`dot-${c.dot}`" />{{ c.label }}{{ sortBy === c.id ? (sortDir > 0 ? ' ↑' : ' ↓') : '' }}
          </th>
          <th class="num">Part {{ measure === 'value' ? '€' : 'vol.' }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in sorted" :key="r.key" :class="{ clickable: !link, sel: selected === r.key }" @click="!link && emit('select', r)">
          <td class="lbl">
            <component :is="link ? 'RouterLink' : 'span'" :to="link ? link(r) : undefined" class="name">
              <Flag v-if="kind === 'country'" :code="r.key" />
              <span v-else class="nc code">{{ code(r.key) }}</span>
              <span class="text">{{ r.label }}</span>
              <span v-if="badges[r.key]" class="badge">{{ badges[r.key] }}</span>
            </component>
          </td>
          <td v-for="c in COLS" :key="c.id" class="num" :class="{ em: emphasis(c.id), up: c.tone && r[c.id] >= 0, down: c.tone && r[c.id] < 0 }">
            {{ r[c.id] === null || r[c.id] === undefined ? '—' : c.fmt(r[c.id]) }}
          </td>
          <td class="num share">
            {{ sharePct(share(r)) }}
            <div class="share-bar"><span :style="{ width: `${Math.min(100, share(r) * 100)}%` }" /></div>
          </td>
        </tr>
        <tr v-if="!rows.length"><td :colspan="COLS.length + 2" class="empty">Aucune donnée pour cette sélection</td></tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.lbl { max-width: 260px; }
.name { display: flex; gap: 8px; align-items: center; color: var(--text); min-width: 0; }
a.name:hover .text { text-decoration: underline; }
.text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.code { color: var(--accent); flex: none; }
.share { width: 80px; }
td.num { color: var(--muted); }
td.num.em { color: var(--text); font-weight: 600; }
td.num.up.em, td.num.up { color: var(--good); }
td.num.down.em, td.num.down { color: var(--bad); }
th.em { color: var(--text); }
tr.clickable { cursor: pointer; }
.badge { font-size: 0.66rem; padding: 0 6px; }
tr.sel td { background: var(--accent-wash); }
</style>
