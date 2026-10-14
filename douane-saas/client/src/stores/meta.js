import { defineStore } from 'pinia';
import { api } from '../api.js';

// Référentiels : années disponibles, pays, nomenclature (sections / chapitres).
export const useMetaStore = defineStore('meta', {
  state: () => ({ years: [], reporters: [], partners: [], sections: [], loaded: false }),
  getters: {
    countryName: (s) => (code) => [...s.reporters, ...s.partners].find((c) => c.code === code)?.name || code,
    chapters: (s) => s.sections.flatMap((sec) => sec.chapters.map((c) => ({ ...c, section: sec.code }))),
  },
  actions: {
    async load() {
      if (this.loaded) return;
      Object.assign(this, await api('/meta'), { loaded: true });
    },
  },
});
