<script setup>
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { useAuthStore } from '../stores/auth.js';
import { TICKET_STATUS, TICKET_CATEGORY, PRIORITY, tone, ago } from '../lib/labels.js';
import Modal from '../components/Modal.vue';
import ChatBox from '../components/ChatBox.vue';

// Assistance : tickets (suivi d'une demande) et messagerie instantanée avec l'équipe.
const auth = useAuthStore();
const router = useRouter();
const tab = ref('tickets');
const filter = ref('ouverts');
const tickets = ref([]);
const loading = ref(false);
const error = ref('');
const creating = ref(false);
const form = ref({ subject: '', category: 'question', priority: 'normale', body: '' });

async function load() {
  loading.value = true;
  try { tickets.value = await api('/support/tickets', { params: { status: filter.value } }); } catch (e) { error.value = e.message; } finally { loading.value = false; }
}
async function create() {
  try {
    const t = await api('/support/tickets', { method: 'POST', body: form.value });
    creating.value = false;
    router.push(`/assistance/tickets/${t.id}`);
  } catch (e) { error.value = e.message; }
}
watch(filter, load);
onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>Assistance</h1>
        <p>Une question sur les données, votre abonnement ou l'outil ? Notre équipe vous répond.</p>
      </div>
      <button class="btn btn-primary" @click="creating = true">＋ Nouvelle demande</button>
    </div>
    <div class="tabs" role="tablist">
      <button :class="{ on: tab === 'tickets' }" role="tab" @click="tab = 'tickets'">Mes demandes</button>
      <button :class="{ on: tab === 'chat' }" role="tab" @click="tab = 'chat'">Messagerie instantanée</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <section v-if="tab === 'tickets'" class="card">
      <div class="card-head">
        <div><h2>{{ auth.can('company.manage') ? 'Demandes de votre société' : 'Vos demandes' }}</h2><p>Le suivi de chaque demande, du dépôt à la résolution</p></div>
        <div class="seg">
          <button :class="{ on: filter === 'ouverts' }" @click="filter = 'ouverts'">En cours</button>
          <button :class="{ on: filter === 'fermes' }" @click="filter = 'fermes'">Terminées</button>
          <button :class="{ on: filter === '' }" @click="filter = ''">Toutes</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="clickable">
          <thead><tr><th>N°</th><th>Objet</th><th>Catégorie</th><th>État</th><th>Ouverte par</th><th>Dernière activité</th></tr></thead>
          <tbody>
            <tr v-for="t in tickets" :key="t.id" @click="router.push(`/assistance/tickets/${t.id}`)">
              <td class="muted">#{{ t.number }}</td>
              <td><strong>{{ t.subject }}</strong> <span v-if="t.unreadClient" class="pill info">Nouvelle réponse</span></td>
              <td>{{ TICKET_CATEGORY[t.category] }}</td>
              <td><span class="pill" :class="tone(t.status)">{{ TICKET_STATUS[t.status] }}</span></td>
              <td>{{ t.author?.name || t.author?.email }}</td>
              <td class="muted">{{ ago(t.lastActivityAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!loading && !tickets.length" class="empty">Aucune demande pour l'instant.</p>
    </section>

    <section v-else class="card">
      <div class="card-head"><div><h2>Messagerie instantanée</h2><p>Pour une question rapide. Réponse en général dans l'heure, aux heures ouvrées.</p></div></div>
      <ChatBox endpoint="/support/chat" />
    </section>

    <Modal v-if="creating" title="Nouvelle demande" wide @close="creating = false">
      <form class="form-grid" @submit.prevent="create">
        <label class="field wide">Objet<input v-model="form.subject" required maxlength="200" placeholder="En une phrase" /></label>
        <label class="field">Catégorie<select v-model="form.category"><option v-for="(l, k) in TICKET_CATEGORY" :key="k" :value="k">{{ l }}</option></select></label>
        <label class="field">Urgence<select v-model="form.priority"><option v-for="(l, k) in PRIORITY" :key="k" :value="k">{{ l }}</option></select></label>
        <label class="field wide">Message<textarea v-model="form.body" required rows="6" placeholder="Décrivez votre demande : code NC, pays, période concernés…" /></label>
        <div class="actions wide"><button type="button" class="btn" @click="creating = false">Annuler</button><button class="btn btn-primary">Envoyer</button></div>
      </form>
    </Modal>
  </div>
</template>
