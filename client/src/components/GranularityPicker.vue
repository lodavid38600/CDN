<script setup>
import { computed } from 'vue';
import { granularities } from '../lib/granularity.js';
import { useMetaStore } from '../stores/meta.js';

// Mois / trimestre / année : seules les granularités pertinentes pour la période sont actives.
const props = defineProps({
  modelValue: { type: String, default: 'month' },
  from: { type: String, default: '' },
  to: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue']);
const meta = useMetaStore();
const opts = computed(() => granularities(props.from, props.to, meta).opts);
</script>

<template>
  <div class="seg" role="group" aria-label="Pas de temps">
    <button
      v-for="o in opts" :key="o.id" type="button" :class="{ on: modelValue === o.id }" :disabled="!o.enabled"
      :title="o.enabled ? `${o.count} ${o.id === 'month' ? 'mois' : o.id === 'quarter' ? 'trimestres' : 'années'}` : o.reason"
      @click="emit('update:modelValue', o.id)"
    >{{ o.label }}</button>
  </div>
</template>

<style scoped>
.seg button:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
