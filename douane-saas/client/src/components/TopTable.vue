<script setup>
import { eur } from '../format.js';

defineProps({
  rows: { type: Array, default: () => [] },
  keyLabel: { type: String, default: 'Libellé' },
  linkProducts: Boolean,
  showKey: Boolean,
});
</script>

<template>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>{{ keyLabel }}</th>
          <th class="num"><span class="dot dot-import" />Import</th>
          <th class="num"><span class="dot dot-export" />Export</th>
          <th class="num">Solde</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.key">
          <td>
            <RouterLink v-if="linkProducts" :to="`/produits/${r.key}`"><span class="mono key">{{ r.key }}</span></RouterLink>
            <span v-else-if="showKey" class="mono muted key">{{ r.key }}</span>
            <span :class="{ secondary: linkProducts }">{{ r.label }}</span>
          </td>
          <td class="num">{{ eur(r.importEur) }}</td>
          <td class="num">{{ eur(r.exportEur) }}</td>
          <td class="num" :style="{ color: r.balanceEur >= 0 ? 'var(--good)' : 'var(--bad)' }">{{ r.balanceEur >= 0 ? '+' : '' }}{{ eur(r.balanceEur) }}</td>
        </tr>
        <tr v-if="!rows.length"><td colspan="4" class="empty">Aucune donnée pour ces filtres</td></tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.key { margin-right: 8px; }
</style>
