import mongoose from 'mongoose';

// Libellés de la nomenclature par niveau (2 = chapitre, 4 = position, 6 = sous-position, 8 = code NC).
const nomenclatureSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, match: /^\d{2,8}$/ },
    level: { type: Number, enum: [2, 4, 6, 8], required: true, index: true },
    label: { type: String, required: true },
  },
  { versionKey: false }
);

export const Nomenclature = mongoose.model('Nomenclature', nomenclatureSchema);
