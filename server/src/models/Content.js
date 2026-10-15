import mongoose from 'mongoose';

// Actualités de l'outil (page d'accueil des clients)
const newsSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, default: '', maxlength: 5000 },
    kind: { type: String, enum: ['nouveaute', 'donnees', 'nomenclature', 'maintenance'], default: 'nouveaute' },
    published: { type: Boolean, default: true },
    publishedAt: { type: Date, default: Date.now },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, versionKey: false }
);
newsSchema.index({ published: 1, publishedAt: -1 });
export const News = mongoose.model('News', newsSchema);

// Couverture annoncée : pays en cours d'intégration ou prévus (les pays disponibles sont
// déduits automatiquement des données).
const coverageSchema = new mongoose.Schema(
  {
    country: { type: String, required: true, unique: true, uppercase: true, match: /^[A-Z]{2}$/ },
    status: { type: String, enum: ['en_cours', 'prevu'], default: 'prevu' },
    source: { type: String, default: '', maxlength: 120 },
    eta: { type: String, default: '', maxlength: 40 }, // ex. « T1 2027 »
    note: { type: String, default: '', maxlength: 300 },
  },
  { timestamps: true, versionKey: false }
);
export const Coverage = mongoose.model('Coverage', coverageSchema);
