<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api.js';
import { eur, ncCode } from '../format.js';
import { useMetaStore } from '../stores/meta.js';

const meta = useMetaStore();
const year = ref(null);
const sectionStats = ref({});
const chapterStats = ref({});
const openSection = ref(null);
const openChapter = ref(null);
const products = ref({ rows: [], total: 0 });
const q = ref('');
const search = ref({ rows: [], total: 0 });
const error = ref('');

const params = computed(() => (year.value ? { year: year.value } : {}));
const toMap = (rows) => Object.fromEntries(rows.map((r) => [r.key, r]));
const maxSection = computed(() => Math.max(1, ...Object.values(sectionStats.value).map((s) => s.totalEur)));

async function loadSections() {
  sectionStats.value = toMap(await api('/stats/top', { params: { ...params.value, dimension: 'section', limit: 30 } }));
  if (openSection.value) await loadChapters(openSection.value);
}
async function loadChapters(section) {
  chapterStats.value = toMap(await api('/stats/top', { params: { ...params.value, dimension: 'chapter', sections: section, limit: 30 } }));
}
async function toggleSection(code) {
  openChapter.value = null;
  if (openSection.value === code) { openSection.value = null; return; }
  openSection.value = code;
  await loadChapters(code);
}
async function toggleChapter(code) {
  if (openChapter.value === code) { openChapter.value = null; return; }
  openChapter.value = code;
  products.value = await api('/products', { params: { chapters: code, limit: 200 } });
}

let timer;
watch(q, (v) => {
  clearTimeout(timer);
  if (!v.trim()) { search.value = { rows: [], total: 0 }; return; }
  timer = setTimeout(async () => {
    try { search.value = await api('/products', { params: { q: v, limit: 20 } }); } catch (e) { error.value = e.message; }
  }, 250);
});
watch(year, () => loadSections().catch((e) => (error.value = e.message)));

onMounted(async () => {
  try {
    await meta.load();
    await loadSections();
  } catch (e) {
    error.value = e.message;
  }
});
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Catégories de la nomenclature combinée</h1>
        <p>21 sections · 96 chapitres · codes NC à 8 chiffres</p>
      </div>
      <label class="field">Année
        <select v-model.number="year">
          <option :value="null">Toutes les années</option>
          <option v-for="y in [...meta.years].reverse()" :key="y" :value="y">{{ y }}</option>
        </select>
      </label>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <section class="card" style="margin-bottom: 16px">
      <label class="field">Rechercher un code NC ou une désignation
        <input v-model="q" type="search" placeholder="ex. 8703, vin, smartphones, huile d'olive…" />
      </label>
      <ul v-if="search.rows.length" class="results">
        <li v-for="p in search.rows" :key="p.code">
          <RouterLink :to="`/produits/${p.code}`" class="mono">{{ ncCode(p.code) }}</RouterLink>
          <span>{{ p.description }}</span>
          <span class="muted small">Ch. {{ p.chapter }} · {{ p.chapterLabel }}</span>
        </li>
      </ul>
      <p v-else-if="q.trim()" class="muted small">Aucun code NC trouvé.</p>
    </section>

    <section class="card">
      <div class="legend small"><span><span class="dot dot-import" />Importations</span><span><span class="dot dot-export" />Exportations</span><span class="muted">Barres proportionnelles aux échanges totaux</span></div>
      <ul class="tree">
        <li v-for="s in meta.sections" :key="s.code">
          <button class="row" :aria-expanded="openSection === s.code" @click="toggleSection(s.code)">
            <span class="chev">{{ openSection === s.code ? '▾' : '▸' }}</span>
            <span class="code">{{ s.code }}</span>
            <span class="label">{{ s.label }}</span>
            <span class="bar" aria-hidden="true">
              <span class="seg imp" :style="{ width: `${((sectionStats[s.code]?.importEur || 0) / maxSection) * 100}%` }" />
              <span class="seg exp" :style="{ width: `${((sectionStats[s.code]?.exportEur || 0) / maxSection) * 100}%` }" />
            </span>
            <span class="num small">{{ eur(sectionStats[s.code]?.importEur) }}</span>
            <span class="num small">{{ eur(sectionStats[s.code]?.exportEur) }}</span>
          </button>
          <ul v-if="openSection === s.code" class="tree sub">
            <li v-for="c in s.chapters" :key="c.code">
              <button class="row" :aria-expanded="openChapter === c.code" @click="toggleChapter(c.code)">
                <span class="chev">{{ openChapter === c.code ? '▾' : '▸' }}</span>
                <span class="code mono">{{ c.code }}</span>
                <span class="label">{{ c.label }}</span>
                <span class="bar" />
                <span class="num small">{{ eur(chapterStats[c.code]?.importEur) }}</span>
                <span class="num small">{{ eur(chapterStats[c.code]?.exportEur) }}</span>
              </button>
              <div v-if="openChapter === c.code" class="products">
                <p v-if="!products.rows.length" class="muted small">Aucun code NC disponible dans ce chapitre.</p>
                <RouterLink v-for="p in products.rows" :key="p.code" :to="`/produits/${p.code}`" class="product">
                  <span class="mono">{{ ncCode(p.code) }}</span><span>{{ p.description }}</span>
                </RouterLink>
                <RouterLink :to="{ path: '/', query: { chapters: c.code } }" class="btn btn-sm">Tableau de bord du chapitre {{ c.code }} →</RouterLink>
              </div>
            </li>
          </ul>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.small { font-size: 0.8rem; }
.results { list-style: none; padding: 0; margin: 12px 0 0; display: grid; gap: 6px; }
.results li { display: grid; grid-template-columns: 110px 1fr auto; gap: 10px; align-items: baseline; }
.legend { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; color: var(--text-2); }
.tree { list-style: none; margin: 0; padding: 0; }
.tree.sub { padding-left: 28px; border-left: 2px solid var(--grid); margin: 2px 0 8px 14px; }
.row {
  width: 100%; display: grid; grid-template-columns: 16px 48px minmax(0, 1fr) minmax(60px, 160px) 80px 80px; gap: 10px; align-items: center;
  background: none; border: 0; border-bottom: 1px solid var(--grid); padding: 9px 6px; font: inherit; color: var(--text); text-align: left; cursor: pointer;
}
.row:hover { background: var(--surface-2); }
.code { font-weight: 600; color: var(--text-2); }
.label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar { display: flex; gap: 2px; height: 10px; }
.seg { display: block; height: 100%; border-radius: 0 3px 3px 0; min-width: 0; }
.seg.imp { background: var(--import); }
.seg.exp { background: var(--export); }
.products { padding: 8px 0 12px 28px; display: grid; gap: 4px; }
.product { display: grid; grid-template-columns: 110px 1fr; gap: 10px; color: var(--text); padding: 4px 6px; border-radius: 6px; }
.product:hover { background: var(--surface-2); text-decoration: none; }
.product .mono { color: var(--accent); }
.products .btn { justify-self: start; margin-top: 6px; }
@media (max-width: 700px) {
  .row { grid-template-columns: 16px 40px minmax(0, 1fr) 70px; }
  .row .bar, .row > span:nth-child(5) { display: none; }
}
</style>
