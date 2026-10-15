<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { integer, periodLabel } from '../format.js';
import { useAuthStore } from '../stores/auth.js';
import { useMetaStore } from '../stores/meta.js';
import { useUiStore } from '../stores/ui.js';

const auth = useAuthStore();
const meta = useMetaStore();
const ui = useUiStore();
const status = ref(null);
const launching = ref(false);

async function loadStatus() {
  if (auth.user?.role !== 'admin') return;
  status.value = await api('/admin/status').catch(() => null);
}
onMounted(async () => {
  await auth.fetchMe().catch(() => {});
  meta.load().catch(() => {});
  loadStatus();
});
async function launch(steps) {
  launching.value = true;
  try {
    await api('/admin/update', { method: 'POST', body: steps ? { steps } : {} });
    ui.toast('Mise à jour lancée en arrière-plan');
    setTimeout(loadStatus, 4000);
  } finally {
    launching.value = false;
  }
}
const count = (arr, id) => arr?.find((x) => x._id === id)?.n ?? 0;
const links = computed(() => {
  const out = { official: 0, inferred: 0, manual: 0, implicit: 0 };
  for (const l of status.value?.links || []) if (l._id.level === 8) out[l._id.source] = l.n;
  return out;
});
const STATUS_LABEL = { success: 'réussie', partial: 'partielle', failed: 'en échec', running: 'en cours' };
const SOURCE_LABEL = { eurostat: 'Eurostat', 'us-census': 'US Census', 'uk-hmrc': 'HMRC', ssb: 'SSB', comtrade: 'UN Comtrade', mirror: 'Miroirs' };

const plans = [
  { id: 'free', name: 'Gratuit', price: '0 €', features: ['Tableau de bord, nomenclature, carte et comparateur', 'Rapports et exports PDF / PowerPoint', 'Export CSV limité à 1 000 lignes'] },
  { id: 'pro', name: 'Pro', price: '49 € / mois', features: ['Tout le plan Gratuit', 'Export CSV jusqu\'à 100 000 lignes', 'Prévisions et comparaisons illimitées', 'Accès API (jeton JWT)', 'Support prioritaire'] },
];
</script>

<template>
  <div>
    <div class="page-head"><div><h1>Compte & données</h1><p>Profil, offre, fraîcheur et qualité des données</p></div></div>
    <div class="grid grid-2">
      <section v-if="auth.user" class="card">
        <h2>Profil</h2>
        <dl>
          <dt>E-mail</dt><dd>{{ auth.user.email }}</dd>
          <dt>Nom</dt><dd>{{ auth.user.name || '—' }}</dd>
          <dt>Société</dt><dd>{{ auth.user.company || '—' }}</dd>
          <dt>Offre</dt><dd><span class="badge">{{ auth.user.plan === 'pro' ? 'Pro' : 'Gratuit' }}</span></dd>
        </dl>
      </section>
      <section class="card">
        <h2>Sources</h2>
        <p class="secondary">Les données proviennent de la base <strong>Comext</strong> d'Eurostat (commerce international de marchandises de l'UE, nomenclature combinée à 8 chiffres). Valeurs en euros courants, quantités en kilogrammes. Flux « extra-UE » : échanges des 27 États membres avec les pays tiers.</p>
        <p class="muted">Les données de démonstration sont simulées à partir de codes NC réels ; lancez l'import Eurostat pour charger les données officielles.</p>
      </section>
    </div>
    <section class="card" style="margin-top: 16px">
      <div class="card-head">
        <div>
          <h2>État des données</h2>
          <p>Données disponibles jusqu'à {{ meta.lastPeriod ? periodLabel(meta.lastPeriod) : '…' }} · version {{ meta.data?.version ?? '—' }}<span v-if="meta.data?.updatedAt"> · actualisées le {{ new Date(meta.data.updatedAt).toLocaleString('fr-FR') }}</span></p>
        </div>
        <div v-if="auth.user?.role === 'admin'" class="row">
          <button class="btn btn-sm" :disabled="launching" @click="launch(['sync'])">Resynchroniser la nomenclature</button>
          <button class="btn btn-sm btn-primary" :disabled="launching" @click="launch()">Mettre à jour maintenant</button>
        </div>
      </div>
      <p class="secondary">Les données se mettent à jour automatiquement : nouveaux mois et révisions Eurostat, sources nationales, tables de correspondance de la nomenclature. Les changements de codes NC sont gérés sans intervention : les séries restent continues.</p>

      <template v-if="status">
        <div class="stats">
          <div><strong>{{ integer(status.flows) }}</strong><span>lignes UE (NC8)</span></div>
          <div><strong>{{ integer((status.world || []).reduce((s, x) => s + x.n, 0)) }}</strong><span>lignes monde (SH6)</span></div>
          <div><strong>{{ count(status.codes, 'current') }}</strong><span>codes NC actuels</span></div>
          <div><strong>{{ count(status.codes, 'obsolete') }}</strong><span>codes remplacés (convertis)</span></div>
          <div><strong>{{ links.official }} + {{ links.inferred }}</strong><span>correspondances officielles + déduites</span></div>
          <div><strong>{{ integer(status.rejected) }}</strong><span>lignes en quarantaine (90 j)</span></div>
          <div><strong>{{ integer(status.suspectRows) }}</strong><span>lignes signalées (prix aberrant…)</span></div>
        </div>
        <div class="grid grid-2" style="margin-top: 12px">
          <div>
            <h3>Dernières mises à jour</h3>
            <table>
              <thead><tr><th>Début</th><th>Statut</th><th>Durée</th></tr></thead>
              <tbody>
                <tr v-for="r in status.runs" :key="r._id">
                  <td>{{ new Date(r.startedAt).toLocaleString('fr-FR') }}</td>
                  <td><span class="badge" :class="{ ok: r.status === 'success', ko: r.status === 'failed' }">{{ STATUS_LABEL[r.status] || r.status }}</span></td>
                  <td>{{ r.endedAt ? `${Math.round((new Date(r.endedAt) - new Date(r.startedAt)) / 1000)} s` : '…' }}</td>
                </tr>
                <tr v-if="!status.runs.length"><td colspan="3" class="muted">Aucune mise à jour automatique pour l'instant.</td></tr>
              </tbody>
            </table>
          </div>
          <div>
            <h3>Sources</h3>
            <table>
              <tbody>
                <tr v-for="w in status.world" :key="w._id"><td>{{ SOURCE_LABEL[w._id] || w._id }}</td><td class="num">{{ integer(w.n) }} lignes</td></tr>
              </tbody>
            </table>
            <p class="hint" style="margin-top: 8px">Mise à jour automatique : {{ status.autoUpdate.enabled ? `activée (toutes les ${status.autoUpdate.intervalHours} h, ${status.autoUpdate.months} derniers mois)` : 'désactivée (AUTO_UPDATE=true pour l\'activer)' }}<span v-if="status.autoUpdate.worldSources.length"> · sources : {{ status.autoUpdate.worldSources.join(', ') }}</span></p>
            <template v-if="status.rejectedReasons.length">
              <h3>Motifs de quarantaine</h3>
              <ul class="reasons"><li v-for="r in status.rejectedReasons" :key="r._id">{{ r._id }} <span class="muted">({{ r.n }})</span></li></ul>
            </template>
          </div>
        </div>
      </template>
    </section>

    <h2 style="margin: 24px 0 12px">Offres</h2>
    <div class="grid grid-2">
      <section v-for="p in plans" :key="p.id" class="card plan" :class="{ current: auth.user?.plan === p.id }">
        <div class="card-head"><h2>{{ p.name }}</h2><strong>{{ p.price }}</strong></div>
        <ul><li v-for="f in p.features" :key="f">{{ f }}</li></ul>
        <span v-if="auth.user?.plan === p.id" class="badge">Offre actuelle</span>
      </section>
    </div>
  </div>
</template>

<style scoped>
.stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-top: 14px; }
.stats > div { display: flex; flex-direction: column; background: var(--surface-2); border-radius: 10px; padding: 10px 12px; }
.stats strong { font-size: 1.25rem; }
.stats span { font-size: 0.78rem; color: var(--text-2); }
h3 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 8px 0; }
.badge.ok { color: var(--good); }
.badge.ko { color: var(--bad); }
.reasons { margin: 0; padding-left: 18px; font-size: 0.85rem; }
dl { display: grid; grid-template-columns: 100px 1fr; gap: 8px; margin: 12px 0 0; }
dt { color: var(--muted); }
dd { margin: 0; }
.plan ul { padding-left: 18px; color: var(--text-2); }
.plan.current { border-color: var(--accent); }
</style>
