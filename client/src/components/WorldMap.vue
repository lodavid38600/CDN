<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { geoNaturalEarth1, geoPath, geoCentroid, geoArea } from 'd3-geo';
import { feature } from 'topojson-client';
import Flag from './Flag.vue';
import { ALPHA2_BY_NUMERIC } from '../lib/countries.js';

// Carte choroplèthe des pays couverts : couleur séquentielle (échelle logarithmique)
// selon `values` ; les pays de l'UE (déclarants) peuvent être mis en évidence.
const props = defineProps({
  values: { type: Object, default: () => ({}) }, // { FR: 123, US: 456 }
  details: { type: Object, default: () => ({}) }, // { FR: { name, lines: ['Import : …'] } }
  selected: { type: String, default: '' },
  highlight: { type: Array, default: () => [] }, // codes entourés (ex. pays UE)
  height: { type: Number, default: 460 },
  formatter: { type: Function, default: (v) => String(v) },
});
const emit = defineEmits(['select']);

const W = 960;
const H = 500;
const features = shallowRef([]);
const hover = ref(null);
const tip = ref({ x: 0, y: 0 });
const box = ref(null);
const ramp = ref([]);
const nodata = ref('#e8e7e2');

const LIGHT_RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

function readRamp() {
  const cs = getComputedStyle(document.documentElement);
  ramp.value = [1, 2, 3, 4, 5, 6, 7].map((i) => cs.getPropertyValue(`--q${i}`).trim());
  nodata.value = cs.getPropertyValue('--nodata').trim();
}
const onTheme = () => requestAnimationFrame(readRamp);
const mq = window.matchMedia('(prefers-color-scheme: dark)');

onMounted(async () => {
  readRamp();
  window.addEventListener('themechange', onTheme);
  mq.addEventListener('change', onTheme);
  const topo = (await import('world-atlas/countries-50m.json')).default;
  features.value = feature(topo, topo.objects.countries).features.filter((f) => f.id !== '010'); // sans l'Antarctique
});
onBeforeUnmount(() => {
  window.removeEventListener('themechange', onTheme);
  mq.removeEventListener('change', onTheme);
});

const projection = computed(() => {
  const p = geoNaturalEarth1();
  if (features.value.length) p.fitExtent([[4, 4], [W - 4, H - 4]], { type: 'FeatureCollection', features: features.value });
  return p;
});
const pathGen = computed(() => geoPath(projection.value));

const domain = computed(() => {
  const v = Object.values(props.values).filter((x) => x > 0);
  if (!v.length) return null;
  return { min: Math.log10(Math.min(...v)), max: Math.log10(Math.max(...v)) };
});
function step(v) {
  if (!domain.value || !(v > 0)) return -1;
  const { min, max } = domain.value;
  const t = max === min ? 1 : (Math.log10(v) - min) / (max - min);
  return Math.min(6, Math.floor(t * 7));
}
const fillFor = (code, colors = ramp.value, none = nodata.value) => {
  const s = step(props.values[code]);
  return s < 0 ? none : colors[s];
};

const shapes = computed(() =>
  features.value.map((f) => {
    const code = ALPHA2_BY_NUMERIC[f.id] || null;
    return { id: f.id, code, d: pathGen.value(f), name: f.properties.name };
  })
);
// Petits pays (Malte, Luxembourg, Singapour…) : un repère cliquable en plus du tracé.
const markers = computed(() =>
  features.value
    .filter((f) => ALPHA2_BY_NUMERIC[f.id] && props.values[ALPHA2_BY_NUMERIC[f.id]] > 0 && geoArea(f) < 0.0004)
    .map((f) => {
      const [x, y] = projection.value(geoCentroid(f));
      return { code: ALPHA2_BY_NUMERIC[f.id], x, y };
    })
);

const legend = computed(() => {
  if (!domain.value) return [];
  const { min, max } = domain.value;
  return [0, 2, 4, 6].map((i) => ({ step: i, value: 10 ** (min + ((max - min) * (i + 0.5)) / 7) }));
});

function move(e, code) {
  if (!box.value) return;
  const r = box.value.getBoundingClientRect();
  tip.value = { x: e.clientX - r.left, y: e.clientY - r.top };
  hover.value = code;
}

/** Image PNG de la carte (thème clair) pour les rapports et exports. */
async function toImage(scale = 2) {
  const paths = shapes.value
    .map((s) => {
      const stroke = props.highlight.includes(s.code) ? '#52514e' : '#ffffff';
      return `<path d="${s.d}" fill="${s.code ? fillFor(s.code, LIGHT_RAMP, '#e8e7e2') : '#efeeea'}" stroke="${stroke}" stroke-width="0.6"/>`;
    })
    .join('');
  const dots = markers.value.map((m) => `<circle cx="${m.x}" cy="${m.y}" r="4" fill="${fillFor(m.code, LIGHT_RAMP, '#e8e7e2')}" stroke="#52514e" stroke-width="1"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#ffffff"/>${paths}${dots}</svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = Object.assign(document.createElement('canvas'), { width: W * scale, height: H * scale });
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, W * scale, H * scale);
  return canvas.toDataURL('image/png');
}
defineExpose({ toImage });
</script>

<template>
  <div ref="box" class="wm" :style="{ height: `${height}px` }" @mouseleave="hover = null">
    <div v-if="!features.length" class="wm-loading">Chargement de la carte…</div>
    <svg v-else :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Carte des pays couverts">
      <g>
        <path
          v-for="s in shapes" :key="s.id" :d="s.d"
          :fill="s.code ? fillFor(s.code) : 'var(--surface-2)'"
          :class="{ covered: s.code, sel: s.code && s.code === selected, hl: s.code && highlight.includes(s.code), hov: s.code && s.code === hover }"
          :tabindex="s.code ? 0 : -1"
          :aria-label="s.code ? s.name : undefined"
          @mousemove="s.code && move($event, s.code)"
          @focus="s.code && (hover = s.code)"
          @click="s.code && emit('select', s.code)"
          @keydown.enter="s.code && emit('select', s.code)"
        />
      </g>
      <circle
        v-for="m in markers" :key="m.code" :cx="m.x" :cy="m.y" r="5" :fill="fillFor(m.code)" class="marker"
        :class="{ sel: m.code === selected }" @mousemove="move($event, m.code)" @click="emit('select', m.code)"
      />
    </svg>

    <div v-if="hover && (details[hover] || values[hover] !== undefined)" class="tip" :style="{ left: `${tip.x + 14}px`, top: `${tip.y + 14}px` }">
      <div class="tip-h"><Flag :code="hover" :size="20" /> <strong>{{ details[hover]?.name || hover }}</strong></div>
      <div v-if="details[hover]?.lines" class="tip-l"><div v-for="l in details[hover].lines" :key="l">{{ l }}</div></div>
      <div v-else class="tip-l">{{ formatter(values[hover] || 0) }}</div>
      <div class="hint">Cliquer pour le détail</div>
    </div>

    <div v-if="legend.length" class="wm-legend" aria-hidden="true">
      <span class="hint">Faible</span>
      <span v-for="i in 7" :key="i" class="sw" :style="{ background: ramp[i - 1] }" />
      <span class="hint">Fort</span>
      <span class="sw" :style="{ background: nodata, marginLeft: '10px' }" /><span class="hint">Sans donnée</span>
    </div>
  </div>
</template>

<style scoped>
.wm { position: relative; width: 100%; }
.wm svg { width: 100%; height: 100%; display: block; }
.wm-loading { display: grid; place-items: center; height: 100%; color: var(--muted); }
path { stroke: var(--surface); stroke-width: 0.5; transition: opacity 0.15s; }
path.covered { cursor: pointer; }
path.covered:hover, path.hov { stroke: var(--text); stroke-width: 1; }
path.hl { stroke: var(--text-2); stroke-width: 0.8; }
path.sel { stroke: var(--accent); stroke-width: 2; }
path:focus { outline: none; stroke: var(--accent); stroke-width: 1.5; }
.marker { stroke: var(--text-2); stroke-width: 1; cursor: pointer; }
.marker.sel { stroke: var(--accent); stroke-width: 2.5; }
.tip {
  position: absolute; pointer-events: none; z-index: 5; background: var(--surface); border: 1px solid var(--axis);
  border-radius: 8px; padding: 8px 10px; box-shadow: var(--shadow-pop); font-size: 0.82rem; min-width: 170px;
}
.tip-h { display: flex; gap: 6px; align-items: center; margin-bottom: 4px; }
.tip-l { font-variant-numeric: tabular-nums; }
.wm-legend { position: absolute; left: 8px; bottom: 6px; display: flex; gap: 2px; align-items: center; background: color-mix(in srgb, var(--surface) 85%, transparent); padding: 4px 8px; border-radius: 6px; }
.sw { width: 18px; height: 10px; border-radius: 2px; display: inline-block; }
.wm-legend .hint { margin: 0 4px; }
</style>
