<script setup>
import { computed, ref, watch } from 'vue';
import { api } from '../api.js';
import { ncCode } from '../format.js';

// Navigation : un chapitre (liste des sous-positions, regroupées par position) ou une
// sous-position (liste des codes à 8 chiffres). Les chiffres sont sur la fiche du code NC8.
const props = defineProps({ code: { type: String, required: true } });
const node = ref(null);
const error = ref('');
watch(() => props.code, async () => {
  error.value = '';
  try { node.value = await api(`/nomenclature/${props.code}`); } catch (e) { error.value = e.message; node.value = null; }
}, { immediate: true });

// Sous-positions regroupées par position (4 chiffres), dans l'ordre des codes
const groups = computed(() => {
  if (!node.value || node.value.level !== 2) return [];
  const map = new Map();
  for (const c of node.value.children) {
    const h = c.code.slice(0, 4);
    if (!map.has(h)) map.set(h, { code: h, label: node.value.headings?.[h] || '', items: [] });
    map.get(h).items.push(c);
  }
  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code)).map((g) => ({ ...g, items: g.items.sort((a, b) => a.code.localeCompare(b.code)) }));
});
const codes = computed(() => (node.value?.level === 6 ? [...node.value.children].sort((a, b) => Number(a.obsolete) - Number(b.obsolete) || a.code.localeCompare(b.code)) : []));
</script>

<template>
  <div>
    <nav class="crumbs" aria-label="Fil d'Ariane">
      <RouterLink to="/nomenclature">Produits</RouterLink>
      <template v-if="node">
        <template v-for="p in node.parents" :key="p.code"><span class="sep">›</span><RouterLink :to="`/nomenclature/${p.code}`">{{ ncCode(p.code) }} {{ p.label }}</RouterLink></template>
        <span class="sep">›</span><strong>{{ ncCode(node.code) }}</strong>
      </template>
    </nav>
    <p v-if="error" class="error">{{ error }}</p>
    <template v-if="node">
      <div class="page-head">
        <div>
          <span class="badge badge-accent">{{ node.level === 2 ? 'Chapitre' : 'Sous-position' }}</span>
          <h1 class="title"><span class="nc code">{{ ncCode(node.code) }}</span> {{ node.label }}</h1>
          <p>{{ node.level === 2 ? 'Choisissez une sous-position, puis le code à 8 chiffres qui vous intéresse.' : 'Choisissez le code à 8 chiffres : sa fiche réunit valeurs, volumes, prix et pays.' }}</p>
        </div>
      </div>

      <template v-if="node.level === 2">
        <section v-for="g in groups" :key="g.code" class="group">
          <h2><span class="nc">{{ ncCode(g.code) }}</span> {{ g.label }}</h2>
          <div class="list">
            <RouterLink v-for="c in g.items" :key="c.code" :to="`/nomenclature/${c.code}`" class="item" :class="{ old: c.obsolete }">
              <span class="nc code">{{ ncCode(c.code) }}</span>
              <span class="label">{{ c.label }}</span>
              <span class="hint">{{ c.obsolete ? 'ancien code' : `${c.productCount} code${c.productCount > 1 ? 's' : ''}` }} ›</span>
            </RouterLink>
          </div>
        </section>
      </template>

      <section v-else class="card">
        <div class="list">
          <RouterLink v-for="c in codes" :key="c.code" :to="`/produits/${c.code}`" class="item" :class="{ old: c.obsolete }" :title="c.obsolete ? 'Ancien code : ses données sont rattachées aux codes actuels' : ''">
            <span class="nc code">{{ ncCode(c.code) }}</span>
            <span class="label">{{ c.label }}</span>
            <span class="hint">{{ c.obsolete ? `ancien code${c.validTo ? ` (jusqu'en ${c.validTo})` : ''}` : 'Voir la fiche' }} ›</span>
          </RouterLink>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.title { margin-top: 6px; }
.title .code { color: var(--accent); margin-right: 6px; }
.group { margin-bottom: 18px; }
.group h2 { font-size: 0.92rem; margin-bottom: 8px; color: var(--text-2); }
.group h2 .nc { color: var(--text); margin-right: 6px; }
.list { display: grid; gap: 6px; }
.item { display: grid; grid-template-columns: 110px 1fr auto; gap: 12px; align-items: center; padding: 10px 14px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); color: var(--text); }
.item:hover { text-decoration: none; border-color: var(--accent); }
.item.old { opacity: 0.6; border-style: dashed; }
.item .code { font-weight: 700; color: var(--accent); }
.label { line-height: 1.35; }
@media (max-width: 600px) { .item { grid-template-columns: 1fr; gap: 2px; } }
</style>
