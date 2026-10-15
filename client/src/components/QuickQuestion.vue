<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api.js';
import { eur, tonnes, percent, perKg, periodLabel, MONTHS, ncCode } from '../format.js';
import { useMetaStore } from '../stores/meta.js';
import { useReportsStore } from '../stores/reports.js';
import Flag from './Flag.vue';
import NcSearch from './NcSearch.vue';
import Sparkline from './Sparkline.vue';
import { withArticle } from '../lib/countries.js';

// Question en langage naturel : « Combien [pays] a-t-il [exporté] de [produit] vers [partenaire]
// entre [mois année] et [mois année] ? » -> réponse chiffrée immédiate.
const emit = defineEmits(['apply']);
const meta = useMetaStore();
const reports = useReportsStore();

const q = ref({ reporter: 'FR', flow: 'export', product: '2204', partner: '', fm: 3, fy: 2018, tm: 1, ty: 2019 });
const productLabel = ref('Vins de raisins frais');
const answer = ref(null);
const series = ref([]);
const loading = ref(false);
const error = ref('');

const params = computed(() => ({
  reporters: q.value.reporter ? [q.value.reporter] : [],
  partners: q.value.partner ? [q.value.partner] : [],
  product: q.value.product,
  periodFrom: `${q.value.fy}-${String(q.value.fm).padStart(2, '0')}`,
  periodTo: `${q.value.ty}-${String(q.value.tm).padStart(2, '0')}`,
}));
const valid = computed(() => q.value.fy * 100 + q.value.fm <= q.value.ty * 100 + q.value.tm);
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const who = computed(() => cap(q.value.reporter ? withArticle(q.value.reporter, meta.countryName(q.value.reporter)) : "l'Union européenne"));
const verb = computed(() => (q.value.flow === 'export' ? 'exporté' : 'importé'));
const where = computed(() => `${q.value.flow === 'export' ? 'vers' : 'depuis'} ${q.value.partner ? withArticle(q.value.partner, meta.countryName(q.value.partner)) : 'les pays hors UE'}`);
const what = computed(() => (q.value.product ? `${(productLabel.value || `codes ${ncCode(q.value.product)}`).replace(/^./, (c) => c.toLowerCase())} (NC ${ncCode(q.value.product)})` : 'toutes marchandises'));
const k = computed(() => (q.value.flow === 'export' ? 'export' : 'import'));

async function ask() {
  if (!valid.value) return;
  loading.value = true;
  error.value = '';
  try {
    const [s, ts] = await Promise.all([
      api('/stats/summary', { params: params.value }),
      api('/stats/timeseries', { params: { ...params.value, granularity: 'month' } }),
    ]);
    answer.value = s;
    series.value = ts.map((r) => r[`${k.value}Eur`]);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
async function onProduct(p) {
  productLabel.value = p.description;
}
watch(() => q.value.product, async (code) => {
  if (!code) { productLabel.value = ''; return; }
  if (code.length === 8) {
    try { productLabel.value = (await api(`/products/${code}`)).description; } catch { /* libellé facultatif */ }
  } else if (code.length === 2 || code.length === 6) {
    try { productLabel.value = (await api(`/nomenclature/${code}`)).label; } catch { productLabel.value = ''; }
  } else productLabel.value = `codes NC ${code}…`;
});
watch(params, ask, { deep: true });
watch(() => q.value.flow, ask);
onMounted(async () => {
  try {
    await meta.load();
  } catch (e) {
    error.value = e.message;
  }
  ask();
});

const sentence = computed(() => {
  if (!answer.value) return '';
  const a = answer.value;
  return `${who.value} a ${verb.value} ${eur(a[`${k.value}Eur`])} (${tonnes(a[`${k.value}Kg`])}) de ${what.value} ${where.value} ${params.value.periodFrom === params.value.periodTo ? `en ${periodLabel(params.value.periodFrom)}` : `entre ${periodLabel(params.value.periodFrom)} et ${periodLabel(params.value.periodTo)}`}.`;
});

function toReport() {
  const a = answer.value;
  reports.add(
    [
      { type: 'heading', text: `${who.value} — ${q.value.flow === 'export' ? 'exportations' : 'importations'} de ${what.value}`, level: 2 },
      { type: 'text', html: `<p>${sentence.value}</p>` },
      {
        type: 'kpis',
        items: [
          { label: 'Valeur', value: eur(a[`${k.value}Eur`]), sub: `${percent(k.value === 'export' ? a.changeExport : a.changeImport)} sur un an` },
          { label: 'Quantité', value: tonnes(a[`${k.value}Kg`]), sub: `${percent(k.value === 'export' ? a.changeExportKg : a.changeImportKg)} sur un an` },
          { label: 'Prix moyen', value: perKg(a[`${k.value}Eur`] / a[`${k.value}Kg`]), sub: 'Valeur / quantité' },
          { label: 'Partenaires', value: String(a.partnerCount), sub: 'pays hors UE' },
        ],
      },
    ],
    'Question rapide'
  );
}
</script>

<template>
  <section class="card qq">
    <div class="qq-head">
      <h2>Question rapide</h2>
      <span class="hint">Posez votre question, la réponse se met à jour instantanément.</span>
    </div>
    <form class="sentence" @submit.prevent="ask">
      <span>Combien</span>
      <label class="pill">
        <Flag v-if="q.reporter" :code="q.reporter" />
        <select v-model="q.reporter" aria-label="Pays déclarant">
          <option value="">l'UE (27 pays)</option>
          <option v-for="c in meta.reporters" :key="c.code" :value="c.code">{{ c.name }}</option>
        </select>
      </label>
      <span>a-t-il</span>
      <label class="pill">
        <select v-model="q.flow" aria-label="Flux"><option value="export">exporté</option><option value="import">importé</option></select>
      </label>
      <span>de</span>
      <div class="pill product"><NcSearch v-model="q.product" placeholder="tous produits (code ou nom)" @select="onProduct" /></div>
      <span>{{ q.flow === 'export' ? 'vers' : 'depuis' }}</span>
      <label class="pill">
        <Flag v-if="q.partner" :code="q.partner" />
        <select v-model="q.partner" aria-label="Partenaire">
          <option value="">le monde hors UE</option>
          <option v-for="c in meta.partners" :key="c.code" :value="c.code">{{ c.name }}</option>
        </select>
      </label>
      <span>entre</span>
      <label class="pill">
        <select v-model.number="q.fm" aria-label="Mois de début"><option v-for="(m, i) in MONTHS" :key="m" :value="i + 1">{{ m }}</option></select>
        <select v-model.number="q.fy" aria-label="Année de début"><option v-for="y in meta.years" :key="y" :value="y">{{ y }}</option></select>
      </label>
      <span>et</span>
      <label class="pill">
        <select v-model.number="q.tm" aria-label="Mois de fin"><option v-for="(m, i) in MONTHS" :key="m" :value="i + 1">{{ m }}</option></select>
        <select v-model.number="q.ty" aria-label="Année de fin"><option v-for="y in meta.years" :key="y" :value="y">{{ y }}</option></select>
      </label>
      <span>?</span>
    </form>
    <p v-if="!valid" class="error">La date de début doit précéder la date de fin.</p>
    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="answer && valid" class="answer" :class="{ loading }">
      <div class="figures">
        <div><span class="big">{{ eur(answer[`${k}Eur`]) }}</span><span class="lbl">en valeur</span></div>
        <div><span class="big">{{ tonnes(answer[`${k}Kg`]) }}</span><span class="lbl">en quantité</span></div>
        <div><span class="mid">{{ perKg(answer[`${k}Eur`] / answer[`${k}Kg`]) }}</span><span class="lbl">prix moyen</span></div>
        <div>
          <span class="mid" :class="(k === 'export' ? answer.changeExport : answer.changeImport) >= 0 ? 'up' : 'down'">{{ percent(k === 'export' ? answer.changeExport : answer.changeImport) }}</span>
          <span class="lbl">vs même période N-1</span>
        </div>
        <div class="spark">
          <Sparkline :values="series" :width="160" :height="40" :color="`var(--${k})`" />
          <span class="lbl">évolution mensuelle</span>
        </div>
      </div>
      <p class="sent">{{ sentence }}</p>
      <div class="row">
        <button class="btn btn-sm btn-primary" @click="emit('apply', { ...params, flow: q.flow })">Analyser en détail ↓</button>
        <RouterLink v-if="q.product.length === 8" class="btn btn-sm" :to="{ path: `/produits/${q.product}`, query: { periodFrom: params.periodFrom, periodTo: params.periodTo } }">Fiche produit →</RouterLink>
        <RouterLink v-else-if="q.product.length === 2 || q.product.length === 6" class="btn btn-sm" :to="`/nomenclature/${q.product}`">Ouvrir NC {{ ncCode(q.product) }} →</RouterLink>
        <button class="btn btn-sm" @click="toReport">＋ Ajouter au rapport</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.qq { margin-bottom: 16px; background: linear-gradient(135deg, var(--accent-wash), transparent 60%), var(--surface); }
.qq-head { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; margin-bottom: 10px; }
.sentence { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 1.05rem; color: var(--text-2); }
.pill { display: inline-flex; gap: 4px; align-items: center; background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 2px 4px 2px 10px; }
.pill select { border: 0; background: transparent; font-weight: 600; color: var(--text); padding: 4px 2px; }
.pill.product { padding: 0; border: 0; background: none; min-width: 240px; }
.pill.product :deep(input) { border-radius: 999px; font-weight: 600; }
.answer { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--grid); }
.figures { display: flex; flex-wrap: wrap; gap: 12px 32px; align-items: flex-end; }
.figures > div { display: flex; flex-direction: column; min-width: 0; max-width: 100%; }
.big { font-size: 2rem; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; }
.mid { font-size: 1.3rem; font-weight: 650; }
.lbl { font-size: 0.76rem; color: var(--muted); }
.spark { margin-left: auto; }
.sent { margin: 12px 0; color: var(--text-2); }
@media (max-width: 700px) { .spark { margin-left: 0; } .big { font-size: 1.6rem; } }
</style>
