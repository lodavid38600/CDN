<script setup>
import { computed, ref, watch } from 'vue';
import Modal from './Modal.vue';
import NcSearch from './NcSearch.vue';
import MultiSelect from './MultiSelect.vue';
import MeasureSwitch from './MeasureSwitch.vue';
import PeriodPicker from './PeriodPicker.vue';
import DashboardWidget from './DashboardWidget.vue';
import { useDashboardStore } from '../stores/dashboard.js';
import { useMetaStore } from '../stores/meta.js';
import { WIDGET_TYPES, DIMENSION_LABEL, WINDOW_LABEL, widgetPeriod, fetchWidgetData, suggestTitle } from '../lib/widgets.js';

// Création ou modification d'un graphique du tableau de bord, avec aperçu en direct.
const store = useDashboardStore();
const meta = useMetaStore();
const d = computed(() => store.draft);
const error = ref('');
const busy = ref(false);
const titleTouched = ref(false);
const preview = ref(null);

const countryOpts = (list) => list.map((c) => ({ value: c.code, label: c.name }));
const shift = (p, n) => { const [y, m] = p.split('-').map(Number); const t = y * 12 + m - 1 + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };

watch(() => store.draft, (v) => {
  error.value = '';
  titleTouched.value = Boolean(v?.title);
  meta.load().catch(() => {});
}, { immediate: true });
// Titre proposé tant que l'utilisateur ne l'a pas modifié
watch(() => d.value && JSON.stringify([d.value.type, d.value.params]), () => {
  if (d.value && !titleTouched.value) d.value.title = suggestTitle(d.value, meta.countryName);
});
// Les codes NC8 par pays obligeraient à relire toutes les déclarations : proposé avec un produit
const productRankOk = computed(() => {
  const p = d.value?.params;
  return p && p.product.length !== 8 && (p.product.length > 0 || (!p.reporters.length && !p.partners.length));
});
watch(productRankOk, (ok) => { if (!ok && d.value?.params.dimension === 'product') d.value.params.dimension = 'chapter'; });
watch(() => d.value?.params.product, (code) => { if (code?.length === 8 && d.value.params.dimension === 'chapter') d.value.params.dimension = 'partner'; });

function setMode(mode) {
  d.value.mode = mode;
  if (mode === 'fixed' && (!d.value.from || !d.value.to)) {
    const last = meta.lastPeriod || `${new Date().getFullYear()}-12`;
    const p = widgetPeriod({ mode: 'live', months: d.value.months || 12 }, last);
    d.value.from = p.from || shift(last, -11);
    d.value.to = p.to || last;
  }
}
// Aperçu : mises à jour regroupées pour ne pas lancer une requête par frappe
const previewWidget = ref(null);
let t;
watch(() => d.value && JSON.stringify(d.value), () => {
  clearTimeout(t);
  t = setTimeout(() => { previewWidget.value = d.value ? { ...JSON.parse(JSON.stringify(d.value)), snapshot: undefined, id: 'apercu' } : null; }, 400);
}, { immediate: true });

async function save() {
  error.value = '';
  if (d.value.mode === 'fixed' && (!d.value.from || !d.value.to)) { error.value = 'Choisissez la période à figer.'; return; }
  busy.value = true;
  try {
    const w = JSON.parse(JSON.stringify(d.value));
    if (!w.title?.trim()) w.title = suggestTitle(w, meta.countryName);
    if (w.mode === 'fixed') {
      // Les chiffres sont enregistrés avec le graphique : ils ne changeront plus
      w.snapshot = await fetchWidgetData(w, { from: w.from, to: w.to });
      w.frozenAt = new Date().toISOString();
    } else {
      delete w.snapshot;
      delete w.frozenAt;
    }
    if (store.editingId) await store.replace(store.editingId, w);
    else await store.add(w);
    store.close();
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Modal v-if="d" :title="store.editingId ? 'Modifier le graphique' : 'Ajouter un graphique au tableau de bord'" wide @close="store.close()">
    <div class="builder">
      <div class="form">
        <fieldset>
          <legend>1. Type de graphique</legend>
          <div class="types">
            <button v-for="(t, k) in WIDGET_TYPES" :key="k" type="button" class="type" :class="{ on: d.type === k }" @click="d.type = k">
              <strong>{{ t.label }}</strong><span class="hint">{{ t.hint }}</span>
            </button>
          </div>
        </fieldset>

        <fieldset>
          <legend>2. Ce que vous suivez</legend>
          <label class="field">Produit <span class="hint">(facultatif : tous les produits sinon)</span><NcSearch v-model="d.params.product" placeholder="Mot ou code NC (2 à 8 chiffres)" /></label>
          <div class="two">
            <label class="field">Pays de l'UE<MultiSelect v-model="d.params.reporters" :options="countryOpts(meta.reporters)" placeholder="Toute l'UE" flags /></label>
            <label class="field">Pays hors UE<MultiSelect v-model="d.params.partners" :options="countryOpts(meta.partners)" placeholder="Tous" flags /></label>
          </div>
          <div class="field"><span>Sens des échanges</span>
            <div class="seg">
              <button type="button" :class="{ on: !d.params.flow }" @click="d.params.flow = ''">Les deux</button>
              <button type="button" :class="{ on: d.params.flow === 'export' }" @click="d.params.flow = 'export'">Exportations de l'UE</button>
              <button type="button" :class="{ on: d.params.flow === 'import' }" @click="d.params.flow = 'import'">Importations de l'UE</button>
            </div>
          </div>
          <div class="field"><span>Mesure</span><MeasureSwitch v-model="d.params.measure" /></div>
          <div v-if="d.type === 'trend'" class="field"><span>Pas de temps</span>
            <div class="seg">
              <button v-for="[k, l] in [['month', 'Mois'], ['quarter', 'Trimestre'], ['year', 'Année']]" :key="k" type="button" :class="{ on: d.params.granularity === k }" @click="d.params.granularity = k">{{ l }}</button>
            </div>
          </div>
          <div v-if="d.type === 'rank'" class="two">
            <label class="field">Classer<select v-model="d.params.dimension">
              <option v-for="(l, k) in DIMENSION_LABEL" :key="k" :value="k" :disabled="(k === 'product' && !productRankOk) || (k === 'chapter' && d.params.product.length === 8)">{{ l }}{{ k === 'product' && !productRankOk ? ' (choisir un chapitre ou une position)' : '' }}</option>
            </select></label>
            <label class="field">Nombre<select v-model.number="d.params.limit"><option v-for="n in [5, 10, 15, 20, 25]" :key="n" :value="n">{{ n }} premiers</option></select></label>
          </div>
        </fieldset>

        <fieldset>
          <legend>3. Période</legend>
          <div class="modes">
            <button type="button" class="type" :class="{ on: d.mode === 'live' }" @click="setMode('live')">
              <strong>↻ Suivre l'évolution</strong><span class="hint">Le graphique se met à jour tout seul à chaque nouvelle donnée</span>
            </button>
            <button type="button" class="type" :class="{ on: d.mode === 'fixed' }" @click="setMode('fixed')">
              <strong>📌 Figer une période</strong><span class="hint">Les chiffres sont gardés tels quels, pour s'en souvenir</span>
            </button>
          </div>
          <label v-if="d.mode === 'live'" class="field">Fenêtre glissante<select v-model.number="d.months"><option v-for="(l, k) in WINDOW_LABEL" :key="k" :value="Number(k)">{{ l }}</option></select></label>
          <div v-else class="field"><span>Période figée</span><PeriodPicker v-model:from="d.from" v-model:to="d.to" /></div>
        </fieldset>

        <fieldset>
          <legend>4. Présentation</legend>
          <label class="field">Titre<input v-model="d.title" maxlength="160" @input="titleTouched = true" /></label>
          <div class="field"><span>Largeur</span>
            <div class="seg">
              <button type="button" :class="{ on: d.size === 'half' }" @click="d.size = 'half'">Demi-largeur</button>
              <button type="button" :class="{ on: d.size === 'full' }" @click="d.size = 'full'">Pleine largeur</button>
            </div>
          </div>
        </fieldset>
      </div>

      <div class="preview">
        <p class="hint">Aperçu</p>
        <DashboardWidget v-if="previewWidget" ref="preview" :key="JSON.stringify(previewWidget)" :widget="previewWidget" preview />
      </div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="row actions">
      <button class="btn" @click="store.close()">Annuler</button>
      <button class="btn btn-primary" :disabled="busy" @click="save"><span v-if="busy" class="spinner" />{{ store.editingId ? 'Enregistrer' : 'Ajouter au tableau de bord' }}</button>
    </div>
  </Modal>
</template>

<style scoped>
.builder { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
:global(.modal.wide:has(.builder)) { width: min(1100px, calc(100vw - 32px)); }
fieldset { border: 0; padding: 0; margin: 0 0 14px; display: grid; gap: 10px; }
legend { font-weight: 650; margin-bottom: 8px; font-size: 0.9rem; }
.types { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.modes { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.type { display: flex; flex-direction: column; gap: 4px; text-align: left; padding: 10px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; font: inherit; }
.type.on { border-color: var(--accent); background: var(--accent-wash); }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.preview { position: sticky; top: 0; align-self: start; }
.actions { justify-content: flex-end; gap: 8px; margin-top: 8px; }
@media (max-width: 860px) { .builder { grid-template-columns: 1fr; } .types { grid-template-columns: 1fr; } }
</style>
