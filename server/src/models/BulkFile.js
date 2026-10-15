import mongoose from 'mongoose';

// Fichiers « bulk » Eurostat déjà traités : un fichier n'est retéléchargé et retraité que
// s'il a changé (révisions publiées par Eurostat).
const bulkFileSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    period: String, // AAAA-MM couvert par le fichier
    url: String,
    size: Number,
    lastModified: String,
    etag: String,
    status: { type: String, enum: ['processed', 'failed', 'missing'], default: 'processed' },
    processedAt: Date,
    stats: mongoose.Schema.Types.Mixed,
    error: String,
  },
  { versionKey: false, timestamps: true }
);

export const BulkFile = mongoose.model('BulkFile', bulkFileSchema);

// Table intermédiaire du chargement (vidée après chaque fichier).
const stagingSchema = new mongoose.Schema(
  { run: String, r: String, p: String, c: String, f: String, y: Number, m: Number, v: Number, q: Number },
  { versionKey: false }
);
stagingSchema.index({ run: 1 });
export const BulkStaging = mongoose.model('BulkStaging', stagingSchema);
