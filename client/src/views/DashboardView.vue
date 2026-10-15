<script setup>
import { onMounted, ref } from 'vue';
import Loader from '../components/Loader.vue';
import DashboardWidget from '../components/DashboardWidget.vue';
import { useDashboardStore } from '../stores/dashboard.js';
import { useMetaStore } from '../stores/meta.js';
import { useUiStore } from '../stores/ui.js';

// Tableau de bord personnel : graphiques enregistrés avec leurs filtres, à réorganiser librement.
const store = useDashboardStore();
const meta = useMetaStore();
const ui = useUiStore();
const error = ref('');
const loading = ref(!store.loaded);
const dragId = ref(null);
const overId = ref(null);

onMounted(async () => {
  try {
    await Promise.all([store.load(), meta.load()]);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
});

const list = () => store.widgets.map((w) => ({ ...w }));
const uid = () => Math.random().toString(36).slice(2, 10);
function update(id, patch) {
  store.save(list().map((w) => (w.id === id ? { ...w, ...patch } : w))).catch(() => {});
}
function move(id, dir) {
  const l = list();
  const i = l.findIndex((w) => w.id === id);
  const j = i + dir;
  if (j < 0 || j >= l.length) return;
  [l[i], l[j]] = [l[j], l[i]];
  store.save(l).catch(() => {});
}
function remove(w) {
  if (!window.confirm(`Supprimer « ${w.title} » du tableau de bord ?`)) return;
  store.remove(w.id);
}
function duplicate(w) {
  const l = list();
  const i = l.findIndex((x) => x.id === w.id);
  l.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(w)), id: uid(), title: `${w.title} (copie)` });
  store.save(l).catch(() => {});
}
function freeze(w, data, period) {
  if (!data || !period.from) {
    // Tout l'historique : on fige jusqu'au dernier mois disponible
    if (!meta.firstPeriod || !meta.lastPeriod) return;
    period = { from: meta.firstPeriod, to: meta.lastPeriod };
  }
  update(w.id, { mode: 'fixed', from: period.from, to: period.to, snapshot: data, frozenAt: new Date().toISOString() });
  ui.toast(`« ${w.title} » est figé : ses chiffres ne changeront plus`);
}
function follow(w) {
  const { snapshot, frozenAt, ...rest } = w;
  update(w.id, { ...rest, mode: 'live', months: 12, snapshot: undefined, frozenAt: undefined });
}

// Glisser-déposer : le graphique déplacé prend la place de celui survolé
function onDragStart(e, w) {
  dragId.value = w.id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', w.id);
}
function onDrop(target) {
  const from = dragId.value;
  dragId.value = null;
  overId.value = null;
  if (!from || from === target.id) return;
  const l = list();
  const i = l.findIndex((w) => w.id === from);
  const [item] = l.splice(i, 1);
  l.splice(l.findIndex((w) => w.id === target.id) + (i <= l.findIndex((w) => w.id === target.id) ? 1 : 0), 0, item);
  store.save(l).catch(() => {});
}

const SUGGESTIONS = [
  { label: 'Exportations de l\'UE, 24 derniers mois', w: { type: 'trend', months: 24, params: { flow: 'export' } } },
  { label: 'Principaux clients de l\'UE', w: { type: 'rank', months: 12, params: { dimension: 'partner', flow: 'export' } } },
  { label: 'Chiffres clés des 12 derniers mois', w: { type: 'kpi', months: 12 } },
];
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Mon tableau de bord</h1>
        <p>Vos graphiques, avec les filtres choisis : suivis (mis à jour avec chaque nouvelle donnée) ou figés (pour garder une période en mémoire).</p>
      </div>
      <div class="row">
        <span v-if="store.saving" class="hint"><span class="spinner" style="width: 14px; height: 14px; border-width: 2px; vertical-align: -2px" /> Enregistrement…</span>
        <button class="btn btn-primary" @click="store.openBuilder()">＋ Ajouter un graphique</button>
      </div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <Loader v-if="loading" text="Chargement de votre tableau de bord…" />

    <div v-else-if="!store.widgets.length" class="card onboarding">
      <h2>Composez votre tableau de bord</h2>
      <p class="secondary">Ajoutez les graphiques que vous voulez retrouver à chaque connexion. Deux façons de faire :</p>
      <ol>
        <li>Cliquez sur <strong>＋ Ajouter un graphique</strong> et choisissez produit, pays, sens et période.</li>
        <li>Ou, depuis une <RouterLink to="/nomenclature">fiche produit</RouterLink> ou une <RouterLink to="/pays">fiche pays</RouterLink>, cliquez sur <strong>＋ Au tableau de bord</strong> : les filtres en cours sont repris.</li>
      </ol>
      <p class="secondary" style="margin-top: 14px">Pour commencer tout de suite :</p>
      <div class="row wrap">
        <button v-for="s in SUGGESTIONS" :key="s.label" class="btn btn-sm" @click="store.openBuilder(s.w)">＋ {{ s.label }}</button>
      </div>
    </div>

    <TransitionGroup v-else tag="div" name="dash" class="grid-dash">
      <div
        v-for="(w, i) in store.widgets" :key="w.id" class="slot" :class="{ full: w.size === 'full', dragging: dragId === w.id, over: overId === w.id && dragId !== w.id }"
        draggable="true" @dragstart="onDragStart($event, w)" @dragend="dragId = null; overId = null"
        @dragover.prevent="overId = w.id" @dragleave="overId === w.id && (overId = null)" @drop.prevent="onDrop(w)"
      >
        <DashboardWidget
          :widget="w" :index="i" :count="store.widgets.length"
          @edit="store.edit(w)" @remove="remove(w)" @move="(d) => move(w.id, d)" @duplicate="duplicate(w)"
          @resize="update(w.id, { size: w.size === 'full' ? 'half' : 'full' })"
          @freeze="(data, period) => freeze(w, data, period)" @follow="follow(w)"
        />
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.grid-dash { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
.slot { min-width: 0; border-radius: 14px; transition: outline-color 0.15s; outline: 2px dashed transparent; outline-offset: 4px; }
.slot.full { grid-column: 1 / -1; }
.slot.dragging { opacity: 0.4; }
.slot.over { outline-color: var(--accent); }
.dash-move { transition: transform 0.3s; }
.onboarding ol { color: var(--text-2); display: grid; gap: 6px; margin: 10px 0 0; }
.wrap { flex-wrap: wrap; gap: 8px; }
@media (max-width: 900px) { .grid-dash { grid-template-columns: 1fr; } }
</style>
