<script setup>
import { computed } from 'vue';
import Flag from './Flag.vue';
import { eur, tonnes, ncCode, sharePct } from '../format.js';

// Classement import / export avec drapeaux (pays) ou codes NC, parts et solde.
const props = defineProps({
  rows: { type: Array, default: () => [] },
  kind: { type: String, default: 'country' }, // country | product | hs6 | chapter | section
  keyLabel: { type: String, default: 'Libellé' },
  measure: { type: String, default: 'value' },
  flow: { type: String, default: '' },
  link: { type: Function, default: null },
  max: { type: Number, default: 0 },
});
const emit = defineEmits(['select']);
const fmt = computed(() => (props.measure === 'quantity' ? tonnes : eur));
const key = (f) => `${f}${props.measure === 'quantity' ? 'Kg' : 'Eur'}`;
const total = computed(() => props.rows.reduce((s, r) => s + (props.flow ? r[key(props.flow)] : r[key('import')] + r[key('export')]), 0));
const shown = computed(() => (props.max ? props.rows.slice(0, props.max) : props.rows));
const share = (r) => (total.value ? (props.flow ? r[key(props.flow)] : r[key('import')] + r[key('export')]) / total.value : 0);
const code = (k) => (props.kind === 'product' || props.kind === 'hs6' ? ncCode(k) : k);
</script>

<template>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>{{ keyLabel }}</th>
          <th v-if="!flow || flow === 'import'" class="num"><span class="dot dot-import" />Import</th>
          <th v-if="!flow || flow === 'export'" class="num"><span class="dot dot-export" />Export</th>
          <th v-if="!flow && measure === 'value'" class="num">Solde</th>
          <th class="num">Part</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in shown" :key="r.key" :class="{ clickable: !link }" @click="!link && emit('select', r)">
          <td class="lbl">
            <component :is="link ? 'RouterLink' : 'span'" :to="link ? link(r) : undefined" class="name">
              <Flag v-if="kind === 'country'" :code="r.key" />
              <span v-else class="nc code">{{ code(r.key) }}</span>
              <span class="text">{{ r.label }}</span>
            </component>
          </td>
          <td v-if="!flow || flow === 'import'" class="num">{{ fmt(r[key('import')]) }}</td>
          <td v-if="!flow || flow === 'export'" class="num">{{ fmt(r[key('export')]) }}</td>
          <td v-if="!flow && measure === 'value'" class="num" :class="r.balanceEur >= 0 ? 'up' : 'down'">{{ r.balanceEur >= 0 ? '+' : '' }}{{ eur(r.balanceEur) }}</td>
          <td class="num share">
            {{ sharePct(share(r)) }}
            <div class="share-bar"><span :style="{ width: `${Math.min(100, share(r) * 100)}%` }" /></div>
          </td>
        </tr>
        <tr v-if="!rows.length"><td colspan="5" class="empty">Aucune donnée pour cette sélection</td></tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.lbl { max-width: 240px; }
.name { display: flex; gap: 8px; align-items: center; color: var(--text); min-width: 0; }
a.name:hover .text { text-decoration: underline; }
.text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.code { color: var(--accent); flex: none; }
.share { width: 80px; }
tr.clickable { cursor: pointer; }
</style>
