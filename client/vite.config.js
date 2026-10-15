import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  build: {
    // Les drapeaux restent des fichiers séparés, chargés seulement s'ils sont affichés.
    assetsInlineLimit: (file) => (file.includes('flag-icons') ? false : undefined),
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000' },
  },
});
