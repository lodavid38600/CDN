<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../../api.js';
import { ago } from '../../lib/labels.js';
import ChatBox from '../../components/ChatBox.vue';

// Messagerie : une conversation par société, les non lues en premier.
const threads = ref([]);
const current = ref(null);
let timer;
async function load() {
  threads.value = await api('/admin/chat').catch(() => threads.value);
  if (!current.value && threads.value.length) current.value = threads.value[0];
}
function open(t) { current.value = t; t.unreadStaff = 0; }
onMounted(() => { load(); timer = setInterval(load, 10000); });
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <div>
    <div class="page-head"><div><h1>Messagerie</h1><p>Conversations instantanées avec les sociétés clientes</p></div></div>
    <div class="layout">
      <aside class="card list">
        <button v-for="t in threads" :key="t._id" class="thread" :class="{ on: current?._id === t._id }" @click="open(t)">
          <span class="row"><strong>{{ t.company?.name }}</strong><span v-if="t.unreadStaff" class="count">{{ t.unreadStaff }}</span></span>
          <span class="last">{{ t.lastMessage }}</span>
          <span class="hint">{{ ago(t.lastMessageAt) }}</span>
        </button>
        <p v-if="!threads.length" class="hint">Aucune conversation.</p>
      </aside>
      <section v-if="current" class="card">
        <div class="card-head"><div><h2>{{ current.company?.name }}</h2></div><RouterLink :to="`/equipe/societes/${current.company?._id}`" class="btn btn-sm">Fiche société</RouterLink></div>
        <ChatBox :key="current._id" :endpoint="`/admin/chat/${current.company?._id}`" staff empty-text="Aucun message." />
      </section>
    </div>
  </div>
</template>

<style scoped>
.layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 16px; align-items: start; }
.list { display: grid; gap: 4px; padding: 8px; max-height: 75vh; overflow-y: auto; }
.thread { display: grid; gap: 2px; text-align: left; padding: 10px; border-radius: 10px; border: 0; background: none; font: inherit; color: var(--text); cursor: pointer; }
.thread:hover, .thread.on { background: var(--surface-2); }
.thread .row { justify-content: space-between; }
.last { font-size: 0.84rem; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.count { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: var(--accent); color: var(--accent-ink); font-size: 0.72rem; font-weight: 700; display: grid; place-items: center; }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
</style>
