import mongoose from 'mongoose';

// Version des données (incrémentée à chaque import / synchronisation) : sert de clé de cache
// et indique aux clients la fraîcheur des données.
const metaSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    version: { type: Number, default: 0 },
    updatedAt: { type: Date, default: Date.now },
    info: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { versionKey: false }
);
export const Meta = mongoose.model('Meta', metaSchema);

// Lignes rejetées par les contrôles de qualité (jamais insérées dans les données).
const rejectedSchema = new mongoose.Schema(
  {
    source: String,
    reasons: [String],
    record: mongoose.Schema.Types.Mixed,
    at: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 90 }, // conservées 90 jours
  },
  { versionKey: false }
);
export const Rejected = mongoose.model('Rejected', rejectedSchema);

// Journal des tâches automatiques.
const jobRunSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    status: { type: String, enum: ['running', 'success', 'partial', 'failed'], default: 'running' },
    startedAt: { type: Date, default: Date.now },
    endedAt: Date,
    report: mongoose.Schema.Types.Mixed,
    error: String,
  },
  { versionKey: false }
);
jobRunSchema.index({ name: 1, startedAt: -1 });
export const JobRun = mongoose.model('JobRun', jobRunSchema);

// Verrou distribué : une seule instance exécute une tâche à la fois.
const lockSchema = new mongoose.Schema(
  { _id: String, owner: String, expiresAt: Date },
  { versionKey: false }
);
export const Lock = mongoose.model('Lock', lockSchema);

// Taux de change mensuels (1 EUR = rate × devise), source BCE.
const fxSchema = new mongoose.Schema(
  { currency: String, period: String, rate: Number, source: { type: String, default: 'ecb' } },
  { versionKey: false }
);
fxSchema.index({ currency: 1, period: 1 }, { unique: true });
export const FxRate = mongoose.model('FxRate', fxSchema);
