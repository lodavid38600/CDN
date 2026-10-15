<script setup>
import { dateTimeFr } from '../lib/labels.js';

// Fil des messages d'un ticket (les notes internes n'arrivent jamais côté client).
defineProps({ messages: { type: Array, default: () => [] }, staff: Boolean });
</script>

<template>
  <ol class="thread">
    <li v-for="m in messages" :key="m._id" :class="{ team: m.staff, internal: m.internal }">
      <div class="who">
        <strong>{{ m.authorName }}</strong>
        <span v-if="m.staff && !staff" class="badge badge-accent">Équipe DouaneData</span>
        <span v-if="m.internal" class="badge">Note interne · invisible du client</span>
        <span class="muted small">{{ dateTimeFr(m.at) }}</span>
      </div>
      <div class="body">{{ m.body }}</div>
    </li>
  </ol>
</template>

<style scoped>
.thread { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.thread li { padding: 12px 14px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); }
.thread li.team { background: var(--accent-wash); border-color: transparent; }
.thread li.internal { background: color-mix(in srgb, var(--s4) 12%, transparent); border-style: dashed; }
.who { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
.body { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; }
</style>
