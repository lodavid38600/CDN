import { defineStore } from 'pinia';
import { api } from '../api.js';
import { useUiStore } from './ui.js';
import { emptyWidget } from '../lib/widgets.js';

// Tableau de bord personnel : liste des graphiques et fenêtre de création / modification.
export const useDashboardStore = defineStore('dashboard', {
  state: () => ({ widgets: [], loaded: false, draft: null, editingId: null, saving: false }),
  actions: {
    async load() {
      const r = await api('/tableau-de-bord');
      this.widgets = r.widgets;
      this.loaded = true;
    },
    /** Ouvre la fenêtre de création, éventuellement préremplie depuis une page d'analyse. */
    openBuilder(prefill = {}) {
      const base = emptyWidget();
      this.draft = { ...base, ...prefill, params: { ...base.params, ...(prefill.params || {}) } };
      this.editingId = null;
    },
    edit(w) {
      this.draft = JSON.parse(JSON.stringify(w));
      this.editingId = w.id;
    },
    close() {
      this.draft = null;
      this.editingId = null;
    },
    async add(widget) {
      const created = await api('/tableau-de-bord/widgets', { method: 'POST', body: widget });
      if (this.loaded) this.widgets.push(created);
      useUiStore().toast(`« ${created.title} » ajouté au tableau de bord`, { link: '/tableau-de-bord', linkLabel: 'Voir' });
      return created;
    },
    /** Enregistre la liste entière (ordre, tailles, modifications) ; l'affichage change tout de suite. */
    async save(widgets) {
      const previous = this.widgets;
      this.widgets = widgets;
      this.saving = true;
      try {
        this.widgets = (await api('/tableau-de-bord', { method: 'PUT', body: { widgets } })).widgets;
      } catch (e) {
        this.widgets = previous;
        useUiStore().toast(`Enregistrement impossible : ${e.message}`, { tone: 'bad' });
        throw e;
      } finally {
        this.saving = false;
      }
    },
    async replace(id, widget) {
      await this.save(this.widgets.map((w) => (w.id === id ? { ...widget, id } : w)));
    },
    async remove(id) {
      const previous = this.widgets;
      this.widgets = this.widgets.filter((w) => w.id !== id);
      try {
        await api(`/tableau-de-bord/widgets/${encodeURIComponent(id)}`, { method: 'DELETE' });
      } catch (e) {
        this.widgets = previous;
        useUiStore().toast(`Suppression impossible : ${e.message}`, { tone: 'bad' });
      }
    },
  },
});
