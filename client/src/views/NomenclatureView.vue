<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api.js';
import { eur, sharePct, rangeLabel } from '../format.js';
import { useMetaStore } from '../stores/meta.js';
import PeriodPicker from '../components/PeriodPicker.vue';
import Sparkline from '../components/Sparkline.vue';

// Point d'entrée de la navigation : tous les chapitres NC02, regroupés par section.
const meta = useMetaStore();
const tree = ref([]);
const stats = ref({});
const sparks = ref({});
const period = ref({ from: '', to: '' });
const flow = ref('');
const sort = ref('code');
const q = ref('');
const onlyData = ref(false);
const loading = ref(false);
const error = ref('');

const valueOf = (code) => {
  const s = stats.value[code];
  if (!s) return 0;
  return flow.value === 'import' ? s.importEur : flow.value === 'export' ? s.exportEur : s.totalEur;
};
const grand = computed(() => Object.keys(stats.value).reduce((t, k) => t + valueOf(k), 0) || 1);
const maxChapter = computed(() => Math.max(1, ...Object.keys(stats.value).map(valueOf)));

const sections = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return tree.value
    .map((s) => {
      let chapters = s.chapters.filter((c) => !needle || `${c.code} ${c.label}`.toLowerCase().includes(needle));
      if (onlyData.value) chapters = chapters.filter((c) => valueOf(c.code) > 0);
      if (sort.value === 'value') chapters = [...chapters].sort((a, b) => valueOf(b.code) - valueOf(a.code));
      return { ...s, chapters, total: s.chapters.reduce((t, c) => t + valueOf(c.code), 0) };
    })
    .filter((s) => s.chapters.length);
});
const intensity = (code) => {
  const v = valueOf(code);
  return v > 0 ? 0.06 + 0.3 * Math.sqrt(v / maxChapter.value) : 0;
};

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const params = { periodFrom: period.value.from, periodTo: period.value.to };
    const [top, sp] = await Promise.all([
      api('/stats/top', { params: { ...params, dimension: 'chapter', limit: 100 } }),
      api('/stats/sparklines', { params: { dimension: 'chapter', flow: flow.value } }),
    ]);
    stats.value = Object.fromEntries(top.map((r) => [r.key, r]));
    sparks.value = sp.series;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
watch(period, load, { deep: true });
watch(flow, load);
onMounted(async () => {
  try {
    await meta.load();
    tree.value = await api('/nomenclature');
    await load();
  } catch (e) {
    error.value = e.message;
  }
});
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Nomenclature combinée</h1>
        <p>Choisissez un chapitre (NC02), puis une sous-position (NC06), puis un code NC à 8 chiffres.</p>
      </div>
    </div>

    <div class="card toolbar">
      <div class="field"><span>Période</span><PeriodPicker v-model:from="period.from" v-model:to="period.to" /></div>
      <div class="field"><span>Flux</span>
        <div class="seg">
          <button :class="{ on: !flow }" @click="flow = ''">Les deux</button>
          <button :class="{ on: flow === 'import' }" @click="flow = 'import'">Import</button>
          <button :class="{ on: flow === 'export' }" @click="flow = 'export'">Export</button>
        </div>
      </div>
      <div class="field"><span>Trier</span>
        <div class="seg">
          <button :class="{ on: sort === 'code' }" @click="sort = 'code'">Par code</button>
          <button :class="{ on: sort === 'value' }" @click="sort = 'value'">Par valeur</button>
        </div>
      </div>
      <label class="field grow"><span>Filtrer les chapitres</span><input v-model="q" type="search" placeholder="ex. 22, boissons, machines…" /></label>
      <label class="chk"><input v-model="onlyData" type="checkbox" /> Avec données seulement</label>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <div :class="{ loading }">
      <section v-for="s in sections" :key="s.code" class="section">
        <header class="sh">
          <span class="roman">{{ s.code }}</span>
          <h2>{{ s.label }}</h2>
          <span class="muted small">{{ eur(s.total) }} · {{ sharePct(s.total / grand) }}</span>
        </header>
        <div class="tiles">
          <RouterLink
            v-for="c in s.chapters" :key="c.code" :to="`/nomenclature/${c.code}`"
            class="tile" :class="{ off: !c.productCount }"
            :style="{ '--heat': intensity(c.code) }"
            :title="`${c.code} — ${c.label}`"
          >
            <div class="t-top">
              <span class="t-code nc">{{ c.code }}</span>
              <Sparkline v-if="sparks[c.code]" :values="sparks[c.code]" :width="64" :height="22" />
            </div>
            <div class="t-label">{{ c.label }}</div>
            <div class="t-foot">
              <strong>{{ valueOf(c.code) ? eur(valueOf(c.code)) : '—' }}</strong>
              <span v-if="valueOf(c.code)" class="muted">{{ sharePct(valueOf(c.code) / grand) }}</span>
              <span v-else class="muted small">{{ c.productCount ? '' : 'non couvert' }}</span>
            </div>
          </RouterLink>
        </div>
      </section>
      <p v-if="!sections.length && tree.length" class="empty">Aucun chapitre ne correspond.</p>
    </div>
    <p class="hint" style="margin-top: 12px">Valeurs : {{ flow === 'import' ? 'importations' : flow === 'export' ? 'exportations' : 'importations + exportations' }} extra-UE, {{ rangeLabel(period.from, period.to) }}. Intensité de la tuile proportionnelle aux échanges.</p>
  </div>
</template>

<style scoped>
.toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin-bottom: 20px; }
.toolbar .field { min-width: 200px; }
.grow { flex: 1; }
.chk { display: flex; gap: 6px; align-items: center; font-size: 0.85rem; color: var(--text-2); padding-bottom: 8px; }
.section { margin-bottom: 22px; }
.sh { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.roman { font-weight: 800; color: var(--accent); min-width: 34px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
.tile {
  display: flex; flex-direction: column; gap: 6px; padding: 12px; border-radius: 12px; color: var(--text);
  background: linear-gradient(0deg, color-mix(in srgb, var(--accent) calc(var(--heat) * 100%), transparent), color-mix(in srgb, var(--accent) calc(var(--heat) * 100%), transparent)), var(--surface);
  border: 1px solid var(--border); box-shadow: var(--shadow); transition: transform 0.12s, border-color 0.12s; min-height: 118px;
}
.tile:hover { text-decoration: none; border-color: var(--accent); transform: translateY(-2px); }
.tile.off { opacity: 0.55; }
.t-top { display: flex; justify-content: space-between; align-items: center; }
.t-code { font-size: 1.5rem; font-weight: 750; letter-spacing: -0.02em; }
.t-label { font-size: 0.84rem; color: var(--text-2); line-height: 1.3; flex: 1; }
.t-foot { display: flex; justify-content: space-between; align-items: baseline; font-size: 0.85rem; font-variant-numeric: tabular-nums; }
</style>
