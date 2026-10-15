// Construction des graphiques Chart.js à partir d'une « spec » sérialisable.
// La même spec sert à l'affichage, à l'export PNG, aux rapports et au PowerPoint.
//
// spec = {
//   kind: 'line' | 'bar' | 'hbar', title, subtitle, note,
//   labels: string[], unit: 'eur' | 'kg' | 'eurkg' | 'index' | 'pct',
//   series: [{ name, color: 'import'|'export'|1..8, values: number[], dashed?, band?: { low, high } }],
//   stacked?: boolean,
// }
import {
  Chart, LineController, BarController, LineElement, PointElement, BarElement,
  LinearScale, CategoryScale, Tooltip, Filler,
} from 'chart.js';
import { eur, tonnes, perKg } from '../format.js';

Chart.register(LineController, BarController, LineElement, PointElement, BarElement, LinearScale, CategoryScale, Tooltip, Filler);

const LIGHT = {
  text: '#0b0b0b', text2: '#52514e', muted: '#7a7873', grid: '#e1e0d9', axis: '#c3c2b7', surface: '#fcfcfb',
  s: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
};

/** Couleurs courantes (variables CSS), ou thème clair fixe pour les exports. */
export function readTheme(fixed) {
  if (fixed === 'light') return LIGHT;
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return {
    text: v('--text'), text2: v('--text-2'), muted: v('--muted'), grid: v('--grid'), axis: v('--axis'), surface: v('--surface'),
    s: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--s${i}`)),
  };
}

export function seriesColor(color, theme) {
  if (color === 'import') return theme.s[0];
  if (color === 'export') return theme.s[1];
  return theme.s[((Number(color) || 1) - 1) % 8];
}

export function unitFormatter(unit) {
  if (unit === 'kg') return (v) => tonnes(v);
  if (unit === 'eurkg') return (v) => perKg(v);
  if (unit === 'index') return (v) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(v);
  if (unit === 'pct') return (v) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(v)} %`;
  return (v) => eur(v);
}

function alpha(hex, a) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`;
}

/** Config Chart.js. `onPick(index)` est appelé au clic sur un point / une colonne. */
export function buildConfig(spec, theme, { onPick, interactive = true, fontScale = 1 } = {}) {
  const fmt = unitFormatter(spec.unit);
  const horizontal = spec.kind === 'hbar';
  const type = spec.kind === 'line' ? 'line' : 'bar';
  const datasets = [];

  for (const s of spec.series || []) {
    const color = seriesColor(s.color, theme);
    if (s.band && type === 'line') {
      // Intervalle de confiance : deux courbes invisibles, l'aire entre elles est remplie.
      datasets.push({ label: `${s.name} (bas)`, data: s.band.low, borderWidth: 0, pointRadius: 0, pointHitRadius: 0, fill: false, isBand: true });
      datasets.push({ label: `${s.name} (haut)`, data: s.band.high, borderWidth: 0, pointRadius: 0, pointHitRadius: 0, backgroundColor: alpha(color, 0.14), fill: '-1', isBand: true });
    }
    datasets.push(
      type === 'line'
        ? {
            label: s.name, data: s.values, borderColor: color, backgroundColor: color, borderWidth: 2,
            borderDash: s.dashed ? [6, 4] : undefined, pointRadius: (spec.labels?.length || 0) > 40 ? 0 : 3,
            pointHoverRadius: 6, pointHitRadius: 12, pointBorderColor: theme.surface, pointBorderWidth: 2, tension: 0.25, spanGaps: false,
          }
        : {
            label: s.name, data: s.values, backgroundColor: s.dashed ? alpha(color, 0.45) : color, borderRadius: 4,
            borderSkipped: 'start', borderColor: theme.surface, borderWidth: horizontal ? { top: 1, bottom: 1 } : { left: 1, right: 1 },
            barPercentage: 0.9, categoryPercentage: (spec.series || []).length > 1 ? 0.78 : 0.7, stack: spec.stacked ? 'all' : undefined,
          }
    );
  }

  const valueAxis = {
    beginAtZero: spec.unit !== 'index', grid: { color: theme.grid }, border: { display: false },
    ticks: { color: theme.muted, callback: (v) => fmt(v), maxTicksLimit: 6, font: { size: 11 * fontScale } },
    stacked: Boolean(spec.stacked),
  };
  const catAxis = {
    grid: { display: false }, border: { color: theme.axis },
    ticks: { color: horizontal ? theme.text2 : theme.muted, autoSkip: !horizontal, maxRotation: 0, font: { size: 11 * fontScale } },
    stacked: Boolean(spec.stacked),
  };

  return {
    type,
    data: { labels: spec.labels || [], datasets },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      responsive: interactive,
      maintainAspectRatio: false,
      animation: interactive ? { duration: 250 } : false,
      interaction: { mode: 'index', axis: horizontal ? 'y' : 'x', intersect: false },
      onClick: (_, els) => {
        if (onPick && els.length) onPick(els[0].index);
      },
      onHover: (e, els) => {
        if (onPick && e.native?.target) e.native.target.style.cursor = els.length ? 'pointer' : 'default';
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: interactive,
          backgroundColor: theme.surface, titleColor: theme.text, bodyColor: theme.text, borderColor: theme.axis, borderWidth: 1,
          padding: 10, boxPadding: 4, usePointStyle: true,
          filter: (item) => !item.dataset.isBand && item.raw !== null && item.raw !== undefined,
          callbacks: {
            label: (c) => ` ${fmt(c.parsed[horizontal ? 'x' : 'y'])}  ${c.dataset.label}`,
            footer: () => (onPick ? 'Cliquer pour le détail' : ''),
          },
          footerColor: theme.muted,
          footerFont: { weight: 'normal', size: 11 },
        },
      },
      scales: horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
    },
  };
}

/** Rendu hors écran en PNG (thème clair, fond plein) pour les exports et les rapports. */
export function renderChartImage(spec, { width = 1200, height = 600, scale = 2 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const holder = document.createElement('div');
  holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px`;
  holder.appendChild(canvas);
  document.body.appendChild(holder);
  const config = buildConfig(spec, LIGHT, { interactive: false, fontScale: 1.3 });
  config.options.devicePixelRatio = scale;
  config.options.responsive = false;
  config.plugins = [{
    id: 'bg',
    beforeDraw: (chart) => {
      const { ctx } = chart;
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, chart.width, chart.height);
      ctx.restore();
    },
  }];
  const chart = new Chart(canvas, config);
  const url = chart.toBase64Image('image/png');
  chart.destroy();
  holder.remove();
  return url;
}

/** Tableau (colonnes + lignes) dérivé d'une spec, pour la vue tableau et l'export CSV. */
export function specToTable(spec) {
  const fmt = unitFormatter(spec.unit);
  const series = (spec.series || []).filter((s) => !s.hidden);
  return {
    columns: ['', ...series.map((s) => s.name)],
    rows: (spec.labels || []).map((l, i) => [l, ...series.map((s) => (s.values[i] === null || s.values[i] === undefined ? '' : fmt(s.values[i])))]),
    raw: (spec.labels || []).map((l, i) => [l, ...series.map((s) => s.values[i] ?? '')]),
  };
}

export function downloadDataUrl(url, filename) {
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadCsv(columns, rows, filename) {
  const cell = (v) => {
    const s = String(v ?? '');
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const text = '﻿' + [columns, ...rows].map((r) => r.map(cell).join(';')).join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  downloadDataUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const slug = (s) => String(s || 'export').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || 'export';
