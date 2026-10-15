import mongoose from 'mongoose';

// Les écritures fusionnées (mois par mois) utilisent des pipelines de mise à jour.
mongoose.set('updatePipeline', true);

// Commerce mondial harmonisé au niveau SH6 (6 chiffres, commun à tous les pays).
// Une ligne : pays déclarant (tout pays) × partenaire × SH6 × année × flux, avec le détail mensuel.
// Sources : Eurostat (pays UE, agrégé de la NC8), sources nationales (États-Unis, Royaume-Uni,
// Norvège…), UN Comtrade, et données « miroir » reconstituées à partir des déclarations des partenaires.
const worldFlowSchema = new mongoose.Schema(
  {
    reporter: { type: String, required: true },
    partner: { type: String, required: true },
    product: { type: String, required: true }, // code SH6
    hs6: { type: String, required: true },
    chapter: { type: String, required: true },
    section: { type: String, required: true },
    year: { type: Number, required: true },
    flow: { type: String, enum: ['import', 'export'], required: true },
    valueEur: { type: Number, default: 0 },
    quantityKg: { type: Number, default: 0 },
    months: { type: [Number], default: undefined },
    monthsKg: { type: [Number], default: undefined },
    currency: { type: String, default: 'EUR' },
    valueOrig: { type: Number, default: undefined },
    source: { type: String, required: true }, // eurostat | us-census | uk-hmrc | ssb | comtrade | mirror | demo
    priority: { type: Number, default: 0 }, // national 3 > eurostat 3 > comtrade 2 > miroir 1
    mirror: { type: Boolean, default: false },
    tc: { type: [String], default: undefined },
    h: { type: [{ _id: false, t: String, fv: Number, fq: Number }], default: undefined },
    quality: { type: [String], default: undefined },
    demo: { type: Boolean, default: undefined }, // lignes du jeu de démonstration
    syncedAt: { type: Date, default: undefined },
  },
  { versionKey: false }
);

worldFlowSchema.index({ reporter: 1, partner: 1, product: 1, year: 1, flow: 1 }, { unique: true });
worldFlowSchema.index({ tc: 1, year: 1 });
worldFlowSchema.index({ product: 1, year: 1 });
worldFlowSchema.index({ year: 1, flow: 1 });
worldFlowSchema.index({ source: 1 });

export const WorldFlow = mongoose.model('WorldFlow', worldFlowSchema);
