import { defineStore } from 'pinia';

const empty = () => ({
  periodFrom: '',
  periodTo: '',
  flow: '',
  reporters: [],
  partners: [],
  sections: [],
  chapters: [],
  product: '',
});

// Filtres partagés entre les vues d'analyse (synchronisés avec l'URL).
export const useFiltersStore = defineStore('filters', {
  state: () => ({ ...empty() }),
  getters: {
    params: (s) => ({
      periodFrom: s.periodFrom, periodTo: s.periodTo, flow: s.flow, reporters: s.reporters,
      partners: s.partners, sections: s.sections, chapters: s.chapters, product: s.product.replace(/\D/g, ''),
    }),
    activeCount: (s) =>
      [s.periodFrom || s.periodTo, s.flow, s.product].filter(Boolean).length +
      [s.reporters, s.partners, s.sections, s.chapters].filter((a) => a.length).length,
  },
  actions: {
    reset() {
      Object.assign(this, empty());
    },
    fromQuery(q) {
      const list = (v) => (v ? String(v).split(',').filter(Boolean) : []);
      Object.assign(this, empty(), {
        periodFrom: q.periodFrom || '',
        periodTo: q.periodTo || '',
        flow: q.flow || '',
        reporters: list(q.reporters),
        partners: list(q.partners),
        sections: list(q.sections),
        chapters: list(q.chapters),
        product: q.product || '',
      });
    },
    toQuery() {
      const out = {};
      for (const [k, v] of Object.entries(this.params)) {
        if (v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
        out[k] = Array.isArray(v) ? v.join(',') : String(v);
      }
      return out;
    },
  },
});
