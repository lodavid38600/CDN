import { defineStore } from 'pinia';
import { api } from '../api.js';
import { useUiStore } from './ui.js';

const uid = () => Math.random().toString(36).slice(2, 10);
export const withIds = (blocks) => blocks.map((b) => ({ ...b, id: b.id || uid() }));

// Ajout de blocs à un rapport depuis n'importe quelle vue (fenêtre de choix du rapport).
export const useReportsStore = defineStore('reports', {
  state: () => ({ pending: null, pendingLabel: '', list: [], busy: false }),
  actions: {
    add(blocks, label = '') {
      this.pending = withIds(blocks);
      this.pendingLabel = label;
      this.fetchList();
    },
    cancel() {
      this.pending = null;
    },
    async fetchList() {
      this.list = await api('/reports');
    },
    async addTo(reportId) {
      const ui = useUiStore();
      this.busy = true;
      try {
        await api(`/reports/${reportId}/blocks`, { method: 'POST', body: { blocks: this.pending } });
        const r = this.list.find((x) => x.id === reportId);
        ui.toast(`Ajouté au rapport « ${r?.title || ''} »`, { link: `/rapports/${reportId}`, linkLabel: 'Ouvrir' });
        this.pending = null;
      } finally {
        this.busy = false;
      }
    },
    async createWith(title) {
      const ui = useUiStore();
      this.busy = true;
      try {
        const r = await api('/reports', { method: 'POST', body: { title: title || 'Nouveau rapport', blocks: this.pending } });
        ui.toast(`Rapport « ${r.title} » créé`, { link: `/rapports/${r._id}`, linkLabel: 'Ouvrir' });
        this.pending = null;
        return r;
      } finally {
        this.busy = false;
      }
    },
    /** Création directe d'un rapport complet (bouton « Générer un rapport »). */
    async generate(title, subtitle, blocks) {
      return api('/reports', { method: 'POST', body: { title, subtitle, blocks: withIds(blocks) } });
    },
  },
});
