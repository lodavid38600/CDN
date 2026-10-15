<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { INVOICE_STATUS, tone, dateFr, money } from '../lib/labels.js';

// Facture imprimable (impression → PDF).
const props = defineProps({ id: { type: String, required: true }, staff: Boolean });
const router = useRouter();
const inv = ref(null);
const error = ref('');
onMounted(async () => {
  try { inv.value = await api(props.staff ? `/admin/invoices/${props.id}` : `/invoices/${props.id}`); } catch (e) { error.value = e.message; }
});
const print = () => window.print();
const addr = (a = {}) => [a.line1, a.line2, [a.postalCode, a.city].filter(Boolean).join(' '), a.country].filter(Boolean);
</script>

<template>
  <div class="page">
    <div class="no-print toolbar">
      <button class="btn" @click="router.back()">← Retour</button>
      <button class="btn btn-primary" @click="print">Imprimer / enregistrer en PDF</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <article v-if="inv" class="invoice">
      <header>
        <div>
          <div class="brand"><span class="logo">D</span>{{ inv.seller.name }}</div>
          <div v-if="inv.seller.address" class="small">{{ inv.seller.address }}</div>
          <div v-if="inv.seller.siret" class="small">SIRET {{ inv.seller.siret }}</div>
          <div v-if="inv.seller.vatNumber" class="small">TVA {{ inv.seller.vatNumber }}</div>
          <div v-if="inv.seller.email" class="small">{{ inv.seller.email }}</div>
        </div>
        <div class="right">
          <h1>Facture {{ inv.number }}</h1>
          <div>Date : {{ dateFr(inv.issueDate) }}</div>
          <div>Échéance : {{ dateFr(inv.dueDate) }}</div>
          <span class="pill no-print" :class="tone(inv.status)">{{ INVOICE_STATUS[inv.status] }}</span>
        </div>
      </header>
      <section class="to">
        <div class="lbl">Facturé à</div>
        <strong>{{ inv.billedTo?.legalName || inv.billedTo?.name }}</strong>
        <div v-for="l in addr(inv.billedTo?.address)" :key="l">{{ l }}</div>
        <div v-if="inv.billedTo?.siret">SIRET {{ inv.billedTo.siret }}</div>
        <div v-if="inv.billedTo?.vatNumber">TVA {{ inv.billedTo.vatNumber }}</div>
      </section>
      <p v-if="inv.periodFrom" class="period">Période : {{ dateFr(inv.periodFrom) }} → {{ dateFr(inv.periodTo) }}</p>
      <table>
        <thead><tr><th>Désignation</th><th class="num">Quantité</th><th class="num">Prix unitaire HT</th><th class="num">Total HT</th></tr></thead>
        <tbody>
          <tr v-for="(l, i) in inv.lines" :key="i"><td>{{ l.label }}</td><td class="num">{{ l.quantity }}</td><td class="num">{{ money(l.unitPrice) }}</td><td class="num">{{ money(l.quantity * l.unitPrice) }}</td></tr>
        </tbody>
        <tfoot>
          <tr><td colspan="3" class="num">Total HT</td><td class="num">{{ money(inv.totalHT) }}</td></tr>
          <tr><td colspan="3" class="num">TVA {{ inv.vatRate }} %</td><td class="num">{{ money(inv.totalTVA) }}</td></tr>
          <tr class="ttc"><td colspan="3" class="num">Total TTC</td><td class="num">{{ money(inv.totalTTC) }}</td></tr>
        </tfoot>
      </table>
      <p v-if="inv.status === 'payee'" class="paid">Payée le {{ dateFr(inv.paidAt) }}</p>
      <footer class="small">
        <div v-if="inv.seller.iban">Règlement par virement : IBAN {{ inv.seller.iban }}</div>
        <div>Paiement à réception, au plus tard le {{ dateFr(inv.dueDate) }}. En cas de retard : pénalités au taux légal et indemnité forfaitaire de 40 € pour frais de recouvrement.</div>
      </footer>
    </article>
  </div>
</template>

<style scoped>
.page { max-width: 860px; margin: 0 auto; padding: 24px 16px; }
.toolbar { display: flex; justify-content: space-between; margin-bottom: 16px; }
.invoice { background: #fff; color: #111; border: 1px solid var(--border); border-radius: 12px; padding: 40px; }
header { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 28px; flex-wrap: wrap; }
.right { text-align: right; }
.right h1 { font-size: 1.4rem; margin-bottom: 6px; }
.brand { display: flex; gap: 8px; align-items: center; font-weight: 700; font-size: 1.15rem; margin-bottom: 6px; }
.logo { width: 28px; height: 28px; border-radius: 7px; background: #2a78d6; color: #fff; display: grid; place-items: center; font-size: 0.9rem; }
.to { margin-bottom: 18px; }
.lbl { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #666; margin-bottom: 4px; }
.period { margin-bottom: 12px; color: #444; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 9px 8px; border-bottom: 1px solid #e5e5e5; text-align: left; color: #111; }
tfoot td { border: 0; padding: 5px 8px; }
.ttc td { font-weight: 700; font-size: 1.05rem; border-top: 2px solid #111; }
.paid { margin-top: 16px; color: #006300; font-weight: 700; }
footer { margin-top: 28px; color: #555; display: grid; gap: 4px; }
@media print { .page { padding: 0; max-width: none; } .invoice { border: 0; padding: 0; } }
</style>
