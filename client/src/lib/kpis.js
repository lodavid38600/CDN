import { eur, tonnes, perKg } from '../format.js';

const FMT = { value: eur, quantity: tonnes, price: perKg };
const KEY = { value: 'Eur', quantity: 'Kg', price: 'Price' };
const CHANGE = { value: '', quantity: 'Kg', price: 'Price' };

/**
 * Indicateurs import / export : la mesure choisie en grand, les deux autres en complément,
 * et la variation sur un an de la mesure choisie.
 */
export function flowKpis(s, measure = 'value', changeLabel = 'sur un an') {
  if (!s) return [];
  return ['import', 'export'].map((f) => {
    const cap = f === 'import' ? 'Import' : 'Export';
    const others = ['value', 'quantity', 'price'].filter((m) => m !== measure).map((m) => FMT[m](s[`${f}${KEY[m]}`]));
    return {
      dot: f,
      label: f === 'import' ? 'Importations de l\'UE' : 'Exportations de l\'UE',
      sub: f === 'import' ? 'achats aux pays hors UE' : 'ventes aux pays hors UE',
      value: FMT[measure](s[`${f}${KEY[measure]}`]),
      extra: others,
      change: s[`change${cap}${CHANGE[measure]}`] ?? null,
      changeLabel,
    };
  });
}
