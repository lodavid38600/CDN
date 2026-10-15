<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api } from '../api.js';
import { dateTimeFr } from '../lib/labels.js';

// Messagerie instantanée avec l'équipe (client) ou avec une société (équipe).
// Actualisation automatique toutes les 5 secondes.
const props = defineProps({
  endpoint: { type: String, required: true }, // /support/chat ou /admin/chat/:société
  staff: Boolean, // vu par l'équipe
  emptyText: { type: String, default: 'Écrivez-nous : un membre de l\'équipe vous répond ici.' },
});
const messages = ref([]);
const text = ref('');
const sending = ref(false);
const error = ref('');
const list = ref(null);
let timer;

async function load(initial = false) {
  try {
    const last = messages.value.at(-1)?.at;
    const fresh = await api(props.endpoint, { params: initial || !last ? {} : { after: last } });
    if (initial) messages.value = fresh;
    else if (fresh.length) messages.value.push(...fresh.filter((m) => !messages.value.some((x) => x._id === m._id)));
    if (initial || fresh.length) { await nextTick(); list.value?.scrollTo({ top: list.value.scrollHeight }); }
  } catch (e) { error.value = e.message; }
}
async function send() {
  const body = text.value.trim();
  if (!body) return;
  sending.value = true;
  try {
    const m = await api(props.endpoint, { method: 'POST', body: { body } });
    messages.value.push(m);
    text.value = '';
    await nextTick();
    list.value?.scrollTo({ top: list.value.scrollHeight, behavior: 'smooth' });
  } catch (e) { error.value = e.message; } finally { sending.value = false; }
}
const mine = (m) => (props.staff ? m.staff : !m.staff);
onMounted(() => { load(true); timer = setInterval(() => load(), 5000); });
onBeforeUnmount(() => clearInterval(timer));
watch(() => props.endpoint, () => load(true));
</script>

<template>
  <div class="chat">
    <div ref="list" class="msgs" aria-live="polite">
      <p v-if="!messages.length" class="empty">{{ emptyText }}</p>
      <div v-for="m in messages" :key="m._id" class="msg" :class="{ mine: mine(m) }">
        <div class="bubble">{{ m.body }}</div>
        <div class="meta">{{ m.staff && !staff ? `${m.authorName} · équipe DouaneData` : m.authorName }} · {{ dateTimeFr(m.at) }}</div>
      </div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <form class="compose" @submit.prevent="send">
      <textarea v-model="text" rows="2" placeholder="Votre message…" aria-label="Message" @keydown.enter.exact.prevent="send" />
      <button class="btn btn-primary" :disabled="sending || !text.trim()">Envoyer</button>
    </form>
  </div>
</template>

<style scoped>
.chat { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.msgs { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; max-height: 52vh; min-height: 260px; padding: 4px 2px; }
.msg { display: flex; flex-direction: column; align-items: flex-start; max-width: 78%; }
.msg.mine { align-self: flex-end; align-items: flex-end; }
.bubble { padding: 9px 13px; border-radius: 14px 14px 14px 4px; background: var(--surface-2); white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.45; }
.mine .bubble { background: var(--accent); color: var(--accent-ink); border-radius: 14px 14px 4px 14px; }
.meta { font-size: 0.72rem; color: var(--muted); margin-top: 3px; }
.compose { display: flex; gap: 8px; align-items: flex-end; }
.compose textarea { flex: 1; min-height: 44px; }
</style>
