import { defineStore } from 'pinia';

let nextId = 1;
export const useUiStore = defineStore('ui', {
  state: () => ({ toasts: [] }),
  actions: {
    toast(message, { link, linkLabel, tone = 'info', timeout = 5000 } = {}) {
      const id = nextId++;
      this.toasts.push({ id, message, link, linkLabel, tone });
      setTimeout(() => this.dismiss(id), timeout);
    },
    dismiss(id) {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    },
  },
});
