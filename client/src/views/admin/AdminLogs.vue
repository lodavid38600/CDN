<script setup>
import { onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../../api.js';
import { LOG_LEVEL, LOG_CATEGORY, tone, dateTimeFr } from '../../lib/labels.js';

// Journal d'activité : qui a fait quoi, quand. Filtrable et exportable.
const route = useRoute();
const f = ref({ q: '', category: '', level: '', actor: '', company: route.query.company || '', from: '', to: '' });
const page = ref(1);
const data = ref({ rows: [], total: 0, pages: 0 });
const open = ref(null);
const error = ref('');
let t;
async function load() {
  try { data.value = await api('/admin/logs', { params: { ...f.value, page: page.value, limit: 50 } }); } catch (e) { error.value = e.message; }
}
watch(() => [f.value.q, f.value.actor], () => { clearTimeout(t); t = setTimeout(() => { page.value = 1; load(); }, 300); });
watch(() => [f.value.category, f.value.level, f.value.from, f.value.to, f.value.company], () => { page.value = 1; load(); });
watch(page, load);
onMounted(load);
async function exportCsv() {
  const res = await api('/admin/logs/export.csv', { params: f.value, raw: true });
  const url = URL.createObjectURL(await res.blob());
  Object.assign(document.createElement('a'), { href: url, download: 'journal.csv' }).click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>Journal d'activité</h1><p>{{ new Intl.NumberFormat('fr-FR').format(data.total) }} événements · conservés un an</p></div>
      <button class="btn" @click="exportCsv">Exporter en CSV</button>
    </div>
    <div class="filters-row">
      <label class="field">Rechercher<input v-model="f.q" placeholder="Message, action, objet…" /></label>
      <label class="field">Catégorie<select v-model="f.category"><option value="">Toutes</option><option v-for="(l, k) in LOG_CATEGORY" :key="k" :value="k">{{ l }}</option></select></label>
      <label class="field">Niveau<select v-model="f.level"><option value="">Tous</option><option v-for="(l, k) in LOG_LEVEL" :key="k" :value="k">{{ l }}</option></select></label>
      <label class="field">Utilisateur<input v-model="f.actor" placeholder="E-mail" /></label>
      <label class="field">Du<input v-model="f.from" type="date" /></label>
      <label class="field">Au<input v-model="f.to" type="date" /></label>
      <button v-if="f.company" class="btn btn-sm" @click="f.company = ''">Toutes les sociétés ✕</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <section class="card">
      <div class="table-wrap">
        <table class="clickable">
          <thead><tr><th>Date</th><th>Niveau</th><th>Catégorie</th><th>Événement</th><th>Utilisateur</th><th>Société</th><th>Adresse IP</th></tr></thead>
          <tbody>
            <template v-for="r in data.rows" :key="r._id">
              <tr @click="open = open === r._id ? null : r._id">
                <td class="nowrap">{{ dateTimeFr(r.at) }}</td>
                <td><span class="pill" :class="tone(r.level)">{{ LOG_LEVEL[r.level] }}</span></td>
                <td>{{ LOG_CATEGORY[r.category] || r.category }}</td>
                <td>{{ r.message || r.action }}<div class="hint mono">{{ r.action }}{{ r.target ? ` · ${r.target}` : '' }}</div></td>
                <td>{{ r.actorEmail || 'système' }}</td>
                <td><RouterLink v-if="r.company" :to="`/equipe/societes/${r.company._id}`">{{ r.company.name }}</RouterLink></td>
                <td class="muted mono">{{ r.ip }}</td>
              </tr>
              <tr v-if="open === r._id && r.details" class="det"><td colspan="7"><pre>{{ JSON.stringify(r.details, null, 2) }}</pre></td></tr>
            </template>
          </tbody>
        </table>
      </div>
      <p v-if="!data.rows.length" class="empty">Aucun événement pour ces critères.</p>
      <div v-if="data.pages > 1" class="pager">
        <button class="btn btn-sm" :disabled="page <= 1" @click="page--">‹ Précédent</button>
        <span class="hint">Page {{ page }} / {{ data.pages }}</span>
        <button class="btn btn-sm" :disabled="page >= data.pages" @click="page++">Suivant ›</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.nowrap { white-space: nowrap; }
.det td { background: var(--surface-2); }
pre { margin: 0; font-size: 0.78rem; white-space: pre-wrap; }
.pager { display: flex; gap: 12px; justify-content: center; align-items: center; margin-top: 12px; }
</style>
