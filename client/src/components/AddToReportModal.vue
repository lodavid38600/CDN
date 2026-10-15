<script setup>
import { ref, watch } from 'vue';
import { useReportsStore } from '../stores/reports.js';

const reports = useReportsStore();
const newTitle = ref('');
const error = ref('');
watch(() => reports.pending, (p) => { if (p) newTitle.value = reports.pendingLabel ? `Rapport — ${reports.pendingLabel}` : 'Nouveau rapport'; });

async function run(fn) {
  error.value = '';
  try { await fn(); } catch (e) { error.value = e.message; }
}
</script>

<template>
  <div v-if="reports.pending" class="overlay" @click.self="reports.cancel()" @keydown.esc="reports.cancel()">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="atr-title">
      <h2 id="atr-title">Ajouter au rapport</h2>
      <p class="hint" style="margin: 4px 0 14px">{{ reports.pending.length }} bloc{{ reports.pending.length > 1 ? 's' : '' }} à ajouter{{ reports.pendingLabel ? ` · ${reports.pendingLabel}` : '' }}</p>
      <p v-if="error" class="error">{{ error }}</p>
      <div v-if="reports.list.length" class="list">
        <button v-for="r in reports.list" :key="r.id" class="item" :disabled="reports.busy" @click="run(() => reports.addTo(r.id))">
          <span class="t">{{ r.title }}</span>
          <span class="hint">{{ r.blockCount }} blocs · modifié le {{ new Date(r.updatedAt).toLocaleDateString('fr-FR') }}</span>
        </button>
      </div>
      <p v-else class="hint">Aucun rapport pour l'instant.</p>
      <form class="new" @submit.prevent="run(() => reports.createWith(newTitle))">
        <input v-model="newTitle" aria-label="Titre du nouveau rapport" />
        <button class="btn btn-primary" :disabled="reports.busy">Nouveau rapport</button>
      </form>
      <div class="row" style="justify-content: flex-end; margin-top: 12px"><button class="btn btn-sm" @click="reports.cancel()">Annuler</button></div>
    </div>
  </div>
</template>

<style scoped>
.list { display: grid; gap: 6px; max-height: 280px; overflow: auto; margin-bottom: 14px; }
.item { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font: inherit; cursor: pointer; }
.item:hover { border-color: var(--accent); background: var(--accent-wash); }
.t { font-weight: 600; }
.new { display: flex; gap: 8px; margin-top: 8px; }
.new input { flex: 1; }
</style>
