<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api } from '../api.js';
import { withIds } from '../stores/reports.js';
import { useUiStore } from '../stores/ui.js';
import { sanitizeHtml } from '../lib/sanitize.js';
import { exportPptx } from '../lib/pptx.js';
import Editable from '../components/Editable.vue';
import ReportBlock from '../components/ReportBlock.vue';

// Éditeur de rapport : blocs modifiables sur place, glisser-déposer, sauvegarde automatique,
// mode présentation plein écran, export PDF (impression) et PowerPoint.
const props = defineProps({ id: { type: String, required: true } });
const ui = useUiStore();

const report = ref(null);
const error = ref('');
const status = ref('saved'); // saved | dirty | saving | error
const insertAt = ref(-1);
const dragFrom = ref(-1);
const dragOver = ref(-1);
const presenting = ref(false);
const slide = ref(0);
const exporting = ref(false);
const fileInput = ref(null);
let pendingImageIndex = -1;
let saveTimer;
let lastRemoved = null;

async function load() {
  try {
    const r = await api(`/reports/${props.id}`);
    r.blocks = withIds(r.blocks || []);
    report.value = r;
  } catch (e) {
    error.value = e.message;
  }
}
onMounted(load);

async function save() {
  if (!report.value) return;
  status.value = 'saving';
  try {
    const blocks = report.value.blocks.map((b) => (b.type === 'text' ? { ...b, html: sanitizeHtml(b.html) } : b));
    await api(`/reports/${props.id}`, { method: 'PUT', body: { title: report.value.title, subtitle: report.value.subtitle, blocks } });
    status.value = 'saved';
  } catch (e) {
    status.value = 'error';
    error.value = e.message;
  }
}
function changed() {
  status.value = 'dirty';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 800);
}
watch(() => report.value && [report.value.title, report.value.subtitle], (n, o) => { if (o) changed(); });
const onUnload = (e) => {
  if (status.value !== 'saved') {
    e.preventDefault();
    e.returnValue = '';
  }
};
onMounted(() => window.addEventListener('beforeunload', onUnload));
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onUnload);
  if (status.value === 'dirty') save();
});

// ---- Opérations sur les blocs ----
const blocks = computed(() => report.value?.blocks || []);
const uid = () => Math.random().toString(36).slice(2, 10);
const TEMPLATES = {
  heading: () => ({ type: 'heading', text: 'Nouveau titre', level: 1 }),
  subheading: () => ({ type: 'heading', text: 'Sous-titre', level: 2 }),
  text: () => ({ type: 'text', html: '<p>Votre texte…</p>' }),
  kpis: () => ({ type: 'kpis', items: [{ label: 'Indicateur', value: '0', sub: '' }, { label: 'Indicateur', value: '0', sub: '' }, { label: 'Indicateur', value: '0', sub: '' }] }),
  table: () => ({ type: 'table', title: 'Tableau', columns: ['Libellé', 'Valeur'], rows: [['', ''], ['', '']] }),
  divider: () => ({ type: 'divider' }),
};
function insert(kind, at) {
  if (kind === 'image') {
    pendingImageIndex = at;
    fileInput.value.click();
    insertAt.value = -1;
    return;
  }
  report.value.blocks.splice(at, 0, { ...TEMPLATES[kind](), id: uid() });
  insertAt.value = -1;
  changed();
}
function move(i, d) {
  const j = i + d;
  if (j < 0 || j >= blocks.value.length) return;
  const arr = report.value.blocks;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  changed();
}
function duplicate(i) {
  report.value.blocks.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(blocks.value[i])), id: uid() });
  changed();
}
function remove(i) {
  lastRemoved = { block: blocks.value[i], index: i };
  report.value.blocks.splice(i, 1);
  changed();
  ui.toast('Bloc supprimé', { timeout: 6000 });
}
function undo() {
  if (!lastRemoved) return;
  report.value.blocks.splice(lastRemoved.index, 0, lastRemoved.block);
  lastRemoved = null;
  changed();
}
function onKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && lastRemoved && !e.target.isContentEditable) {
    e.preventDefault();
    undo();
  }
  if (presenting.value) {
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); slide.value = Math.min(slides.value.length - 1, slide.value + 1); }
    if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); slide.value = Math.max(0, slide.value - 1); }
    if (e.key === 'Escape') stopPresent();
  }
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

// Glisser-déposer
function onDragStart(i, e) {
  dragFrom.value = i;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(i));
}
function onDrop(i) {
  const from = dragFrom.value;
  if (from < 0 || from === i) return reset();
  const [b] = report.value.blocks.splice(from, 1);
  report.value.blocks.splice(from < i ? i - 1 : i, 0, b);
  changed();
  reset();
}
function reset() {
  dragFrom.value = -1;
  dragOver.value = -1;
}

// Images importées (réduites à 1600 px de large)
async function onFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file || !file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  const scale = Math.min(1, 1600 / img.naturalWidth);
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale) });
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  const src = file.type === 'image/png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85);
  report.value.blocks.splice(pendingImageIndex, 0, { id: uid(), type: 'image', src, caption: file.name.replace(/\.[^.]+$/, '') });
  changed();
}

// ---- Exports ----
// L'impression se fait toujours en thème clair (graphiques redessinés avant l'impression).
async function printPdf() {
  const root = document.documentElement;
  const prev = root.getAttribute('data-theme');
  root.setAttribute('data-theme', 'light');
  window.dispatchEvent(new Event('themechange'));
  await new Promise((r) => setTimeout(r, 450));
  window.print();
  if (prev) root.setAttribute('data-theme', prev);
  else root.removeAttribute('data-theme');
  window.dispatchEvent(new Event('themechange'));
}
async function pptx() {
  exporting.value = true;
  try {
    if (status.value !== 'saved') await save();
    await exportPptx(report.value);
  } catch (e) {
    error.value = `Export PowerPoint impossible : ${e.message}`;
  } finally {
    exporting.value = false;
  }
}

// ---- Présentation : une diapositive par bloc (les titres de niveau 2 rejoignent le bloc suivant) ----
const slides = computed(() => {
  const out = [{ cover: true }];
  let carry = null;
  for (const b of blocks.value) {
    if (b.type === 'divider') continue;
    if (b.type === 'heading' && b.level === 2) { carry = b; continue; }
    out.push({ blocks: carry ? [carry, b] : [b] });
    carry = null;
  }
  if (carry) out.push({ blocks: [carry] });
  return out;
});
async function present() {
  slide.value = 0;
  presenting.value = true;
  try { await document.documentElement.requestFullscreen?.(); } catch { /* plein écran facultatif */ }
}
function stopPresent() {
  presenting.value = false;
  if (document.fullscreenElement) document.exitFullscreen?.();
}

const statusLabel = computed(() => ({ saved: 'Enregistré', dirty: 'Modifications…', saving: 'Enregistrement…', error: 'Erreur d\'enregistrement' })[status.value]);
const today = new Date().toLocaleDateString('fr-FR', { dateStyle: 'long' });
const INSERTS = [
  ['heading', 'Titre'], ['subheading', 'Sous-titre'], ['text', 'Texte'], ['kpis', 'Indicateurs'],
  ['table', 'Tableau'], ['image', 'Image…'], ['divider', 'Séparateur'],
];
</script>

<template>
  <div class="editor">
    <div class="ed-bar no-print">
      <RouterLink to="/rapports" class="btn btn-sm btn-ghost">← Rapports</RouterLink>
      <span class="status" :class="status">{{ statusLabel }}</span>
      <div class="spacer" />
      <button v-if="lastRemoved" class="btn btn-sm" @click="undo">↶ Annuler la suppression</button>
      <button class="btn btn-sm" :disabled="!report" @click="present">▶ Présenter</button>
      <button class="btn btn-sm" :disabled="!report" @click="printPdf">Exporter en PDF</button>
      <button class="btn btn-sm btn-primary" :disabled="!report || exporting" @click="pptx">{{ exporting ? 'Export…' : 'Exporter en PowerPoint' }}</button>
    </div>
    <p v-if="error" class="error no-print">{{ error }}</p>
    <input ref="fileInput" type="file" accept="image/*" hidden @change="onFile" />

    <article v-if="report" class="page">
      <header class="cover">
        <Editable tag="h1" class="rtitle" :model-value="report.title" placeholder="Titre du rapport" @update:model-value="(v) => (report.title = v)" />
        <Editable class="rsub" :model-value="report.subtitle" placeholder="Sous-titre ou périmètre" @update:model-value="(v) => (report.subtitle = v)" />
        <p class="hint">{{ today }} · DouaneData — Source : Eurostat Comext</p>
      </header>

      <div class="blocks">
        <template v-for="(b, i) in blocks" :key="b.id">
          <div class="ins no-print" :class="{ open: insertAt === i }">
            <button class="ins-btn" title="Insérer un bloc ici" @click="insertAt = insertAt === i ? -1 : i">＋</button>
            <div v-if="insertAt === i" class="ins-menu">
              <button v-for="[k, l] in INSERTS" :key="k" class="chip" @click="insert(k, i)">{{ l }}</button>
            </div>
          </div>
          <section
            class="blk" :class="{ dragging: dragFrom === i, over: dragOver === i && dragFrom !== i }"
            @dragover.prevent="dragOver = i" @drop.prevent="onDrop(i)" @dragend="reset"
          >
            <div class="blk-tools no-print">
              <span class="handle" draggable="true" title="Glisser pour déplacer" @dragstart="onDragStart(i, $event)">⋮⋮</span>
              <button title="Monter" :disabled="i === 0" @click="move(i, -1)">↑</button>
              <button title="Descendre" :disabled="i === blocks.length - 1" @click="move(i, 1)">↓</button>
              <button v-if="b.type === 'heading'" title="Niveau du titre" @click="b.level = b.level === 1 ? 2 : 1; changed()">H{{ b.level || 1 }}</button>
              <button title="Dupliquer" @click="duplicate(i)">⧉</button>
              <button title="Supprimer" class="del" @click="remove(i)">✕</button>
            </div>
            <ReportBlock :block="b" @change="changed" />
          </section>
        </template>
        <div class="ins no-print open-end">
          <div class="ins-menu always">
            <span class="hint">Ajouter :</span>
            <button v-for="[k, l] in INSERTS" :key="k" class="chip" @click="insert(k, blocks.length)">{{ l }}</button>
          </div>
          <p class="hint">Astuce : depuis n'importe quel graphique de l'application, menu ⤓ → « Ajouter au rapport… ».</p>
        </div>
      </div>
    </article>

    <!-- Mode présentation -->
    <div v-if="presenting && report" class="present" @click.self="slide = Math.min(slides.length - 1, slide + 1)">
      <div class="slide">
        <template v-if="slides[slide].cover">
          <div class="s-cover">
            <h1>{{ report.title }}</h1>
            <p>{{ report.subtitle }}</p>
            <p class="hint">{{ today }} · Source : Eurostat Comext</p>
          </div>
        </template>
        <template v-else>
          <ReportBlock v-for="b in slides[slide].blocks" :key="b.id" :block="b" readonly big />
        </template>
      </div>
      <div class="p-bar">
        <button class="btn btn-sm" :disabled="slide === 0" @click="slide--">←</button>
        <span>{{ slide + 1 }} / {{ slides.length }}</span>
        <button class="btn btn-sm" :disabled="slide === slides.length - 1" @click="slide++">→</button>
        <button class="btn btn-sm" @click="stopPresent">Quitter (Échap)</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ed-bar { position: sticky; top: 56px; z-index: 20; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 10px 0; background: var(--page); margin-bottom: 8px; }
.status { font-size: 0.8rem; color: var(--muted); }
.status.saved::before { content: '✓ '; color: var(--good); }
.status.error { color: var(--bad); }
.page { max-width: 920px; margin: 0 auto; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; box-shadow: var(--shadow); padding: 56px 64px 64px; }
.cover { border-bottom: 1px solid var(--grid); padding-bottom: 20px; margin-bottom: 18px; }
.rtitle { font-size: 2.1rem; letter-spacing: -0.02em; margin: 0 0 6px; }
.rsub { font-size: 1.1rem; color: var(--text-2); margin-bottom: 8px; }
.blocks { display: flex; flex-direction: column; }
.blk { position: relative; padding: 10px 8px; margin: 0 -8px; border-radius: 8px; border: 1px solid transparent; }
.blk:hover { border-color: var(--border); }
.blk.dragging { opacity: 0.4; }
.blk.over { border-top: 3px solid var(--accent); }
.blk-tools { position: absolute; left: -54px; top: 8px; display: flex; flex-direction: column; gap: 2px; opacity: 0; transition: opacity 0.12s; }
.blk:hover .blk-tools, .blk:focus-within .blk-tools { opacity: 1; }
.blk-tools button, .handle {
  width: 30px; height: 26px; border: 1px solid var(--border); background: var(--surface); color: var(--text-2); border-radius: 6px;
  font-size: 0.78rem; cursor: pointer; display: grid; place-items: center; user-select: none;
}
.handle { cursor: grab; letter-spacing: -2px; }
.blk-tools .del:hover { color: var(--bad); }
.ins { position: relative; height: 14px; display: flex; align-items: center; justify-content: center; }
.ins-btn { width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--border); background: var(--surface); color: var(--muted); cursor: pointer; opacity: 0; transition: opacity 0.12s; z-index: 2; }
.ins:hover .ins-btn, .ins.open .ins-btn { opacity: 1; }
.ins::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; border-top: 1px dashed transparent; }
.ins:hover::before { border-color: var(--axis); }
.ins-menu { position: absolute; top: 20px; z-index: 5; display: flex; flex-wrap: wrap; gap: 6px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow-pop); padding: 8px; }
.ins-menu.always { position: static; box-shadow: none; border-style: dashed; align-items: center; }
.open-end { height: auto; flex-direction: column; gap: 8px; margin-top: 24px; }
@media (max-width: 1100px) { .blk-tools { left: auto; right: 4px; top: -14px; flex-direction: row; } }
@media (max-width: 700px) { .page { padding: 24px 16px; } }

.present { position: fixed; inset: 0; z-index: 100; background: var(--page); display: flex; flex-direction: column; }
.slide { flex: 1; overflow: auto; padding: 5vh 7vw; display: flex; flex-direction: column; justify-content: center; gap: 24px; }
.s-cover h1 { font-size: 3.4rem; letter-spacing: -0.03em; }
.s-cover p { font-size: 1.4rem; color: var(--text-2); margin-top: 12px; }
.p-bar { display: flex; gap: 10px; justify-content: center; align-items: center; padding: 10px; border-top: 1px solid var(--grid); background: var(--surface); }
</style>

<style>
/* Impression / PDF : seule la page du rapport est imprimée. */
@media print {
  @page { size: A4; margin: 14mm; }
  .topbar, .sidebar, .no-print, .toasts { display: none !important; }
  .layout { display: block !important; }
  .content { padding: 0 !important; max-width: none !important; }
  .page { border: 0 !important; box-shadow: none !important; padding: 0 !important; max-width: none !important; }
  .blk { break-inside: avoid; border: 0 !important; }
  .blk-tools, .rt-tools, .ch-tools, .kx, .kadd, .mini-x, .mini-add, .rb .btn, .tools-col { display: none !important; }
  :root { --page: #fff !important; --surface: #fff !important; }
  body { background: #fff !important; }
  .editable { box-shadow: none !important; }
  .editable:empty::before { content: '' !important; }
  .h.l1 { break-before: auto; }
}
</style>
