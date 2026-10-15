<script setup>
import { computed, ref, watch } from 'vue';
import { api } from '../api.js';
import { eur, tonnes, percent, perKg, periodLabel, ncCode, sharePct, periodToBounds } from '../format.js';
import { useReportsStore } from '../stores/reports.js';
import Flag from './Flag.vue';

// Détail des échanges sur un mois (AAAA-MM) ou une année (AAAA), pour les filtres en cours.
const props = defineProps({
  period: { type: String, default: '' },
  params: { type: Object, default: () => ({}) },
  context: { type: String, default: '' },
});
const emit = defineEmits(['close']);
const reports = useReportsStore();

const data = ref(null);
const loading = ref(false);
const error = ref('');
const flowTab = ref('export');

const bounds = computed(() => periodToBounds(props.period));
const singleProduct = computed(() => (props.params.product || '').length === 8);
const title = computed(() => (props.period.length === 4 ? `Année ${props.period}` : periodLabel(props.period).replace(/^./, (c) => c.toUpperCase())));
const isQuarter = computed(() => props.period.includes('-T'));

watch(
  () => [props.period, JSON.stringify(props.params)],
  async () => {
    if (!props.period) return;
    loading.value = true;
    error.value = '';
    try {
      const p = { ...props.params, ...bounds.value, flow: undefined };
      const top = (dimension, flow, limit = 8) => api('/stats/top', { params: { ...p, dimension, flow, limit } });
      const [summary, partnersE, partnersI, reportersE, reportersI, products] = await Promise.all([
        api('/stats/summary', { params: p }),
        top('partner', 'export'), top('partner', 'import'),
        top('reporter', 'export'), top('reporter', 'import'),
        singleProduct.value ? Promise.resolve([]) : top('product', undefined, 6),
      ]);
      data.value = { summary, partners: { export: partnersE, import: partnersI }, reporters: { export: reportersE, import: reportersI }, products };
    } catch (e) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  },
  { immediate: true }
);

const flowKey = computed(() => `${flowTab.value}Eur`);
const sum = (rows) => rows.reduce((s, r) => s + r[flowKey.value], 0);
const prevLabel = computed(() => {
  if (!data.value?.summary.previous) return '';
  if (props.period.length === 4) return String(Number(props.period) - 1);
  if (isQuarter.value) return `T${props.period.slice(-1)} ${Number(props.period.slice(0, 4)) - 1}`;
  return periodLabel(data.value.summary.previous.from);
});

function addToReport() {
  const s = data.value.summary;
  const rows = (list) => list.map((r) => [`${r.label}`, eur(r[flowKey.value]), sharePct(r[flowKey.value] / (sum(list) || 1))]);
  reports.add(
    [
      { type: 'heading', text: `${title.value}${props.context ? ` — ${props.context}` : ''}`, level: 2 },
      {
        type: 'kpis',
        items: [
          { label: 'Importations', value: eur(s.importEur), sub: `${percent(s.changeImport)} vs ${prevLabel.value}` },
          { label: 'Exportations', value: eur(s.exportEur), sub: `${percent(s.changeExport)} vs ${prevLabel.value}` },
          { label: 'Solde', value: eur(s.balanceEur), sub: s.balanceEur >= 0 ? 'Excédent' : 'Déficit' },
          { label: 'Volume exporté', value: tonnes(s.exportKg), sub: `Prix moyen ${perKg(s.exportEur / s.exportKg)}` },
        ],
      },
      { type: 'table', title: `Partenaires hors UE — ${flowTab.value === 'export' ? 'exportations' : 'importations'}`, columns: ['Pays', 'Valeur', 'Part'], rows: rows(data.value.partners[flowTab.value]) },
      { type: 'table', title: `Pays UE déclarants — ${flowTab.value === 'export' ? 'exportations' : 'importations'}`, columns: ['Pays', 'Valeur', 'Part'], rows: rows(data.value.reporters[flowTab.value]) },
    ],
    title.value
  );
}
</script>

<template>
  <div v-if="period" class="overlay drawer-overlay" @click.self="emit('close')" @keydown.esc="emit('close')">
    <aside class="drawer" role="dialog" aria-modal="true" :aria-label="`Détail ${title}`">
      <div class="dh">
        <div>
          <p class="hint">Détail des échanges{{ context ? ` · ${context}` : '' }}</p>
          <h2 class="dt">{{ title }}</h2>
        </div>
        <button class="btn btn-sm btn-icon" aria-label="Fermer" @click="emit('close')">✕</button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <div v-if="data" :class="{ loading }">
        <div class="kp">
          <div class="k"><span class="dot dot-import" />Importations<strong>{{ eur(data.summary.importEur) }}</strong>
            <span :class="data.summary.changeImport >= 0 ? 'up' : 'down'">{{ percent(data.summary.changeImport) }} <span class="muted">vs {{ prevLabel }}</span></span>
            <span class="muted">{{ tonnes(data.summary.importKg) }} · {{ perKg(data.summary.importEur / data.summary.importKg) }}</span>
          </div>
          <div class="k"><span class="dot dot-export" />Exportations<strong>{{ eur(data.summary.exportEur) }}</strong>
            <span :class="data.summary.changeExport >= 0 ? 'up' : 'down'">{{ percent(data.summary.changeExport) }} <span class="muted">vs {{ prevLabel }}</span></span>
            <span class="muted">{{ tonnes(data.summary.exportKg) }} · {{ perKg(data.summary.exportEur / data.summary.exportKg) }}</span>
          </div>
        </div>
        <p class="bal">Solde : <strong :class="data.summary.balanceEur >= 0 ? 'up' : 'down'">{{ data.summary.balanceEur >= 0 ? '+' : '' }}{{ eur(data.summary.balanceEur) }}</strong></p>

        <div class="seg tabs">
          <button :class="{ on: flowTab === 'export' }" @click="flowTab = 'export'">Exportations</button>
          <button :class="{ on: flowTab === 'import' }" @click="flowTab = 'import'">Importations</button>
        </div>

        <h3>Partenaires hors UE</h3>
        <ul class="ranks">
          <li v-for="r in data.partners[flowTab]" :key="r.key">
            <Flag :code="r.key" :size="20" /><span class="n">{{ r.label }}</span>
            <span class="v">{{ eur(r[flowKey]) }}</span>
            <span class="bar"><span :style="{ width: `${(r[flowKey] / (data.partners[flowTab][0]?.[flowKey] || 1)) * 100}%`, background: `var(--${flowTab})` }" /></span>
          </li>
          <li v-if="!data.partners[flowTab].length" class="muted">Aucun échange</li>
        </ul>

        <h3>Pays UE déclarants</h3>
        <ul class="ranks">
          <li v-for="r in data.reporters[flowTab]" :key="r.key">
            <Flag :code="r.key" :size="20" /><span class="n">{{ r.label }}</span>
            <span class="v">{{ eur(r[flowKey]) }}</span>
            <span class="bar"><span :style="{ width: `${(r[flowKey] / (data.reporters[flowTab][0]?.[flowKey] || 1)) * 100}%`, background: `var(--${flowTab})` }" /></span>
          </li>
        </ul>

        <template v-if="data.products.length">
          <h3>Codes NC les plus échangés</h3>
          <ul class="ranks">
            <li v-for="r in data.products" :key="r.key">
              <RouterLink :to="`/produits/${r.key}`" class="nc pc">{{ ncCode(r.key) }}</RouterLink><span class="n">{{ r.label }}</span>
              <span class="v">{{ eur(r.totalEur) }}</span>
            </li>
          </ul>
        </template>

        <div class="row actions">
          <button class="btn btn-primary btn-sm" @click="addToReport">＋ Ajouter au rapport</button>
          <RouterLink class="btn btn-sm" :to="{ path: '/explorer', query: { ...Object.fromEntries(Object.entries(params).filter(([, v]) => v && v.length)), ...bounds } }">Lignes détaillées →</RouterLink>
        </div>
      </div>
      <div v-else-if="loading" class="empty">Chargement…</div>
    </aside>
  </div>
</template>

<style scoped>
.drawer-overlay { display: block; padding: 0; }
.dh { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }
.dt { font-size: 1.35rem; }
.kp { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.k { display: flex; flex-direction: column; gap: 2px; background: var(--surface-2); border-radius: 10px; padding: 10px 12px; font-size: 0.8rem; color: var(--text-2); }
.k strong { font-size: 1.3rem; color: var(--text); }
.bal { margin: 10px 0 14px; font-size: 0.9rem; }
.tabs { margin-bottom: 8px; }
h3 { margin: 14px 0 6px; font-size: 0.82rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.ranks { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.ranks li { display: grid; grid-template-columns: auto 1fr auto; grid-template-rows: auto auto; column-gap: 8px; align-items: center; padding: 5px 4px; font-size: 0.87rem; }
.n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.v { font-variant-numeric: tabular-nums; font-weight: 550; }
.bar { grid-column: 2 / 4; height: 4px; background: var(--surface-3); border-radius: 2px; overflow: hidden; }
.bar span { display: block; height: 100%; border-radius: 2px; }
.pc { font-size: 0.8rem; }
.actions { margin-top: 18px; }
</style>
