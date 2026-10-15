<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api.js';
import { INVOICE_STATUS, tone, dateFr, money } from '../lib/labels.js';

const invoices = ref([]);
const error = ref('');
onMounted(async () => { try { invoices.value = await api('/invoices'); } catch (e) { error.value = e.message; } });
</script>

<template>
  <div>
    <div class="page-head"><div><h1>Factures</h1><p>Toutes les factures de votre société, à consulter ou imprimer en PDF</p></div></div>
    <p v-if="error" class="error">{{ error }}</p>
    <section class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Numéro</th><th>Date</th><th>Période</th><th class="num">Montant TTC</th><th>Échéance</th><th>État</th><th /></tr></thead>
          <tbody>
            <tr v-for="i in invoices" :key="i._id">
              <td><strong>{{ i.number }}</strong></td>
              <td>{{ dateFr(i.issueDate) }}</td>
              <td class="muted">{{ i.periodFrom ? `${dateFr(i.periodFrom)} → ${dateFr(i.periodTo)}` : '—' }}</td>
              <td class="num">{{ money(i.totalTTC) }}</td>
              <td>{{ dateFr(i.dueDate) }}</td>
              <td><span class="pill" :class="tone(i.status)">{{ INVOICE_STATUS[i.status] }}</span></td>
              <td class="num"><RouterLink :to="`/factures/${i._id}`" class="btn btn-sm">Voir / PDF</RouterLink></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!invoices.length && !error" class="empty">Aucune facture pour l'instant.</p>
    </section>
  </div>
</template>
