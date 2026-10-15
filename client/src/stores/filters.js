import { defineStore } from 'pinia';

const empty = () => ({
  yearFrom: null,
  yearTo: null,
  flow: '',
  reporters: [],
  partners: [],
  sections: [],
  chapters: [],
  product: '',
});

// Filtres partagés entre le tableau de bord et l'explorateur.
export const useFiltersStore = defineStore('filters', {
  state: () => ({ ...empty() }),
  getters: {
    params: (s) => ({
      yearFrom: s.yearFrom, yearTo: s.yearTo, flow: s.flow, reporters: s.reporters,
      partners: s.partners, sections: s.sections, chapters: s.chapters, product: s.product.replace(/\D/g, ''),
    }),
    activeCount: (s) =>
      [s.yearFrom, s.yearTo, s.flow, s.product].filter(Boolean).length +
      [s.reporters, s.partners, s.sections, s.chapters].filter((a) => a.length).length,
  },
  actions: {
    reset() {
      Object.assign(this, empty());
    },
    fromQuery(q) {
      const list = (v) => (v ? String(v).split(',').filter(Boolean) : []);
      Object.assign(this, empty(), {
        yearFrom: q.yearFrom ? Number(q.yearFrom) : null,
        yearTo: q.yearTo ? Number(q.yearTo) : null,
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
