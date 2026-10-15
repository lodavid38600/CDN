<script setup>
import { ref, watch } from 'vue';
import { api } from '../api.js';
import { eurFull, kg, ncCode, rangeLabel } from '../format.js';
import Flag from '../components/Flag.vue';
import Sparkline from '../components/Sparkline.vue';
import { useFilterSync } from '../useFilterSync.js';
import { useAuthStore } from '../stores/auth.js';
import FilterBar from '../components/FilterBar.vue';

const auth = useAuthStore();
const result = ref({ rows: [], total: 0, page: 1, pages: 0 });
const page = ref(1);
const limit = ref(50);
const sort = ref('valueEur');
const order = ref('desc');
const exporting = ref(false);

const { filters, loading, error, reload } = useFilterSync(async (params) => {
  result.value = await api('/trade', { params: { ...params, page: page.value, limit: limit.value, sort: sort.value, order: order.value } });
});

// Tout changement de filtre ramène à la première page.
watch(() => JSON.stringify(filters.params), () => { page.value = 1; });

function setSort(field) {
  if (sort.value === field) order.value = order.value === 'desc' ? 'asc' : 'desc';
  else { sort.value = field; order.value = field === 'valueEur' || field === 'quantityKg' || field === 'year' ? 'desc' : 'asc'; }
  page.value = 1;
  reload();
}
function go(p) {
  page.value = p;
  reload();
}
function arrow(field) {
  return sort.value === field ? (order.value === 'desc' ? ' ↓' : ' ↑') : '';
}

async function exportCsv() {
  exporting.value = true;
  try {
    const res = await api('/trade/export.csv', { params: { ...filters.params, sort: sort.value, order: order.value }, raw: true });
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: 'donnees-douanieres.csv' });
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    error.value = e.message;
  } finally {
    exporting.value = false;
  }
}

const cols = [
  { key: 'year', label: 'Année' },
  { key: null, label: 'Flux' },
  { key: 'reporter', label: 'Déclarant UE' },
  { key: 'partner', label: 'Partenaire' },
  { key: 'product', label: 'Code NC' },
  { key: null, label: 'Désignation' },
  { key: 'valueEur', label: 'Valeur', num: true },
  { key: 'quantityKg', label: 'Quantité', num: true },
  { key: null, label: 'Profil mensuel' },
];
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Explorateur de données</h1>
        <p>{{ new Intl.NumberFormat('fr-FR').format(result.total) }} lignes · une ligne = déclarant × partenaire × code NC × année × flux<span v-if="filters.periodFrom || filters.periodTo"> · valeurs limitées aux mois de la période ({{ rangeLabel(filters.periodFrom, filters.periodTo) }})</span></p>
      </div>
      <button class="btn btn-primary" :disabled="exporting || !result.total" @click="exportCsv">
        {{ exporting ? 'Export…' : 'Exporter en CSV' }}
      </button>
    </div>
    <p v-if="auth.user && auth.user.plan === 'free'" class="muted" style="margin-top: -8px">Offre gratuite : export limité à 1 000 lignes.</p>

    <FilterBar />
    <p v-if="error" class="error">{{ error }}</p>

    <section class="card" :class="{ loading }">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th v-for="c in cols" :key="c.label" :class="{ sortable: c.key, num: c.num }" :aria-sort="sort === c.key ? (order === 'asc' ? 'ascending' : 'descending') : undefined" @click="c.key && setSort(c.key)">
                {{ c.label }}{{ c.key ? arrow(c.key) : '' }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in result.rows" :key="`${r.reporter}${r.partner}${r.product}${r.year}${r.flow}`">
              <td>{{ r.year }}</td>
              <td><span class="dot" :class="`dot-${r.flow}`" />{{ r.flow === 'import' ? 'Import' : 'Export' }}</td>
              <td :title="r.reporterName"><Flag :code="r.reporter" /> {{ r.reporterName }}</td>
              <td :title="r.partnerName"><Flag :code="r.partner" /> {{ r.partnerName }}</td>
              <td><RouterLink class="nc" :to="`/produits/${r.product}`">{{ ncCode(r.product) }}</RouterLink></td>
              <td class="desc secondary" :title="r.description">{{ r.description }}</td>
              <td class="num">{{ eurFull(r.valueEur) }}</td>
              <td class="num">{{ kg(r.quantityKg) }}</td>
              <td><Sparkline v-if="r.monthly" :values="r.monthly" :width="80" :height="20" :color="`var(--${r.flow})`" /></td>
            </tr>
            <tr v-if="!result.rows.length && !loading"><td :colspan="cols.length" class="empty">Aucune donnée pour ces filtres</td></tr>
          </tbody>
        </table>
      </div>
      <div class="pager">
        <label class="muted">Lignes par page
          <select v-model.number="limit" @change="go(1)"><option v-for="n in [25, 50, 100, 200]" :key="n" :value="n">{{ n }}</option></select>
        </label>
        <div class="pager-btns">
          <button class="btn btn-sm" :disabled="page <= 1" @click="go(1)">«</button>
          <button class="btn btn-sm" :disabled="page <= 1" @click="go(page - 1)">‹ Préc.</button>
          <span>Page {{ result.page }} / {{ result.pages || 1 }}</span>
          <button class="btn btn-sm" :disabled="page >= result.pages" @click="go(page + 1)">Suiv. ›</button>
          <button class="btn btn-sm" :disabled="page >= result.pages" @click="go(result.pages)">»</button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.desc { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
td { white-space: nowrap; }
.pager { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 12px; font-size: 0.85rem; }
.pager label { display: flex; gap: 8px; align-items: center; }
.pager-btns { display: flex; gap: 6px; align-items: center; }
</style>
