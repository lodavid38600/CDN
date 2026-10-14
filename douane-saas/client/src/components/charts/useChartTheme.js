import { onBeforeUnmount, onMounted, reactive } from 'vue';

const VARS = { text: '--text', text2: '--text-2', muted: '--muted', grid: '--grid', axis: '--axis', surface: '--surface', import: '--import', export: '--export' };

// Couleurs des graphiques lues depuis les variables CSS : suit le thème clair / sombre.
export function useChartTheme() {
  const theme = reactive({});
  const read = () => {
    const cs = getComputedStyle(document.documentElement);
    for (const [k, v] of Object.entries(VARS)) theme[k] = cs.getPropertyValue(v).trim();
  };
  read();
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const update = () => requestAnimationFrame(read);
  onMounted(() => {
    window.addEventListener('themechange', update);
    mq.addEventListener('change', update);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('themechange', update);
    mq.removeEventListener('change', update);
  });
  return theme;
}

export const compactEur = (v) => `${new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(v)} €`;
export const compactT = (v) => `${new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(v / 1000)} t`;
