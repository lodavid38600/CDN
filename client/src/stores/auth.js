import { defineStore } from 'pinia';
import { api, tokenStore } from '../api.js';

// Session : utilisateur, société et droits effectifs (hérités de la société).
// L'interface s'en sert pour afficher ou masquer pages et boutons ; le serveur vérifie
// de son côté chaque requête.
export const useAuthStore = defineStore('auth', {
  state: () => ({ user: null, company: null, access: null, token: tokenStore.get(), loaded: false }),
  getters: {
    isAuthenticated: (s) => Boolean(s.token),
    isStaff: (s) => Boolean(s.access?.staffRole),
    can: (s) => (perm) => Boolean(s.access?.perms?.includes(perm)),
    has: (s) => (feature) => Boolean(s.access?.features?.includes(feature)),
    // Accès aux données : abonnement actif (ou équipe)
    dataAccess: (s) => ['active', 'staff'].includes(s.access?.status),
  },
  actions: {
    async login(email, password) {
      this.setSession(await api('/auth/login', { method: 'POST', body: { email, password } }));
      await this.fetchMe();
    },
    async register(payload) {
      this.setSession(await api('/auth/register', { method: 'POST', body: payload }));
      await this.fetchMe();
    },
    async fetchMe() {
      if (!this.token) return;
      const me = await api('/auth/me');
      Object.assign(this, { user: me.user, company: me.company, access: me.access, loaded: true });
    },
    setSession({ token, user }) {
      this.token = token;
      this.user = user;
      tokenStore.set(token);
    },
    logout() {
      Object.assign(this, { token: null, user: null, company: null, access: null, loaded: false });
      tokenStore.set(null);
    },
  },
});
