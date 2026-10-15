<script setup>
import { computed } from 'vue';
import { ncCode, sharePct } from '../format.js';

// Bandeau d'évolution de la nomenclature : code remplacé, code créé, et ce que l'outil fait
// automatiquement des chiffres (série harmonisée). Rien à régler pour l'utilisateur.
const props = defineProps({
  history: { type: Object, default: null },
  code: { type: String, required: true },
  raw: Boolean, // affichage des codes tels que déclarés
});
const emit = defineEmits(['update:raw']);
const h = computed(() => props.history);
const link = (c) => (c.length === 8 ? `/produits/${c}` : `/nomenclature/${c}`);
const yearOf = (list) => Math.min(...list.map((x) => x.year));
</script>

<template>
  <div v-if="h && h.changed" class="nch" :class="h.status === 'obsolete' ? 'warn' : 'info'" role="note">
    <div class="ico" aria-hidden="true">{{ h.status === 'obsolete' ? '↪' : '⟲' }}</div>
    <div class="body">
      <template v-if="h.status === 'obsolete' && h.successors.length">
        <strong>Code remplacé en {{ yearOf(h.successors) }}.</strong>
        Ses marchandises sont désormais déclarées sous
        <template v-for="(s, i) in h.successors" :key="s.code">
          <RouterLink :to="link(s.code)" class="nc">{{ ncCode(s.code) }}</RouterLink><span v-if="s.share !== null" class="muted"> ({{ sharePct(s.share) }})</span>{{ i < h.successors.length - 1 ? ', ' : '' }}
        </template>.
        <span class="muted">Les chiffres après {{ yearOf(h.successors) - 1 }} suivent sa part estimée dans ces nouveaux codes.</span>
      </template>
      <template v-else-if="h.predecessors.length">
        <strong>Code créé en {{ yearOf(h.predecessors) }}.</strong>
        Avant, ces marchandises étaient déclarées sous
        <template v-for="(p, i) in h.predecessors" :key="p.code">
          <RouterLink :to="link(p.code)" class="nc">{{ ncCode(p.code) }}</RouterLink><span v-if="p.share !== null" class="muted"> (part reprise : {{ sharePct(p.share) }})</span>{{ i < h.predecessors.length - 1 ? ', ' : '' }}
        </template>.
        <span class="muted">L'historique est reconstitué automatiquement pour une série continue.</span>
      </template>
      <span v-if="h.predecessors.concat(h.successors).some((x) => x.source === 'inferred')" class="badge">correspondance déduite des données</span>
    </div>
    <label class="raw" title="Afficher les chiffres tels que déclarés, sans reconstitution">
      <input type="checkbox" :checked="raw" @change="emit('update:raw', $event.target.checked)" /> Codes déclarés
    </label>
  </div>
</template>

<style scoped>
.nch { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border-radius: 10px; margin-bottom: 14px; font-size: 0.9rem; border: 1px solid var(--border); }
.nch.info { background: var(--accent-wash); }
.nch.warn { background: color-mix(in srgb, var(--s4) 16%, transparent); }
.ico { font-size: 1.3rem; line-height: 1; }
.body { flex: 1; line-height: 1.5; }
.nc { font-weight: 600; }
.raw { display: flex; gap: 6px; align-items: center; font-size: 0.8rem; color: var(--text-2); white-space: nowrap; }
.badge { margin-left: 6px; }
</style>
