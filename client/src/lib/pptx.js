// Export d'un rapport en présentation PowerPoint (.pptx), une diapositive par bloc.
import { renderChartImage, specToTable } from './chart.js';
import { htmlToRuns } from './sanitize.js';

const SERIES = ['2A78D6', 'EB6834', '1BAF7A', 'EDA100', 'E87BA4', '008300', '6250D6', 'E34948'];
const seriesHex = (c) => (c === 'import' ? SERIES[0] : c === 'export' ? SERIES[1] : SERIES[((Number(c) || 1) - 1) % 8]);
const C = { ink: '0B0B0B', ink2: '52514E', muted: '7A7873', accent: '2A78D6', wash: 'EAF2FC', grid: 'E1E0D9', surface: 'F6F6F3' };
const FONT = 'Calibri';

function addFrame(pptx, title, subtitle) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: 7.5, fill: { color: C.accent } });
  if (title) slide.addText(title, { x: 0.5, y: 0.3, w: 12.3, h: 0.6, fontFace: FONT, fontSize: 24, bold: true, color: C.ink });
  if (subtitle) slide.addText(subtitle, { x: 0.5, y: 0.85, w: 12.3, h: 0.4, fontFace: FONT, fontSize: 13, color: C.ink2 });
  return slide;
}

function footer(slide, text, n) {
  slide.addText(text, { x: 0.5, y: 7.05, w: 10, h: 0.3, fontFace: FONT, fontSize: 9, color: C.muted });
  slide.addText(String(n), { x: 12.3, y: 7.05, w: 0.6, h: 0.3, fontFace: FONT, fontSize: 9, color: C.muted, align: 'right' });
}

async function imageSize(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return { w: img.naturalWidth, h: img.naturalHeight };
}

export async function exportPptx(report) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13,33 × 7,5 pouces
  pptx.title = report.title;
  pptx.company = 'DouaneData';
  const date = new Date().toLocaleDateString('fr-FR', { dateStyle: 'long' });
  const foot = `${report.title} · ${date}`;
  let n = 1;

  // Diapositive de titre
  const cover = pptx.addSlide();
  cover.background = { color: C.surface };
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.18, fill: { color: C.accent } });
  cover.addText(report.title, { x: 0.8, y: 2.3, w: 11.7, h: 1.4, fontFace: FONT, fontSize: 40, bold: true, color: C.ink });
  if (report.subtitle) cover.addText(report.subtitle, { x: 0.8, y: 3.7, w: 11.7, h: 0.8, fontFace: FONT, fontSize: 18, color: C.ink2 });
  cover.addText(`${date} · Source : Eurostat Comext`, { x: 0.8, y: 6.4, w: 11.7, h: 0.4, fontFace: FONT, fontSize: 12, color: C.muted });

  let context = '';
  for (const b of report.blocks) {
    if (b.type === 'divider') continue;
    n += 1;
    if (b.type === 'heading') {
      context = b.text;
      if (b.level === 1 || !b.level) {
        const s = pptx.addSlide();
        s.background = { color: C.accent };
        s.addText(b.text, { x: 0.8, y: 2.8, w: 11.7, h: 1.6, fontFace: FONT, fontSize: 36, bold: true, color: 'FFFFFF' });
        footer(s, foot, n);
      } else n -= 1; // un titre de niveau 2 sert de titre aux diapositives suivantes
      continue;
    }
    if (b.type === 'text') {
      const s = addFrame(pptx, context || 'Commentaire');
      const paras = htmlToRuns(b.html);
      const runs = paras.flatMap((p, i) =>
        p.runs.map((r, j) => ({
          text: r.text,
          options: { bold: r.bold, italic: r.italic, breakLine: j === p.runs.length - 1 && i < paras.length - 1, bullet: p.bullet && j === 0 ? true : undefined, paraSpaceAfter: 10 },
        }))
      );
      s.addText(runs, { x: 0.5, y: 1.4, w: 12.3, h: 5.4, fontFace: FONT, fontSize: 18, color: C.ink, valign: 'top' });
      footer(s, foot, n);
    } else if (b.type === 'kpis') {
      const s = addFrame(pptx, b.title || context || 'Indicateurs clés');
      const items = b.items.slice(0, 8);
      const perRow = items.length > 4 ? Math.ceil(items.length / 2) : items.length;
      const w = (12.3 - (perRow - 1) * 0.25) / perRow;
      items.forEach((k, i) => {
        const x = 0.5 + (i % perRow) * (w + 0.25);
        const y = 1.7 + Math.floor(i / perRow) * 2.4;
        s.addShape(pptx.ShapeType.roundRect, { x, y, w, h: 2.1, fill: { color: C.wash }, line: { color: C.wash }, rectRadius: 0.1 });
        s.addText(k.label, { x: x + 0.2, y: y + 0.15, w: w - 0.4, h: 0.4, fontFace: FONT, fontSize: 13, color: C.ink2 });
        s.addText(k.value, { x: x + 0.2, y: y + 0.6, w: w - 0.4, h: 0.8, fontFace: FONT, fontSize: 28, bold: true, color: C.ink, fit: 'shrink' });
        if (k.sub) s.addText(k.sub, { x: x + 0.2, y: y + 1.45, w: w - 0.4, h: 0.5, fontFace: FONT, fontSize: 11, color: C.muted });
      });
      footer(s, foot, n);
    } else if (b.type === 'chart') {
      const s = addFrame(pptx, b.spec.title, b.spec.subtitle);
      const img = renderChartImage(b.spec, { width: 1200, height: 560 });
      // Image 1200×560 ajustée à 5 pouces de haut, centrée ; légende et note en dessous.
      const h = 5.0, w = h * (1200 / 560);
      s.addImage({ data: img, x: 0.5 + (12.3 - w) / 2, y: 1.3, w, h });
      const legend = (b.spec.series || []).map((x) => `■ ${x.name}`);
      if (legend.length > 1) {
        s.addText(
          legend.map((t, i) => ({ text: `${t}${i < legend.length - 1 ? '     ' : ''}`, options: { color: seriesHex(b.spec.series[i].color) } })),
          { x: 0.5, y: 6.35, w: 12.3, h: 0.3, fontFace: FONT, fontSize: 11, align: 'center' }
        );
      }
      if (b.spec.note) s.addText(b.spec.note, { x: 0.5, y: 6.68, w: 12.3, h: 0.3, fontFace: FONT, fontSize: 9, italic: true, color: C.muted, align: 'center' });
      footer(s, foot, n);
    } else if (b.type === 'table') {
      const rows = b.rows || [];
      const chunk = 13;
      for (let i = 0; i < Math.max(1, rows.length); i += chunk) {
        const s = addFrame(pptx, `${b.title || context || 'Tableau'}${rows.length > chunk ? ` (${i / chunk + 1}/${Math.ceil(rows.length / chunk)})` : ''}`);
        const head = (b.columns || []).map((c, j) => ({ text: c, options: { bold: true, color: C.ink2, fill: { color: C.surface }, align: j ? 'right' : 'left' } }));
        const body = rows.slice(i, i + chunk).map((r) => r.map((v, j) => ({ text: String(v ?? ''), options: { align: j ? 'right' : 'left' } })));
        s.addTable([head, ...body], { x: 0.5, y: 1.4, w: 12.3, fontFace: FONT, fontSize: 12, color: C.ink, border: { type: 'solid', pt: 0.5, color: C.grid }, rowH: 0.36 });
        footer(s, foot, n);
        if (i + chunk < rows.length) n += 1;
      }
    } else if (b.type === 'image' && b.src) {
      const s = addFrame(pptx, b.caption || context || '');
      const { w, h } = await imageSize(b.src);
      const maxW = 12.3, maxH = 5.4;
      const scale = Math.min(maxW / w, maxH / h);
      s.addImage({ data: b.src, x: 0.5 + (maxW - w * scale) / 2, y: 1.3, w: w * scale, h: h * scale });
      footer(s, foot, n);
    }
  }
  await pptx.writeFile({ compression: true, fileName: `${report.title.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'rapport'}.pptx` });
}

/** Données d'un bloc graphique en tableau (pour la vue tableau de l'éditeur). */
export const chartTable = specToTable;
