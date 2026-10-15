<script setup>
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../../api.js';
import { TICKET_STATUS_STAFF, TICKET_CATEGORY, PRIORITY, tone, ago } from '../../lib/labels.js';

const route = useRoute();
const router = useRouter();
const tickets = ref([]);
const f = ref({ status: 'actifs', priority: '', assignee: '', q: '', company: route.query.company || '' });
const error = ref('');
let t;
async function load() {
  try { tickets.value = await api('/admin/tickets', { params: f.value }); } catch (e) { error.value = e.message; }
}
watch(() => f.value.q, () => { clearTimeout(t); t = setTimeout(load, 250); });
watch(() => [f.value.status, f.value.priority, f.value.assignee], load);
onMounted(load);
</script>

<template>
  <div>
    <div class="page-head"><div><h1>Tickets</h1><p>{{ tickets.length }} ticket{{ tickets.length > 1 ? 's' : '' }} · les non lus en premier</p></div></div>
    <div class="filters-row">
      <label class="field">Rechercher<input v-model="f.q" placeholder="Objet ou numéro" /></label>
      <label class="field">État<select v-model="f.status"><option value="actifs">À traiter</option><option value="">Tous</option><option v-for="(l, k) in TICKET_STATUS_STAFF" :key="k" :value="k">{{ l }}</option></select></label>
      <label class="field">Urgence<select v-model="f.priority"><option value="">Toutes</option><option v-for="(l, k) in PRIORITY" :key="k" :value="k">{{ l }}</option></select></label>
      <label class="field">Assigné<select v-model="f.assignee"><option value="">Tous</option><option value="moi">À moi</option><option value="personne">Personne</option></select></label>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <section class="card">
      <div class="table-wrap">
        <table class="clickable">
          <thead><tr><th>N°</th><th>Objet</th><th>Société</th><th>Catégorie</th><th>Urgence</th><th>État</th><th>Assigné</th><th>Activité</th></tr></thead>
          <tbody>
            <tr v-for="x in tickets" :key="x._id" :class="{ unread: x.unreadStaff }" @click="router.push(`/equipe/tickets/${x._id}`)">
              <td class="muted">#{{ x.number }}</td>
              <td><strong>{{ x.subject }}</strong><div class="hint">{{ x.author?.name || x.author?.email }}</div></td>
              <td>{{ x.company?.name }}</td>
              <td>{{ TICKET_CATEGORY[x.category] }}</td>
              <td><span class="pill" :class="tone(x.priority)">{{ PRIORITY[x.priority] }}</span></td>
              <td><span class="pill" :class="tone(x.status)">{{ TICKET_STATUS_STAFF[x.status] }}</span></td>
              <td class="muted">{{ x.assignee?.name || '—' }}</td>
              <td class="muted">{{ ago(x.lastActivityAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!tickets.length" class="empty">Aucun ticket.</p>
    </section>
  </div>
</template>

<style scoped>
tr.unread td:nth-child(2) strong::before { content: '● '; color: var(--accent); }
</style>
