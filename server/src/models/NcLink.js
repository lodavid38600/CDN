import mongoose from 'mongoose';

// Table de correspondance entre codes (NC8 : level 8 ; SH6 : level 6).
// « Les marchandises de `from` (jusqu'à year-1) sont déclarées sous `to` à partir de `year`. »
const ncLinkSchema = new mongoose.Schema(
  {
    level: { type: Number, enum: [6, 8], required: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    year: { type: Number, required: true },
    source: { type: String, enum: ['official', 'manual', 'inferred', 'implicit'], required: true },
    confidence: { type: Number, default: 1 },
    estimated: { type: Boolean, default: false }, // poids faute de volumes observés
    weights: { type: mongoose.Schema.Types.Mixed, default: {} },
    file: { type: String, default: undefined },
  },
  { versionKey: false, timestamps: true }
);
ncLinkSchema.index({ level: 1, from: 1, to: 1, year: 1 }, { unique: true });

export const NcLink = mongoose.model('NcLink', ncLinkSchema);
