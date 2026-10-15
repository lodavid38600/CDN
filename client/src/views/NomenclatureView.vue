<script setup>
import Loader from '../components/Loader.vue';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import NcSearch from '../components/NcSearch.vue';

// Produits : rechercher un produit par mots, ou parcourir la nomenclature (sections → chapitres →
// sous-positions → codes à 8 chiffres). Pas de chiffres avant la fiche du code à 8 chiffres.
const router = useRouter();
const tree = ref([]);
const error = ref('');
const search = ref('');
onMounted(async () => {
  try { tree.value = await api('/nomenclature'); } catch (e) { error.value = e.message; }
});
const pick = (p) => p?.code && router.push(`/produits/${p.code}`);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Produits</h1>
        <p>Trouvez un produit par son nom ou son code, ou parcourez la nomenclature jusqu'au code à 8 chiffres.</p>
      </div>
    </div>
    <div class="card finder">
      <label class="field">Rechercher un produit<NcSearch v-model="search" placeholder="Ex. vin mousseux, saumon fumé, smartphones, 8517…" @select="pick" /></label>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <Loader v-if="!tree.length && !error" text="Chargement de la nomenclature…" />
    <section v-for="s in tree" :key="s.code" class="section">
      <h2><span class="roman">{{ s.code }}</span> {{ s.label }}</h2>
      <div class="chapters">
        <RouterLink v-for="c in s.chapters" :key="c.code" :to="`/nomenclature/${c.code}`" class="chap" :class="{ empty: !c.productCount }">
          <span class="nc code">{{ c.code }}</span>
          <span class="label">{{ c.label }}</span>
          <span class="hint">{{ c.productCount ? `${c.productCount} code${c.productCount > 1 ? 's' : ''}` : 'aucun code' }}</span>
        </RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.finder { margin-bottom: 20px; }
.finder .field { font-size: 0.9rem; color: var(--text); font-weight: 600; }
.section { margin-bottom: 22px; }
.section h2 { font-size: 0.95rem; margin-bottom: 10px; display: flex; gap: 10px; align-items: baseline; }
.roman { color: var(--accent); font-weight: 700; min-width: 36px; }
.chapters { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 8px; }
.chap { display: grid; grid-template-columns: 34px 1fr; grid-template-rows: auto auto; column-gap: 10px; padding: 10px 12px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); color: var(--text); }
.chap:hover { text-decoration: none; border-color: var(--accent); }
.chap.empty { opacity: 0.55; }
.code { grid-row: span 2; font-size: 1.1rem; font-weight: 700; color: var(--accent); }
.label { font-size: 0.88rem; line-height: 1.3; }
</style>
