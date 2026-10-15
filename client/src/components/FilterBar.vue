<script setup>
import { computed } from 'vue';
import MultiSelect from './MultiSelect.vue';
import PeriodPicker from './PeriodPicker.vue';
import NcSearch from './NcSearch.vue';
import { useFiltersStore } from '../stores/filters.js';
import { useMetaStore } from '../stores/meta.js';

const props = defineProps({ hide: { type: Array, default: () => [] } });
const filters = useFiltersStore();
const meta = useMetaStore();
const show = (k) => !props.hide.includes(k);

const countryOpts = (list) => list.map((c) => ({ value: c.code, label: c.name }));
const sectionOpts = computed(() => meta.sections.map((s) => ({ value: s.code, label: s.label })));
const chapterOpts = computed(() =>
  meta.chapters
    .filter((c) => !filters.sections.length || filters.sections.includes(c.section))
    .map((c) => ({ value: c.code, label: c.label }))
);
</script>

<template>
  <form class="filters card" @submit.prevent>
    <div class="field wide"><span>Période</span>
      <PeriodPicker v-model:from="filters.periodFrom" v-model:to="filters.periodTo" />
    </div>
    <div v-if="show('flow')" class="field flowf"><span>Sens des échanges</span>
      <div class="seg flow">
        <button type="button" :class="{ on: !filters.flow }" @click="filters.flow = ''">Les deux</button>
        <button type="button" :class="{ on: filters.flow === 'export' }" @click="filters.flow = 'export'">Exportations de l'UE</button>
        <button type="button" :class="{ on: filters.flow === 'import' }" @click="filters.flow = 'import'">Importations de l'UE</button>
      </div>
    </div>
    <div v-if="show('reporters')" class="field"><span>Pays UE déclarant</span>
      <MultiSelect v-model="filters.reporters" :options="countryOpts(meta.reporters)" placeholder="Toute l'UE" flags />
    </div>
    <div v-if="show('partners')" class="field"><span>Partenaire hors UE</span>
      <MultiSelect v-model="filters.partners" :options="countryOpts(meta.partners)" placeholder="Tous les partenaires" flags />
    </div>
    <div v-if="show('sections')" class="field"><span>Section NC</span>
      <MultiSelect v-model="filters.sections" :options="sectionOpts" placeholder="Toutes" />
    </div>
    <div v-if="show('chapters')" class="field"><span>Chapitre NC02</span>
      <MultiSelect v-model="filters.chapters" :options="chapterOpts" placeholder="Tous" />
    </div>
    <div v-if="show('product')" class="field wide"><span>Produit</span>
      <NcSearch v-model="filters.product" />
    </div>
    <div class="actions">
      <button type="button" class="btn btn-sm btn-ghost" :disabled="!filters.activeCount" @click="filters.reset()">
        Réinitialiser<span v-if="filters.activeCount"> ({{ filters.activeCount }})</span>
      </button>
    </div>
  </form>
</template>

<style scoped>
.filters { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px 12px; align-items: end; margin-bottom: 16px; position: sticky; top: 64px; z-index: 15; }
.field > span { display: block; }
.wide { grid-column: span 2; }
.flowf { min-width: 190px; }
.flow { width: 100%; }
.flow button { flex: 1; padding: 4px 6px; }
.actions { display: flex; align-items: end; justify-content: flex-end; }
@media (max-width: 700px) { .wide { grid-column: span 1; } .filters { position: static; } }
</style>
