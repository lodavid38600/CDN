<script setup>
import { computed, onMounted, ref } from 'vue';
import { api, tokenStore } from '../../api.js';
import { integer } from '../../format.js';
import { useUiStore } from '../../stores/ui.js';
import { NEWS_KIND, dateFr, dateTimeFr } from '../../lib/labels.js';
import Modal from '../../components/Modal.vue';

// Administration du site : état des données et mises à jour, libellés de la nomenclature,
// actualités de la page d'accueil, pays annoncés, bandeau d'information.
const ui = useUiStore();
const tab = ref('donnees');
const status = ref(null);
const news = ref([]);
const coverage = ref([]);
const banner = ref('');
const error = ref('');

async function loadStatus() { status.value = await api('/admin/status').catch((e) => { error.value = e.message; return null; }); }
async function loadNews() { news.value = await api('/admin/news'); }
async function loadCoverage() { coverage.value = await api('/admin/coverage'); }
onMounted(async () => {
  await Promise.all([loadStatus(), loadNews(), loadCoverage()]);
  banner.value = (await api('/home').catch(() => ({}))).banner || '';
});

// --- Données
async function launch(path, body, msg) {
  try { await api(path, { method: 'POST', body }); ui.toast(msg); setTimeout(loadStatus, 4000); } catch (e) { ui.toast(e.message); }
}
const count = (arr, id) => arr?.find((x) => x._id === id)?.n ?? 0;
const links = computed(() => {
  const out = { official: 0, inferred: 0 };
  for (const l of status.value?.links || []) if (l._id.level === 8) out[l._id.source] = l.n;
  return out;
});
const RUN = { success: 'réussie', partial: 'partielle', failed: 'en échec', running: 'en cours' };
const BULK = { processed: 'chargé', failed: 'en échec', missing: 'non publié' };
const SOURCE = { eurostat: 'Eurostat', 'us-census': 'US Census', 'uk-hmrc': 'HMRC', ssb: 'SSB', comtrade: 'UN Comtrade', mirror: 'Miroirs', demo: 'Démonstration' };

// --- Libellés de la nomenclature
const file = ref(null);
const importing = ref(false);
const imported = ref(null);
async function importLabels() {
  if (!file.value) return;
  importing.value = true;
  imported.value = null;
  try {
    const res = await fetch('/api/admin/labels', {
      method: 'POST', body: file.value,
      headers: { Authorization: `Bearer ${tokenStore.get()}`, 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.value.name) },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    imported.value = data;
  } catch (e) { ui.toast(e.message); } finally { importing.value = false; }
}

// --- Actualités
const editing = ref(null);
function editNews(n) { editing.value = n ? { ...n, publishedAt: n.publishedAt?.slice(0, 10) } : { title: '', body: '', kind: 'nouveaute', published: true, publishedAt: new Date().toISOString().slice(0, 10) }; }
async function saveNews() {
  const n = editing.value;
  try {
    await api(n._id ? `/admin/news/${n._id}` : '/admin/news', { method: n._id ? 'PUT' : 'POST', body: n });
    editing.value = null;
    await loadNews();
  } catch (e) { ui.toast(e.message); }
}
async function deleteNews(n) {
  if (!window.confirm(`Supprimer « ${n.title} » ?`)) return;
  await api(`/admin/news/${n._id}`, { method: 'DELETE' });
  await loadNews();
}

// --- Couverture annoncée
const cov = ref({ country: '', status: 'prevu', source: '', eta: '', note: '' });
async function saveCoverage() {
  try { await api(`/admin/coverage/${cov.value.country}`, { method: 'PUT', body: cov.value }); cov.value = { country: '', status: 'prevu', source: '', eta: '', note: '' }; await loadCoverage(); } catch (e) { ui.toast(e.message); }
}
async function removeCoverage(c) { await api(`/admin/coverage/${c.country}`, { method: 'DELETE' }); await loadCoverage(); }

async function saveBanner() {
  try { await api('/admin/settings', { method: 'PUT', body: { banner: banner.value } }); ui.toast(banner.value ? 'Bandeau publié' : 'Bandeau retiré'); } catch (e) { ui.toast(e.message); }
}
</script>

<template>
  <div>
    <div class="page-head"><div><h1>Site et données</h1><p>Réservé aux administrateurs</p></div></div>
    <div class="tabs">
      <button v-for="[k, l] in [['donnees', 'Données'], ['libelles', 'Libellés des produits'], ['actualites', 'Actualités'], ['couverture', 'Pays annoncés'], ['bandeau', 'Bandeau']]" :key="k" :class="{ on: tab === k }" @click="tab = k">{{ l }}</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="tab === 'donnees' && status">
      <section class="card">
        <div class="card-head">
          <div><h2>État des données</h2><p>Version {{ status.version.version }} · actualisées le {{ dateTimeFr(status.version.updatedAt) }}</p></div>
          <div class="row">
            <button class="btn btn-sm" @click="launch('/admin/cubes', {}, 'Reconstruction des tables de synthèse lancée')">Reconstruire les synthèses</button>
            <button class="btn btn-sm" @click="launch('/admin/update', { steps: ['sync'] }, 'Synchronisation de la nomenclature lancée')">Resynchroniser la nomenclature</button>
            <button class="btn btn-sm btn-primary" @click="launch('/admin/update', {}, 'Mise à jour lancée en arrière-plan')">Mettre à jour maintenant</button>
          </div>
        </div>
        <div class="stat-cards">
          <div class="card"><strong>{{ integer(status.flows) }}</strong><span>lignes UE (NC8)</span></div>
          <div class="card"><strong>{{ integer((status.world || []).reduce((s, x) => s + x.n, 0)) }}</strong><span>lignes monde (SH6)</span></div>
          <div class="card"><strong>{{ count(status.codes, 'current') }}</strong><span>codes NC actuels</span></div>
          <div class="card"><strong>{{ count(status.codes, 'obsolete') }}</strong><span>codes remplacés (convertis)</span></div>
          <div class="card"><strong>{{ links.official }} + {{ links.inferred }}</strong><span>correspondances officielles + déduites</span></div>
          <div class="card"><strong>{{ integer(status.rejected) }}</strong><span>lignes en quarantaine (90 j)</span></div>
        </div>
        <p class="hint">
          Mise à jour automatique : {{ status.autoUpdate.enabled ? `activée, toutes les ${status.autoUpdate.intervalHours} h` : 'désactivée (AUTO_UPDATE=true)' }}
          <span v-if="status.cubes"> · tables de synthèse construites le {{ dateTimeFr(status.cubes.builtAt) }} (version {{ status.cubes.version }})</span>
        </p>
      </section>
      <div class="grid grid-2" style="margin-top: 16px">
        <section class="card">
          <h2>Fichiers Eurostat (depuis {{ status.bulk.from }})</h2>
          <table style="margin-top: 8px">
            <tbody>
              <tr v-for="f in status.bulk.files.slice(0, 12)" :key="f._id">
                <td>{{ f.period || f.name }}</td>
                <td><span class="pill" :class="f.status === 'processed' ? 'ok' : f.status === 'failed' ? 'bad' : 'muted'">{{ BULK[f.status] || f.status }}</span></td>
                <td class="num muted">{{ f.status === 'processed' ? `${integer(f.stats?.kept || 0)} lignes · ${dateFr(f.processedAt)}` : f.error }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!status.bulk.files.length" class="hint">Aucun fichier chargé.</p>
        </section>
        <section class="card">
          <h2>Dernières mises à jour</h2>
          <table style="margin-top: 8px">
            <tbody>
              <tr v-for="r in status.runs" :key="r._id">
                <td>{{ dateTimeFr(r.startedAt) }}</td>
                <td><span class="pill" :class="r.status === 'success' ? 'ok' : r.status === 'failed' ? 'bad' : 'warn'">{{ RUN[r.status] || r.status }}</span></td>
                <td class="num muted">{{ r.endedAt ? `${Math.round((new Date(r.endedAt) - new Date(r.startedAt)) / 1000)} s` : '…' }}</td>
              </tr>
            </tbody>
          </table>
          <h3 class="sub">Sources mondiales</h3>
          <table>
            <tbody><tr v-for="w in status.world" :key="w._id"><td>{{ SOURCE[w._id] || w._id }}</td><td class="num">{{ integer(w.n) }} lignes</td></tr></tbody>
          </table>
          <template v-if="status.rejectedReasons.length">
            <h3 class="sub">Motifs de quarantaine</h3>
            <ul class="small"><li v-for="r in status.rejectedReasons" :key="r._id">{{ r._id }} <span class="muted">({{ r.n }})</span></li></ul>
          </template>
        </section>
      </div>
    </template>

    <section v-if="tab === 'libelles'" class="card">
      <h2>Libellés officiels des produits</h2>
      <p class="secondary" style="margin: 6px 0 14px">
        Importez la table annuelle de la nomenclature combinée (NC8) publiée par la douane, ou toute liste « code ; libellé ».
        Formats acceptés : Excel <strong>.xlsx</strong>, CSV, TSV ou texte. Les colonnes sont reconnues automatiquement ;
        si le fichier contient un libellé « autosuffisant », c'est lui qui est retenu. Les clients peuvent ensuite rechercher les produits par mots.
      </p>
      <div class="row">
        <input type="file" accept=".xlsx,.csv,.tsv,.txt" @change="file = $event.target.files[0]" />
        <button class="btn btn-primary" :disabled="!file || importing" @click="importLabels">{{ importing ? 'Import en cours…' : 'Importer' }}</button>
      </div>
      <p v-if="imported" class="ok-box">
        {{ integer(imported.labels) }} libellés importés : {{ imported.byLevel[2] }} chapitres, {{ imported.byLevel[4] }} positions, {{ imported.byLevel[6] }} sous-positions, {{ imported.byLevel[8] }} codes NC8 ·
        {{ integer(imported.productsUpdated) }} produits renommés · index de recherche mis à jour.
      </p>
    </section>

    <section v-if="tab === 'actualites'" class="card">
      <div class="card-head"><div><h2>Actualités</h2><p>Affichées sur la page d'accueil des clients</p></div><button class="btn btn-sm btn-primary" @click="editNews(null)">＋ Nouvelle actualité</button></div>
      <table>
        <tbody>
          <tr v-for="n in news" :key="n._id">
            <td class="muted">{{ dateFr(n.publishedAt) }}</td><td><span class="pill info">{{ NEWS_KIND[n.kind] }}</span></td>
            <td><strong>{{ n.title }}</strong><div class="hint">{{ n.body }}</div></td>
            <td><span class="pill" :class="n.published ? 'ok' : 'muted'">{{ n.published ? 'Publiée' : 'Brouillon' }}</span></td>
            <td class="num"><button class="btn btn-sm btn-ghost" @click="editNews(n)">Modifier</button><button class="btn btn-sm btn-ghost btn-danger" @click="deleteNews(n)">Supprimer</button></td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="tab === 'couverture'" class="card">
      <h2>Pays annoncés</h2>
      <p class="secondary" style="margin: 6px 0 14px">Les pays disponibles sont déduits automatiquement des données. Annoncez ici ceux en cours d'intégration ou prévus : ils apparaissent sur la carte de l'accueil.</p>
      <form class="form-grid" @submit.prevent="saveCoverage">
        <label class="field">Code pays (2 lettres)<input v-model="cov.country" required maxlength="2" placeholder="JP" /></label>
        <label class="field">État<select v-model="cov.status"><option value="en_cours">En cours d'intégration</option><option value="prevu">Prévu</option></select></label>
        <label class="field">Source<input v-model="cov.source" placeholder="Douanes japonaises" /></label>
        <label class="field">Échéance<input v-model="cov.eta" placeholder="T1 2027" /></label>
        <div class="actions wide"><button class="btn btn-primary">Ajouter / modifier</button></div>
      </form>
      <table style="margin-top: 12px">
        <tbody>
          <tr v-for="c in coverage" :key="c.country"><td><strong>{{ c.country }}</strong></td><td>{{ c.status === 'en_cours' ? 'En cours' : 'Prévu' }}</td><td>{{ c.source }}</td><td>{{ c.eta }}</td><td class="num"><button class="btn btn-sm btn-ghost" @click="cov = { ...c }">Modifier</button><button class="btn btn-sm btn-ghost btn-danger" @click="removeCoverage(c)">Retirer</button></td></tr>
        </tbody>
      </table>
    </section>

    <section v-if="tab === 'bandeau'" class="card">
      <h2>Bandeau d'information</h2>
      <p class="secondary" style="margin: 6px 0 14px">Affiché en haut de toutes les pages (maintenance, incident, annonce). Laissez vide pour le retirer.</p>
      <form class="row" @submit.prevent="saveBanner">
        <input v-model="banner" maxlength="300" style="flex: 1; min-width: 280px" placeholder="Ex. Maintenance dimanche de 6 h à 7 h" />
        <button class="btn btn-primary">Enregistrer</button>
      </form>
    </section>

    <Modal v-if="editing" :title="editing._id ? 'Modifier l\'actualité' : 'Nouvelle actualité'" wide @close="editing = null">
      <form class="form-grid" @submit.prevent="saveNews">
        <label class="field wide">Titre<input v-model="editing.title" required maxlength="200" /></label>
        <label class="field">Type<select v-model="editing.kind"><option v-for="(l, k) in NEWS_KIND" :key="k" :value="k">{{ l }}</option></select></label>
        <label class="field">Date de publication<input v-model="editing.publishedAt" type="date" /></label>
        <label class="field">État<select v-model="editing.published"><option :value="true">Publiée</option><option :value="false">Brouillon</option></select></label>
        <label class="field wide">Texte<textarea v-model="editing.body" rows="5" maxlength="5000" /></label>
        <div class="actions wide"><button type="button" class="btn" @click="editing = null">Annuler</button><button class="btn btn-primary">Enregistrer</button></div>
      </form>
    </Modal>
  </div>
</template>

<style scoped>
.sub { font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 14px 0 6px; }
.ok-box { margin-top: 14px; padding: 10px 12px; border-radius: 8px; background: color-mix(in srgb, var(--good) 12%, transparent); }
</style>
