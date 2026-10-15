<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../../api.js';
import { useAuthStore } from '../../stores/auth.js';
import { dateFr, money, ago } from '../../lib/labels.js';

// Tableau de bord de l'équipe : ce qui demande une action aujourd'hui.
const auth = useAuthStore();
const o = ref(null);
const error = ref('');
onMounted(async () => { try { o.value = await api('/admin/overview'); } catch (e) { error.value = e.message; } });
const PLAN = { essai: 'Essai', essentiel: 'Essentiel', pro: 'Pro', entreprise: 'Entreprise' };
</script>

<template>
  <div>
    <div class="page-head"><div><h1>Tableau de bord de l'équipe</h1><p>Ce qui demande votre attention</p></div></div>
    <p v-if="error" class="error">{{ error }}</p>
    <template v-if="o">
      <div class="stat-cards">
        <RouterLink v-if="auth.can('support.manage')" to="/equipe/tickets" class="card"><strong>{{ o.tickets }}</strong><span>tickets ouverts · {{ o.urgentTickets }} urgents ou prioritaires</span></RouterLink>
        <RouterLink v-if="auth.can('support.manage')" to="/equipe/chat" class="card"><strong>{{ o.unreadChat }}</strong><span>messages non lus</span></RouterLink>
        <RouterLink v-if="auth.can('invoices.manage')" to="/equipe/factures" class="card"><strong>{{ money(o.overdue.total) }}</strong><span>{{ o.overdue.n }} facture{{ o.overdue.n > 1 ? 's' : '' }} en retard</span></RouterLink>
        <RouterLink v-if="auth.can('invoices.manage')" to="/equipe/factures" class="card"><strong>{{ money(o.due.total) }}</strong><span>à encaisser ({{ o.due.n }} facture{{ o.due.n > 1 ? 's' : '' }})</span></RouterLink>
        <RouterLink to="/equipe/societes" class="card"><strong>{{ o.companies }}</strong><span>sociétés actives</span></RouterLink>
        <div class="card"><strong>{{ money(o.mrr) }}</strong><span>revenu mensuel récurrent (HT)</span></div>
        <RouterLink v-if="o.securityEvents24h !== null" to="/equipe/journal" class="card"><strong>{{ o.securityEvents24h }}</strong><span>événements de sécurité (24 h)</span></RouterLink>
      </div>
      <div class="grid grid-2">
        <section class="card">
          <div class="card-head"><div><h2>Abonnements qui arrivent à échéance</h2><p>Dans les 30 prochains jours</p></div></div>
          <table>
            <tbody>
              <tr v-for="c in o.expiring" :key="c._id"><td><RouterLink :to="`/equipe/societes/${c._id}`">{{ c.name }}</RouterLink></td><td>{{ PLAN[c.plan] }}</td><td class="num">{{ dateFr(c.subscription.end) }}</td></tr>
            </tbody>
          </table>
          <p v-if="!o.expiring.length" class="hint">Aucune échéance proche.</p>
        </section>
        <section class="card">
          <div class="card-head"><div><h2>Nouvelles sociétés</h2><p>30 derniers jours</p></div></div>
          <table>
            <tbody>
              <tr v-for="c in o.signups" :key="c._id"><td><RouterLink :to="`/equipe/societes/${c._id}`">{{ c.name }}</RouterLink></td><td>{{ PLAN[c.plan] }}</td><td class="num muted">{{ ago(c.createdAt) }}</td></tr>
            </tbody>
          </table>
          <p v-if="!o.signups.length" class="hint">Aucune nouvelle société.</p>
          <p class="hint" style="margin-top: 10px">Répartition : <span v-for="(n, p) in o.byPlan" :key="p">{{ PLAN[p] }} {{ n }} · </span></p>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.stat-cards a.card { color: var(--text); }
.stat-cards a.card:hover { text-decoration: none; border-color: var(--accent); }
</style>
