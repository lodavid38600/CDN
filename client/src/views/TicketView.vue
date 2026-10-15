<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api.js';
import { TICKET_STATUS, TICKET_CATEGORY, PRIORITY, tone, dateTimeFr } from '../lib/labels.js';
import TicketThread from '../components/TicketThread.vue';

const props = defineProps({ id: { type: String, required: true } });
const ticket = ref(null);
const reply = ref('');
const error = ref('');
const busy = ref(false);

async function load() {
  try { ticket.value = await api(`/support/tickets/${props.id}`); } catch (e) { error.value = e.message; }
}
async function send() {
  busy.value = true;
  try { ticket.value = await api(`/support/tickets/${props.id}/messages`, { method: 'POST', body: { body: reply.value } }); reply.value = ''; } catch (e) { error.value = e.message; } finally { busy.value = false; }
}
async function close() {
  try { ticket.value = await api(`/support/tickets/${props.id}/close`, { method: 'POST' }); } catch (e) { error.value = e.message; }
}
onMounted(load);
</script>

<template>
  <div>
    <nav class="crumbs"><RouterLink to="/assistance">Assistance</RouterLink><span class="sep">›</span><span>Demande #{{ ticket?.number }}</span></nav>
    <p v-if="error" class="error">{{ error }}</p>
    <template v-if="ticket">
      <div class="page-head">
        <div>
          <h1>{{ ticket.subject }}</h1>
          <p>
            <span class="pill" :class="tone(ticket.status)">{{ TICKET_STATUS[ticket.status] }}</span>
            · {{ TICKET_CATEGORY[ticket.category] }} · urgence {{ PRIORITY[ticket.priority].toLowerCase() }} · ouverte le {{ dateTimeFr(ticket.createdAt) }}
          </p>
        </div>
        <button v-if="ticket.status !== 'ferme'" class="btn" @click="close">Fermer la demande</button>
      </div>
      <TicketThread :messages="ticket.messages" />
      <form v-if="ticket.status !== 'ferme'" class="card reply" @submit.prevent="send">
        <label class="field">Votre réponse<textarea v-model="reply" rows="4" required /></label>
        <div class="actions"><button class="btn btn-primary" :disabled="busy || !reply.trim()">Envoyer</button></div>
      </form>
      <p v-else class="empty">Demande fermée. Pour une nouvelle question, ouvrez une nouvelle demande.</p>
    </template>
  </div>
</template>

<style scoped>
.reply { margin-top: 16px; }
</style>
