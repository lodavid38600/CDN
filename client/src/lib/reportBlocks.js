// Construction de blocs de rapport à partir des données affichées.
import { eur, tonnes, percent, perKg, rangeLabel, sharePct, periodLabel } from '../format.js';

export function kpiBlock(s) {
  const ref = s.reference ? `vs ${rangeLabel(s.previous.from, s.previous.to)}` : '';
  return {
    type: 'kpis',
    items: [
      { label: 'Importations', value: eur(s.importEur), sub: `${percent(s.changeImport)} ${ref}`.trim() },
      { label: 'Exportations', value: eur(s.exportEur), sub: `${percent(s.changeExport)} ${ref}`.trim() },
      { label: 'Solde commercial', value: `${s.balanceEur >= 0 ? '+' : ''}${eur(s.balanceEur)}`, sub: s.balanceEur >= 0 ? 'Excédent' : 'Déficit' },
      { label: 'Taux de couverture', value: s.importEur ? sharePct(s.exportEur / s.importEur) : '—', sub: 'Exportations / importations' },
    ],
  };
}

/** Synthèse rédigée automatiquement (modifiable ensuite dans l'éditeur). */
export function narrativeBlock(s, { scope = 'les échanges extra-UE sélectionnés', topPartner, topReporter } = {}) {
  const period = s.period ? rangeLabel(s.period.from, s.period.to) : '';
  const parts = [
    `<p>Sur la période <strong>${period}</strong>, ${scope} représentent <strong>${eur(s.exportEur)}</strong> d'exportations (${tonnes(s.exportKg)}) et <strong>${eur(s.importEur)}</strong> d'importations (${tonnes(s.importKg)}), soit un ${s.balanceEur >= 0 ? 'excédent' : 'déficit'} de <strong>${eur(Math.abs(s.balanceEur))}</strong>.</p>`,
  ];
  if (s.reference && Number.isFinite(s.changeExport)) {
    const ref = s.reference;
    parts.push(
      `<p>Sur ${rangeLabel(ref.from, ref.to)}, les exportations évoluent de <strong>${percent(s.changeExport)}</strong> et les importations de <strong>${percent(s.changeImport)}</strong> par rapport à ${rangeLabel(s.previous.from, s.previous.to)}.</p>`
    );
  }
  const extras = [];
  if (topPartner) extras.push(`le premier partenaire hors UE est <strong>${topPartner.label}</strong> (${eur(topPartner.totalEur)} d'échanges)`);
  if (topReporter) extras.push(`le premier pays déclarant est <strong>${topReporter.label}</strong> (${eur(topReporter.totalEur)})`);
  if (extras.length) parts.push(`<p>${extras.join(' ; ').replace(/^./, (c) => c.toUpperCase())}.</p>`);
  if (s.exportKg && s.importKg) parts.push(`<p>Prix moyen : ${perKg(s.exportEur / s.exportKg)} à l'export, ${perKg(s.importEur / s.importKg)} à l'import.</p>`);
  return { type: 'text', html: parts.join('') };
}

export function rankTableBlock(rows, title, { measure = 'value' } = {}) {
  const f = measure === 'quantity' ? tonnes : eur;
  const k = measure === 'quantity' ? 'Kg' : 'Eur';
  return {
    type: 'table',
    title,
    columns: ['', 'Importations', 'Exportations', 'Solde'],
    rows: rows.map((r) => [`${r.key.length <= 2 ? `${r.key} · ` : `${r.key} · `}${r.label}`, f(r[`import${k}`]), f(r[`export${k}`]), eur(r.balanceEur)]),
  };
}

export const sourceBlock = (lastPeriod) => ({
  type: 'text',
  html: `<p><em>Source : Eurostat, base Comext (commerce extra-UE par code NC8). Dernière période disponible : ${periodLabel(lastPeriod)}. Valeurs en euros courants.</em></p>`,
});
