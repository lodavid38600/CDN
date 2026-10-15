<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../../api.js';
import { TICKET_STATUS_STAFF, TICKET_CATEGORY, PRIORITY, dateTimeFr } from '../../lib/labels.js';
import TicketThread from '../../components/TicketThread.vue';

const props = defineProps({ id: { type: String, required: true } });
const t = ref(null);
const staff = ref([]);
const reply = ref('');
const internal = ref(false);
const error = ref('');
async function load() {
  try { [t.value, staff.value] = await Promise.all([api(`/admin/tickets/${props.id}`), api('/admin/meta').then((m) => m.staff)]); } catch (e) { error.value = e.message; }
}
async function send() {
  try { t.value = await api(`/admin/tickets/${props.id}/messages`, { method: 'POST', body: { body: reply.value, internal: internal.value } }); reply.value = ''; internal.value = false; } catch (e) { error.value = e.message; }
}
async function set(body) {
  try { t.value = await api(`/admin/tickets/${props.id}`, { method: 'PUT', body }); } catch (e) { error.value = e.message; }
}
onMounted(load);
</script>

<template>
  <div>
    <nav class="crumbs"><RouterLink to="/equipe/tickets">Tickets</RouterLink><span class="sep">›</span><span>#{{ t?.number }}</span></nav>
    <p v-if="error" class="error">{{ error }}</p>
    <template v-if="t">
      <div class="page-head">
        <div>
          <h1>{{ t.subject }}</h1>
          <p><RouterLink :to="`/equipe/societes/${t.company._id}`">{{ t.company.name }}</RouterLink> · {{ t.author?.name }} ({{ t.author?.email }}) · {{ TICKET_CATEGORY[t.category] }} · ouvert le {{ dateTimeFr(t.createdAt) }}</p>
        </div>
      </div>
      <div class="layout">
        <div>
          <TicketThread :messages="t.messages" staff />
          <form class="card reply" @submit.prevent="send">
            <label class="field">{{ internal ? 'Note interne (invisible du client)' : 'Réponse au client' }}<textarea v-model="reply" rows="5" required /></label>
            <div class="actions">
              <label class="chk"><input v-model="internal" type="checkbox" /> Note interne</label>
              <button class="btn btn-primary" :disabled="!reply.trim()">{{ internal ? 'Ajouter la note' : 'Envoyer la réponse' }}</button>
            </div>
          </form>
        </div>
        <aside class="card side">
          <label class="field">État<select :value="t.status" @change="set({ status: $event.target.value })"><option v-for="(l, k) in TICKET_STATUS_STAFF" :key="k" :value="k">{{ l }}</option></select></label>
          <label class="field">Urgence<select :value="t.priority" @change="set({ priority: $event.target.value })"><option v-for="(l, k) in PRIORITY" :key="k" :value="k">{{ l }}</option></select></label>
          <label class="field">Assigné à<select :value="t.assignee?._id || ''" @change="set({ assignee: $event.target.value || null })"><option value="">Personne</option><option v-for="s in staff" :key="s._id" :value="s._id">{{ s.name || s.email }}</option></select></label>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 16px; align-items: start; }
.side { display: grid; gap: 12px; position: sticky; top: 72px; }
.reply { margin-top: 16px; }
.chk { display: inline-flex; gap: 6px; align-items: center; margin-right: auto; font-size: 0.86rem; }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
</style>
