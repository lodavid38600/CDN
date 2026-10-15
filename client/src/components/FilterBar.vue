<script setup>
import { computed } from 'vue';
import MultiSelect from './MultiSelect.vue';
import { useFiltersStore } from '../stores/filters.js';
import { useMetaStore } from '../stores/meta.js';

defineProps({ hideProduct: Boolean, hideFlow: Boolean });
const filters = useFiltersStore();
const meta = useMetaStore();

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
    <label class="field">Année de début
      <select v-model.number="filters.yearFrom">
        <option :value="null">—</option>
        <option v-for="y in meta.years" :key="y" :value="y">{{ y }}</option>
      </select>
    </label>
    <label class="field">Année de fin
      <select v-model.number="filters.yearTo">
        <option :value="null">—</option>
        <option v-for="y in meta.years" :key="y" :value="y" :disabled="filters.yearFrom && y < filters.yearFrom">{{ y }}</option>
      </select>
    </label>
    <label v-if="!hideFlow" class="field">Flux
      <select v-model="filters.flow">
        <option value="">Import + export</option>
        <option value="import">Importations</option>
        <option value="export">Exportations</option>
      </select>
    </label>
    <div class="field"><span>Pays UE déclarant</span>
      <MultiSelect v-model="filters.reporters" :options="countryOpts(meta.reporters)" placeholder="Toute l'UE" />
    </div>
    <div class="field"><span>Partenaire hors UE</span>
      <MultiSelect v-model="filters.partners" :options="countryOpts(meta.partners)" placeholder="Tous les partenaires" />
    </div>
    <div class="field"><span>Section NC</span>
      <MultiSelect v-model="filters.sections" :options="sectionOpts" placeholder="Toutes" />
    </div>
    <div class="field"><span>Chapitre NC</span>
      <MultiSelect v-model="filters.chapters" :options="chapterOpts" placeholder="Tous" />
    </div>
    <label v-if="!hideProduct" class="field">Code NC (préfixe)
      <input v-model.trim="filters.product" inputmode="numeric" maxlength="10" placeholder="ex. 2204 ou 22042109" />
    </label>
    <div class="actions">
      <button type="button" class="btn btn-sm" :disabled="!filters.activeCount" @click="filters.reset()">
        Réinitialiser<span v-if="filters.activeCount"> ({{ filters.activeCount }})</span>
      </button>
    </div>
  </form>
</template>

<style scoped>
.filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px 12px; align-items: end; margin-bottom: 16px; }
.field > span { display: block; }
.actions { display: flex; align-items: end; }
</style>
