import mongoose from 'mongoose';

// Un code NC à 8 chiffres (CN8) et son rattachement à la nomenclature.
const productSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, match: /^\d{8}$/ },
    description: { type: String, required: true },
    chapter: { type: String, required: true, index: true }, // "22"
    heading: { type: String, required: true }, // "2204"
    section: { type: String, required: true, index: true }, // "IV"
    // Cycle de vie du code (calculé par la synchronisation NC)
    validFrom: { type: Number, default: undefined },
    validTo: { type: Number, default: undefined }, // dernière année ; absent = code actuel
    status: { type: String, enum: ['current', 'obsolete', 'discontinued'], default: 'current' },
  },
  { timestamps: true }
);

productSchema.index({ description: 'text', code: 'text' });

export const Product = mongoose.model('Product', productSchema);
