import mongoose from 'mongoose';

// Société cliente : ses utilisateurs héritent de son offre et de ses fonctionnalités.
const companySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    legalName: { type: String, trim: true, default: '', maxlength: 200 },
    siret: { type: String, trim: true, default: '', maxlength: 20 },
    vatNumber: { type: String, trim: true, default: '', maxlength: 20 },
    address: {
      line1: { type: String, default: '', maxlength: 200 },
      line2: { type: String, default: '', maxlength: 200 },
      postalCode: { type: String, default: '', maxlength: 20 },
      city: { type: String, default: '', maxlength: 100 },
      country: { type: String, default: 'France', maxlength: 100 },
    },
    billingEmail: { type: String, trim: true, lowercase: true, default: '', maxlength: 200 },
    phone: { type: String, trim: true, default: '', maxlength: 40 },
    plan: { type: String, enum: ['essai', 'essentiel', 'pro', 'entreprise'], default: 'essai' },
    featuresAdd: { type: [String], default: [] }, // fonctionnalités ajoutées hors offre
    featuresRemove: { type: [String], default: [] }, // fonctionnalités retirées de l'offre
    seats: { type: Number, min: 1, max: 1000 }, // places (défaut : celles de l'offre)
    exportLimit: { type: Number, min: 0 }, // plafond d'export CSV (défaut : celui de l'offre)
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    subscription: {
      start: Date,
      end: Date, // échéance (vide = sans limite)
      billing: { type: String, enum: ['mensuel', 'annuel'], default: 'mensuel' },
      price: Number, // prix mensuel HT négocié (défaut : prix de l'offre)
    },
    accountManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // commercial référent
    notes: { type: String, default: '', maxlength: 5000 }, // notes internes (jamais visibles du client)
  },
  { timestamps: true, versionKey: false }
);
companySchema.index({ name: 1 });
export const Company = mongoose.model('Company', companySchema);
