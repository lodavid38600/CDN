import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useFiltersStore } from './stores/filters.js';
import { useMetaStore } from './stores/meta.js';

// Synchronise les filtres avec l'URL (liens partageables) et relance `load` à chaque changement.
export function useFilterSync(load) {
  const filters = useFiltersStore();
  const meta = useMetaStore();
  const route = useRoute();
  const router = useRouter();
  const loading = ref(false);
  const error = ref('');
  let timer;
  let seq = 0;

  async function run() {
    const id = ++seq;
    loading.value = true;
    error.value = '';
    try {
      await load(filters.params);
    } catch (e) {
      if (id === seq) error.value = e.message;
    } finally {
      if (id === seq) loading.value = false;
    }
  }

  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  }

  onMounted(async () => {
    if (Object.keys(route.query).length) filters.fromQuery(route.query);
    try {
      await meta.load();
    } catch (e) {
      error.value = e.message;
    }
    schedule(0);
  });

  watch(
    () => JSON.stringify(filters.params),
    () => {
      router.replace({ query: filters.toQuery() });
      schedule(250);
    }
  );

  // La mesure (valeur / volume / prix) ne recharge rien : elle est seulement mémorisée dans l'URL.
  watch(() => filters.measure, () => router.replace({ query: filters.toQuery() }));

  onBeforeUnmount(() => clearTimeout(timer));

  return { filters, meta, loading, error, reload: run };
}
