<script setup>
import { computed, ref, watch } from 'vue';
import { api } from '../api.js';
import { eur, tonnes, ncCode, perKg } from '../format.js';
import { useMetaStore } from '../stores/meta.js';
import MultiSelect from '../components/MultiSelect.vue';
import KpiCard from '../components/KpiCard.vue';
import TopTable from '../components/TopTable.vue';
import TrendChart from '../components/charts/TrendChart.vue';
import BarCompare from '../components/charts/BarCompare.vue';

const props = defineProps({ code: { type: String, required: true } });
const meta = useMetaStore();

const product = ref(null);
const summary = ref(null);
const series = ref([]);
const partners = ref([]);
const reporters = ref([]);
const error = ref('');
const loading = ref(false);
const metric = ref('Eur');
const local = ref({ yearFrom: null, yearTo: null, reporters: [], partners: [] });

const params = computed(() => ({ ...local.value, product: props.code }));
const fmt = computed(() => (metric.value === 'Kg' ? tonnes : eur));
const unitPrice = computed(() => {
  const s = summary.value;
  if (!s) return null;
  const v = (n, q) => (q ? n / q : null);
  return { import: v(s.importEur, s.importKg), export: v(s.exportEur, s.exportKg) };
});
const countryOpts = (list) => list.map((c) => ({ value: c.code, label: c.name }));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    await meta.load();
    const p = params.value;
    const top = (dimension) => api('/stats/top', { params: { ...p, dimension, limit: 12 } });
    [product.value, summary.value, series.value, partners.value, reporters.value] = await Promise.all([
      api(`/products/${props.code}`),
      api('/stats/summary', { params: p }),
      api('/stats/timeseries', { params: p }),
      top('partner'),
      top('reporter'),
    ]);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
watch(() => props.code, () => { local.value = { yearFrom: null, yearTo: null, reporters: [], partners: [] }; });
watch(() => JSON.stringify(params.value), load, { immediate: true });
</script>

<template>
  <div :class="{ loading }">
    <p class="crumbs"><RouterLink to="/categories">Catégories</RouterLink>
      <template v-if="product"> › Section {{ product.section }} › Chapitre {{ product.chapter }} — {{ product.chapterLabel }}</template>
    </p>
    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="product">
      <div class="page-head">
        <div>
          <h1><span class="mono code">{{ ncCode(product.code) }}</span> {{ product.description }}</h1>
          <p>Section {{ product.section }} · {{ product.sectionLabel }} · Position {{ product.heading }}</p>
        </div>
        <div class="seg">
          <button class="btn btn-sm" :class="{ 'btn-primary': metric === 'Eur' }" @click="metric = 'Eur'">Valeur (€)</button>
          <button class="btn btn-sm" :class="{ 'btn-primary': metric === 'Kg' }" @click="metric = 'Kg'">Quantité (t)</button>
          <RouterLink class="btn btn-sm" :to="{ path: '/explorer', query: { product: product.code } }">Données détaillées →</RouterLink>
        </div>
      </div>

      <div class="card filters">
        <label class="field">Année de début
          <select v-model.number="local.yearFrom"><option :value="null">—</option><option v-for="y in product.years" :key="y" :value="y">{{ y }}</option></select>
        </label>
        <label class="field">Année de fin
          <select v-model.number="local.yearTo"><option :value="null">—</option><option v-for="y in product.years" :key="y" :value="y">{{ y }}</option></select>
        </label>
        <div class="field"><span>Pays UE déclarant</span><MultiSelect v-model="local.reporters" :options="countryOpts(meta.reporters)" placeholder="Toute l'UE" /></div>
        <div class="field"><span>Partenaire hors UE</span><MultiSelect v-model="local.partners" :options="countryOpts(meta.partners)" placeholder="Tous" /></div>
      </div>

      <div v-if="summary" class="kpis">
        <KpiCard dot="import" label="Importations" :value="fmt(summary[`import${metric}`])" :change="summary.changeImport" :change-label="summary.latestYear ? `${summary.latestYear} vs ${summary.latestYear - 1}` : ''" />
        <KpiCard dot="export" label="Exportations" :value="fmt(summary[`export${metric}`])" :change="summary.changeExport" :change-label="summary.latestYear ? `${summary.latestYear} vs ${summary.latestYear - 1}` : ''" />
        <KpiCard label="Solde commercial" :value="`${summary.balanceEur >= 0 ? '+' : ''}${eur(summary.balanceEur)}`" :sub="summary.balanceEur >= 0 ? 'Excédent' : 'Déficit'" />
        <KpiCard label="Prix moyen import" :value="perKg(unitPrice?.import)" sub="Valeur / quantité" />
        <KpiCard label="Prix moyen export" :value="perKg(unitPrice?.export)" sub="Valeur / quantité" />
      </div>

      <section class="card" style="margin-bottom: 16px">
        <div class="card-head"><div><h2>Évolution annuelle</h2><p>{{ ncCode(product.code) }} · échanges UE ↔ hors UE</p></div></div>
        <TrendChart :rows="series" :metric="metric" />
      </section>

      <div class="grid grid-2">
        <section class="card">
          <div class="card-head"><div><h2>Partenaires hors UE</h2><p>Cliquer pour filtrer</p></div></div>
          <BarCompare :rows="partners" :metric="metric" @select="(r) => (local.partners = [r.key])" />
        </section>
        <section class="card">
          <div class="card-head"><div><h2>Pays UE déclarants</h2><p>Cliquer pour filtrer</p></div></div>
          <BarCompare :rows="reporters" :metric="metric" @select="(r) => (local.reporters = [r.key])" />
        </section>
        <section class="card">
          <div class="card-head"><h2>Détail par partenaire</h2></div>
          <TopTable :rows="partners" key-label="Partenaire" show-key />
        </section>
        <section class="card">
          <div class="card-head"><h2>Détail par pays déclarant</h2></div>
          <TopTable :rows="reporters" key-label="Pays UE" show-key />
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.crumbs { font-size: 0.85rem; color: var(--muted); margin: 0 0 10px; }
.code { color: var(--accent); margin-right: 6px; }
.seg { display: flex; gap: 4px; flex-wrap: wrap; }
.filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px 12px; margin-bottom: 16px; }
</style>
