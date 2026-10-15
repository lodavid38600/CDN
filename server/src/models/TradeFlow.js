import mongoose from 'mongoose';

// Les écritures fusionnées (mois par mois) utilisent des pipelines de mise à jour.
mongoose.set('updatePipeline', true);

// Une ligne de commerce : pays déclarant UE -> partenaire hors UE, pour un code NC8 et une année.
// Les valeurs mensuelles sont stockées dans `months` / `monthsKg` (index 0 = janvier) ;
// `valueEur` / `quantityKg` en sont la somme (agrégations annuelles rapides).
const tradeFlowSchema = new mongoose.Schema(
  {
    reporter: { type: String, required: true }, // pays UE déclarant (FR, DE...)
    partner: { type: String, required: true }, // pays hors UE (US, CN...)
    product: { type: String, required: true }, // code NC8
    hs6: { type: String, required: true }, // sous-position NC06
    chapter: { type: String, required: true }, // NC02
    section: { type: String, required: true },
    year: { type: Number, required: true },
    flow: { type: String, enum: ['import', 'export'], required: true },
    valueEur: { type: Number, default: 0 },
    quantityKg: { type: Number, default: 0 },
    months: { type: [Number], default: undefined },
    monthsKg: { type: [Number], default: undefined },
    source: { type: String, enum: ['eurostat', 'demo'], default: 'eurostat' },
    // Harmonisation de la nomenclature (calculée par la synchronisation NC) :
    // tc = codes de la nomenclature actuelle couverts par cette ligne ;
    // h  = facteurs de conversion vers ces codes (absent si le code n'a jamais changé).
    tc: { type: [String], default: undefined },
    h: { type: [{ _id: false, t: String, fv: Number, fq: Number }], default: undefined },
    quality: { type: [String], default: undefined }, // anomalies détectées (ex. prix unitaire aberrant)
  },
  { timestamps: false, versionKey: false }
);

tradeFlowSchema.index({ reporter: 1, partner: 1, product: 1, year: 1, flow: 1 }, { unique: true });
tradeFlowSchema.index({ year: 1, flow: 1, section: 1, chapter: 1 });
tradeFlowSchema.index({ product: 1, year: 1 });
tradeFlowSchema.index({ hs6: 1, year: 1 });
tradeFlowSchema.index({ partner: 1, year: 1 });
tradeFlowSchema.index({ tc: 1, year: 1 });
// Lignes détaillées triées (valeur par défaut, volume, année) sans trier toute la table
tradeFlowSchema.index({ valueEur: -1, _id: -1 });
tradeFlowSchema.index({ quantityKg: -1, _id: -1 });
tradeFlowSchema.index({ year: -1, _id: -1 });

export const TradeFlow = mongoose.model('TradeFlow', tradeFlowSchema);
