<script setup>
import { onMounted, ref, watch } from 'vue';
import { api } from '../../api.js';
import { useUiStore } from '../../stores/ui.js';
import { INVOICE_STATUS, tone, dateFr, money } from '../../lib/labels.js';

const ui = useUiStore();
const data = ref({ invoices: [], totals: {} });
const f = ref({ status: '', from: '', to: '' });
const error = ref('');
async function load() {
  try { data.value = await api('/admin/invoices', { params: f.value }); } catch (e) { error.value = e.message; }
}
watch(f, load, { deep: true });
onMounted(load);
async function set(i, status) {
  try { await api(`/admin/invoices/${i._id}`, { method: 'PUT', body: { status } }); await load(); } catch (e) { ui.toast(e.message); }
}
</script>

<template>
  <div>
    <div class="page-head"><div><h1>Facturation</h1><p>Pour émettre une facture, ouvrez la fiche de la société.</p></div></div>
    <div class="stat-cards">
      <div class="card"><strong>{{ money(data.totals.emise) }}</strong><span>à encaisser</span></div>
      <div class="card"><strong>{{ money(data.totals.en_retard) }}</strong><span>en retard</span></div>
      <div class="card"><strong>{{ money(data.totals.payee) }}</strong><span>encaissé (sélection)</span></div>
    </div>
    <div class="filters-row">
      <label class="field">État<select v-model="f.status"><option value="">Tous</option><option v-for="(l, k) in INVOICE_STATUS" :key="k" :value="k">{{ l }}</option></select></label>
      <label class="field">Du<input v-model="f.from" type="date" /></label>
      <label class="field">Au<input v-model="f.to" type="date" /></label>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <section class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Numéro</th><th>Société</th><th>Date</th><th class="num">HT</th><th class="num">TTC</th><th>Échéance</th><th>État</th><th /></tr></thead>
          <tbody>
            <tr v-for="i in data.invoices" :key="i._id">
              <td><RouterLink :to="`/equipe/factures/${i._id}`">{{ i.number }}</RouterLink></td>
              <td><RouterLink :to="`/equipe/societes/${i.company?._id}`">{{ i.company?.name }}</RouterLink></td>
              <td>{{ dateFr(i.issueDate) }}</td><td class="num">{{ money(i.totalHT) }}</td><td class="num">{{ money(i.totalTTC) }}</td><td>{{ dateFr(i.dueDate) }}</td>
              <td><span class="pill" :class="tone(i.status)">{{ INVOICE_STATUS[i.status] }}</span></td>
              <td class="num"><template v-if="['emise', 'en_retard'].includes(i.status)"><button class="btn btn-sm" @click="set(i, 'payee')">Payée</button><button class="btn btn-sm btn-ghost btn-danger" @click="set(i, 'annulee')">Annuler</button></template></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!data.invoices.length" class="empty">Aucune facture.</p>
    </section>
  </div>
</template>
