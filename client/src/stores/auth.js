import { defineStore } from 'pinia';
import { api, tokenStore } from '../api.js';

export const useAuthStore = defineStore('auth', {
  state: () => ({ user: null, token: tokenStore.get() }),
  getters: {
    isAuthenticated: (s) => Boolean(s.token),
  },
  actions: {
    async login(email, password) {
      this.setSession(await api('/auth/login', { method: 'POST', body: { email, password } }));
    },
    async register(payload) {
      this.setSession(await api('/auth/register', { method: 'POST', body: payload }));
    },
    async fetchMe() {
      if (!this.token) return;
      this.user = (await api('/auth/me')).user;
    },
    setSession({ token, user }) {
      this.token = token;
      this.user = user;
      tokenStore.set(token);
    },
    logout() {
      this.token = null;
      this.user = null;
      tokenStore.set(null);
    },
  },
});
