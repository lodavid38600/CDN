<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import Loader from '../components/Loader.vue';
import { useUiStore } from '../stores/ui.js';

const router = useRouter();
const list = ref([]);
const error = ref('');
const loading = ref(true);
const removing = ref('');
const creating = ref(false);
const ui = useUiStore();

async function load() {
  try {
    list.value = await api('/reports');
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
async function create() {
  creating.value = true;
  const r = await api('/reports', {
    method: 'POST',
    body: { title: 'Nouveau rapport', blocks: [{ id: 'intro', type: 'text', html: '<p>Rédigez votre introduction ici…</p>' }] },
  });
  router.push(`/rapports/${r._id}`);
  creating.value = false;
}
async function remove(r) {
  if (!window.confirm(`Supprimer définitivement le rapport « ${r.title} » ?`)) return;
  removing.value = r.id;
  try {
    await api(`/reports/${r.id}`, { method: 'DELETE' });
    list.value = list.value.filter((x) => x.id !== r.id);
    ui.toast(`Rapport « ${r.title} » supprimé`);
  } catch (e) {
    error.value = e.message;
  } finally {
    removing.value = '';
  }
}
onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Rapports</h1>
        <p>Assemblez graphiques, cartes, indicateurs et commentaires, puis exportez en PDF ou PowerPoint.</p>
      </div>
      <button class="btn btn-primary" :disabled="creating" @click="create"><span v-if="creating" class="spinner" />＋ Nouveau rapport</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <Loader v-if="loading" text="Chargement de vos rapports…" />
    <div v-else-if="!list.length" class="card onboarding">
      <h2>Créez votre premier rapport</h2>
      <ol>
        <li>Sur une <RouterLink to="/nomenclature">fiche produit</RouterLink> ou une <RouterLink to="/pays">fiche pays</RouterLink>, cliquez sur <strong>📄 Générer un rapport</strong> : tout le contenu de la vue est assemblé en un clic.</li>
        <li>Ou utilisez le menu <strong>⤓</strong> d'un graphique → <strong>Ajouter au rapport…</strong> pour composer bloc par bloc.</li>
        <li>Dans l'éditeur, modifiez les textes, réorganisez les blocs par glisser-déposer, ajoutez vos images, puis exportez.</li>
      </ol>
    </div>

    <div class="cards">
      <article v-for="r in list" :key="r.id" class="card rc" :class="{ loading: removing === r.id }">
        <RouterLink :to="`/rapports/${r.id}`" class="rc-main">
          <div class="thumb" aria-hidden="true"><span /><span /><span class="b" /><span /></div>
          <h2>{{ r.title }}</h2>
          <p class="hint">{{ r.subtitle }}</p>
          <p class="hint">{{ r.blockCount }} blocs · modifié le {{ new Date(r.updatedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) }}</p>
        </RouterLink>
        <div class="row rc-actions">
          <RouterLink :to="`/rapports/${r.id}`" class="btn btn-sm">Ouvrir</RouterLink>
          <button class="btn btn-sm btn-ghost btn-danger" :disabled="removing === r.id" @click="remove(r)">{{ removing === r.id ? 'Suppression…' : 'Supprimer' }}</button>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
.rc { display: flex; flex-direction: column; gap: 10px; }
.rc-main { color: var(--text); display: flex; flex-direction: column; gap: 4px; }
.rc-main:hover { text-decoration: none; }
.rc-main:hover h2 { color: var(--accent); }
.thumb { height: 110px; border-radius: 8px; background: var(--surface-2); padding: 12px; display: grid; gap: 6px; align-content: start; margin-bottom: 6px; }
.thumb span { height: 6px; border-radius: 3px; background: var(--surface-3); }
.thumb span:first-child { width: 60%; height: 10px; background: var(--axis); }
.thumb .b { height: 34px; background: linear-gradient(90deg, var(--s1) 0 30%, var(--s2) 30% 55%, var(--surface-3) 55%); opacity: 0.6; }
.rc-actions { justify-content: space-between; }
.onboarding ol { color: var(--text-2); display: grid; gap: 6px; margin: 10px 0 0; }
</style>
