<script setup>
import { computed } from 'vue';
import Editable from './Editable.vue';
import DataChart from './DataChart.vue';
import ChartLegend from './ChartLegend.vue';
import { sanitizeHtml } from '../lib/sanitize.js';

// Un bloc de rapport, éditable sur place (mode édition) ou en lecture (présentation / impression).
const props = defineProps({ block: { type: Object, required: true }, readonly: Boolean, big: Boolean });
const emit = defineEmits(['change']);
const b = computed(() => props.block);
const touch = () => emit('change');

function setField(obj, key, value) {
  obj[key] = value;
  touch();
}
function exec(cmd) {
  document.execCommand(cmd, false, null);
}
// Indicateurs
function addKpi() {
  b.value.items.push({ label: 'Nouvel indicateur', value: '—', sub: '' });
  touch();
}
function removeKpi(i) {
  b.value.items.splice(i, 1);
  touch();
}
// Tableau
function addRow() {
  b.value.rows.push(b.value.columns.map(() => ''));
  touch();
}
function removeRow(i) {
  b.value.rows.splice(i, 1);
  touch();
}
function addCol() {
  b.value.columns.push('Colonne');
  b.value.rows.forEach((r) => r.push(''));
  touch();
}
function removeCol(j) {
  b.value.columns.splice(j, 1);
  b.value.rows.forEach((r) => r.splice(j, 1));
  touch();
}
const chartHeight = computed(() => (props.big ? 460 : { S: 220, M: 300, L: 400 }[b.value.size || 'M']));
const canSwitch = computed(() => b.value.type === 'chart' && b.value.spec.kind !== 'hbar');
</script>

<template>
  <div class="rb" :class="[`rb-${b.type}`, { big }]">
    <!-- Titre -->
    <template v-if="b.type === 'heading'">
      <Editable v-if="!readonly" :tag="b.level === 1 ? 'h2' : 'h3'" class="h" :class="`l${b.level || 1}`" :model-value="b.text" placeholder="Titre" @update:model-value="(v) => setField(b, 'text', v)" />
      <component :is="b.level === 1 ? 'h2' : 'h3'" v-else class="h" :class="`l${b.level || 1}`">{{ b.text }}</component>
    </template>

    <!-- Texte riche -->
    <template v-else-if="b.type === 'text'">
      <div v-if="!readonly" class="rt-tools" role="toolbar" aria-label="Mise en forme">
        <button type="button" title="Gras" @mousedown.prevent="exec('bold')"><b>G</b></button>
        <button type="button" title="Italique" @mousedown.prevent="exec('italic')"><i>I</i></button>
        <button type="button" title="Souligné" @mousedown.prevent="exec('underline')"><u>S</u></button>
        <button type="button" title="Liste à puces" @mousedown.prevent="exec('insertUnorderedList')">• Liste</button>
        <button type="button" title="Liste numérotée" @mousedown.prevent="exec('insertOrderedList')">1. Liste</button>
      </div>
      <Editable v-if="!readonly" rich class="text" :model-value="b.html" placeholder="Saisissez votre texte…" @update:model-value="(v) => setField(b, 'html', v)" />
      <div v-else class="text" v-html="sanitizeHtml(b.html)" />
    </template>

    <!-- Indicateurs -->
    <template v-else-if="b.type === 'kpis'">
      <div class="kpi-grid">
        <div v-for="(k, i) in b.items" :key="i" class="kpi">
          <template v-if="!readonly">
            <Editable class="kl" :model-value="k.label" placeholder="Libellé" @update:model-value="(v) => setField(k, 'label', v)" />
            <Editable class="kv" :model-value="k.value" placeholder="Valeur" @update:model-value="(v) => setField(k, 'value', v)" />
            <Editable class="ks" :model-value="k.sub" placeholder="Précision" @update:model-value="(v) => setField(k, 'sub', v)" />
            <button class="kx" title="Retirer" @click="removeKpi(i)">✕</button>
          </template>
          <template v-else>
            <div class="kl">{{ k.label }}</div><div class="kv">{{ k.value }}</div><div class="ks">{{ k.sub }}</div>
          </template>
        </div>
        <button v-if="!readonly && b.items.length < 8" class="kadd" @click="addKpi">＋</button>
      </div>
    </template>

    <!-- Graphique -->
    <template v-else-if="b.type === 'chart'">
      <div class="ch-head">
        <Editable v-if="!readonly" tag="h4" class="ct" :model-value="b.spec.title" placeholder="Titre du graphique" @update:model-value="(v) => setField(b.spec, 'title', v)" />
        <h4 v-else class="ct">{{ b.spec.title }}</h4>
        <div v-if="!readonly" class="ch-tools">
          <div v-if="canSwitch" class="seg">
            <button :class="{ on: b.spec.kind === 'line' }" @click="setField(b.spec, 'kind', 'line')">Courbes</button>
            <button :class="{ on: b.spec.kind === 'bar' }" @click="setField(b.spec, 'kind', 'bar')">Colonnes</button>
          </div>
          <div class="seg" title="Hauteur">
            <button v-for="s in ['S', 'M', 'L']" :key="s" :class="{ on: (b.size || 'M') === s }" @click="setField(b, 'size', s)">{{ s }}</button>
          </div>
        </div>
      </div>
      <Editable v-if="!readonly" class="cs" :model-value="b.spec.subtitle || ''" placeholder="Sous-titre (facultatif)" @update:model-value="(v) => setField(b.spec, 'subtitle', v)" />
      <p v-else-if="b.spec.subtitle" class="cs">{{ b.spec.subtitle }}</p>
      <ChartLegend v-if="b.spec.series?.length > 1" :series="b.spec.series" :kind="b.spec.kind" style="margin: 6px 0" />
      <DataChart :spec="b.spec" :height="chartHeight" />
      <p v-if="b.spec.note" class="note">{{ b.spec.note }}</p>
    </template>

    <!-- Tableau -->
    <template v-else-if="b.type === 'table'">
      <Editable v-if="!readonly" tag="h4" class="ct" :model-value="b.title || ''" placeholder="Titre du tableau" @update:model-value="(v) => setField(b, 'title', v)" />
      <h4 v-else-if="b.title" class="ct">{{ b.title }}</h4>
      <div class="table-wrap">
        <table class="rtable">
          <thead>
            <tr>
              <th v-for="(c, j) in b.columns" :key="j" :class="{ num: j > 0 }">
                <Editable v-if="!readonly" :model-value="c" @update:model-value="(v) => { b.columns[j] = v; touch(); }" />
                <template v-else>{{ c }}</template>
                <button v-if="!readonly && b.columns.length > 1" class="mini-x" title="Supprimer la colonne" @click="removeCol(j)">✕</button>
              </th>
              <th v-if="!readonly" class="tools-col"><button class="mini-add" title="Ajouter une colonne" @click="addCol">＋</button></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in b.rows" :key="i">
              <td v-for="(v, j) in r" :key="j" :class="{ num: j > 0 }">
                <Editable v-if="!readonly" :model-value="String(v ?? '')" @update:model-value="(x) => { r[j] = x; touch(); }" />
                <template v-else>{{ v }}</template>
              </td>
              <td v-if="!readonly" class="tools-col"><button class="mini-x" title="Supprimer la ligne" @click="removeRow(i)">✕</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <button v-if="!readonly" class="btn btn-sm btn-ghost" @click="addRow">＋ Ligne</button>
    </template>

    <!-- Image -->
    <template v-else-if="b.type === 'image'">
      <figure>
        <img :src="b.src" :alt="b.caption || 'Image'" />
        <Editable v-if="!readonly" tag="figcaption" :model-value="b.caption || ''" placeholder="Légende" @update:model-value="(v) => setField(b, 'caption', v)" />
        <figcaption v-else-if="b.caption">{{ b.caption }}</figcaption>
      </figure>
    </template>

    <hr v-else-if="b.type === 'divider'" class="div" />
  </div>
</template>

<style scoped>
.h { margin: 0; }
.h.l1 { font-size: 1.6rem; letter-spacing: -0.015em; padding-top: 8px; border-bottom: 2px solid var(--accent); padding-bottom: 6px; }
.h.l2 { font-size: 1.2rem; }
.big .h.l1 { font-size: 2.6rem; border: 0; }
.big .h.l2 { font-size: 2rem; }
.rt-tools { display: flex; gap: 4px; margin-bottom: 6px; opacity: 0; transition: opacity 0.15s; }
.rb:hover .rt-tools, .rb:focus-within .rt-tools { opacity: 1; }
.rt-tools button { border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 6px; padding: 2px 8px; font: inherit; font-size: 0.78rem; cursor: pointer; }
.text { line-height: 1.65; font-size: 0.98rem; padding: 2px 4px; }
.big .text { font-size: 1.5rem; }
.text :deep(p) { margin: 0 0 10px; }
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
.kpi { position: relative; background: var(--accent-wash); border-radius: 10px; padding: 12px 14px; }
.kl { font-size: 0.8rem; color: var(--text-2); }
.kv { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.01em; }
.big .kv { font-size: 2.4rem; }
.ks { font-size: 0.76rem; color: var(--muted); }
.kx { position: absolute; top: 4px; right: 4px; border: 0; background: none; color: var(--muted); cursor: pointer; opacity: 0; }
.kpi:hover .kx { opacity: 1; }
.kadd { border: 2px dashed var(--border); border-radius: 10px; background: none; color: var(--muted); font-size: 1.4rem; cursor: pointer; min-height: 80px; }
.ch-head { display: flex; justify-content: space-between; gap: 10px; align-items: center; flex-wrap: wrap; }
.ch-tools { display: flex; gap: 6px; opacity: 0; transition: opacity 0.15s; }
.rb:hover .ch-tools { opacity: 1; }
.ct { margin: 0; font-size: 1.02rem; }
.big .ct { font-size: 1.8rem; }
.cs { font-size: 0.84rem; color: var(--text-2); margin: 2px 0 4px; }
.note { font-size: 0.76rem; color: var(--muted); font-style: italic; margin-top: 6px; }
.rtable { font-size: 0.86rem; }
.rtable th { position: relative; }
.tools-col { width: 28px; border: 0; }
.mini-x, .mini-add { border: 0; background: none; color: var(--muted); cursor: pointer; font-size: 0.75rem; }
.mini-x { opacity: 0; }
th:hover .mini-x, tr:hover .mini-x { opacity: 1; }
figure { margin: 0; text-align: center; }
figure img { max-width: 100%; border-radius: 8px; border: 1px solid var(--border); }
figcaption { font-size: 0.84rem; color: var(--text-2); margin-top: 6px; }
.div { border: 0; border-top: 1px dashed var(--axis); margin: 8px 0; }
</style>
