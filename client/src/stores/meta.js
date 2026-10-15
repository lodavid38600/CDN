import { defineStore } from 'pinia';
import { api } from '../api.js';

let pending = null;

// Référentiels : années disponibles, pays, nomenclature (sections / chapitres).
export const useMetaStore = defineStore('meta', {
  state: () => ({ years: [], firstPeriod: null, lastPeriod: null, reporters: [], partners: [], worldCountries: [], sources: [], world: null, data: null, sections: [], loaded: false }),
  getters: {
    countryName: (s) => (code) => [...s.reporters, ...s.partners, ...s.worldCountries].find((c) => c.code === code)?.name || code,
    country: (s) => (code) => [...s.reporters, ...s.partners, ...s.worldCountries].find((c) => c.code === code),
    euCodes: (s) => new Set(s.reporters.map((c) => c.code)),
    chapters: (s) => s.sections.flatMap((sec) => sec.chapters.map((c) => ({ ...c, section: sec.code }))),
  },
  actions: {
    async load() {
      if (this.loaded) return;
      // Une seule requête même si plusieurs vues la demandent en même temps
      pending ??= api('/meta').then((m) => Object.assign(this, m, { loaded: true })).finally(() => { pending = null; });
      await pending;
    },
  },
});
