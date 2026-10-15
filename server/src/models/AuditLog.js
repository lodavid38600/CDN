import mongoose from 'mongoose';

// Journal d'activité : qui a fait quoi, quand, sur quoi. Conservé 1 an.
const auditSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 365 },
    level: { type: String, enum: ['info', 'warning', 'error', 'security'], default: 'info' },
    category: { type: String, required: true }, // auth, compte, societe, abonnement, facture, support, chat, donnees, export, securite, site, systeme
    action: { type: String, required: true }, // ex. « connexion.reussie », « societe.offre.modifiee »
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorEmail: String,
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
    target: String, // objet concerné (ex. « ticket #12 », « facture F-2026-0003 »)
    message: String, // description lisible
    details: mongoose.Schema.Types.Mixed,
    ip: String,
  },
  { versionKey: false }
);
auditSchema.index({ at: -1 });
auditSchema.index({ category: 1, at: -1 });
auditSchema.index({ company: 1, at: -1 });
auditSchema.index({ actor: 1, at: -1 });
export const AuditLog = mongoose.model('AuditLog', auditSchema);
