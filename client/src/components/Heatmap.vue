<script setup>
import { computed } from 'vue';
import Flag from './Flag.vue';
import { eur } from '../format.js';

// Matrice déclarants × partenaires, couleur séquentielle (valeurs aussi lisibles au survol et en texte).
const props = defineProps({ data: { type: Object, default: null } });
const max = computed(() => Math.max(1, ...(props.data?.values.flat() || [1])));
const step = (v) => (v <= 0 ? 0 : Math.min(7, 1 + Math.floor((Math.sqrt(v / max.value)) * 6.99)));
</script>

<template>
  <div v-if="data && data.rows.length" class="table-wrap">
    <table class="hm">
      <thead>
        <tr>
          <th />
          <th v-for="c in data.cols" :key="c.key" class="col" :title="c.label"><Flag :code="c.key" /><span>{{ c.key }}</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(r, i) in data.rows" :key="r.key">
          <th class="rowh"><Flag :code="r.key" /> {{ r.label }}</th>
          <td v-for="(c, j) in data.cols" :key="c.key" :class="`q q${step(data.values[i][j])}`" :title="`${r.label} → ${c.label} : ${eur(data.values[i][j])}`">
            {{ data.values[i][j] ? eur(data.values[i][j]).replace(' €', '') : '·' }}
          </td>
        </tr>
      </tbody>
    </table>
    <p class="hint" style="margin-top: 6px">Valeurs en euros. Teinte proportionnelle à l'intensité des échanges.</p>
  </div>
  <div v-else class="empty">Aucune donnée</div>
</template>

<style scoped>
.hm { font-size: 0.78rem; border-collapse: separate; border-spacing: 2px; }
.hm th, .hm td { border: 0; padding: 6px 6px; }
.col { text-align: center; font-weight: 600; }
.col span { display: block; margin-top: 2px; text-transform: none; }
.rowh { text-align: left; white-space: nowrap; text-transform: none; font-size: 0.8rem; color: var(--text); font-weight: 500; letter-spacing: 0; }
.q { text-align: center; border-radius: 4px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.q0 { background: var(--surface-2); color: var(--muted); }
.q1 { background: var(--q1); color: #0b0b0b; } .q2 { background: var(--q2); color: #0b0b0b; } .q3 { background: var(--q3); color: #0b0b0b; }
.q4 { background: var(--q4); color: #fff; } .q5 { background: var(--q5); color: #fff; } .q6 { background: var(--q6); color: #fff; } .q7 { background: var(--q7); color: #fff; }
:root[data-theme='dark'] .q1, :root[data-theme='dark'] .q2, :root[data-theme='dark'] .q3 { color: #fff; }
:root[data-theme='dark'] .q5, :root[data-theme='dark'] .q6, :root[data-theme='dark'] .q7 { color: #0b0b0b; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .q1, :root:not([data-theme='light']) .q2, :root:not([data-theme='light']) .q3 { color: #fff; }
  :root:not([data-theme='light']) .q5, :root:not([data-theme='light']) .q6, :root:not([data-theme='light']) .q7 { color: #0b0b0b; }
}
.hm tbody tr:hover { background: none; }
</style>
