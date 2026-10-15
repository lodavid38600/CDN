<script setup>
// Valeur (€), volume (tonnes, unité adaptée) ou prix moyen (€/kg) : la mesure suit toute l'application.
defineProps({ modelValue: { type: String, default: 'value' }, noPrice: Boolean });
const emit = defineEmits(['update:modelValue']);
const OPTIONS = [
  { id: 'value', label: 'Valeur €', title: 'Valeur des échanges en euros' },
  { id: 'quantity', label: 'Volume', title: 'Quantités échangées (kg, t, kt, Mt selon le volume)' },
  { id: 'price', label: 'Prix €/kg', title: 'Prix moyen = valeur / quantité' },
];
</script>

<template>
  <div class="seg" role="group" aria-label="Mesure">
    <button v-for="o in OPTIONS.filter((x) => !(noPrice && x.id === 'price'))" :key="o.id" type="button" :title="o.title" :class="{ on: modelValue === o.id }" @click="emit('update:modelValue', o.id)">{{ o.label }}</button>
  </div>
</template>
