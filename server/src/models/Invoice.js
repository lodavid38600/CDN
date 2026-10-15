import mongoose from 'mongoose';

// Facture d'une société (numérotation continue F-AAAA-NNNN).
const lineSchema = new mongoose.Schema(
  { label: { type: String, required: true, maxlength: 300 }, quantity: { type: Number, default: 1, min: 0 }, unitPrice: { type: Number, default: 0 } },
  { _id: false }
);
const invoiceSchema = new mongoose.Schema(
  {
    number: { type: String, unique: true },
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    issueDate: { type: Date, default: Date.now },
    dueDate: Date,
    periodFrom: Date,
    periodTo: Date,
    lines: { type: [lineSchema], default: [] },
    vatRate: { type: Number, default: 20 },
    totalHT: Number,
    totalTVA: Number,
    totalTTC: Number,
    status: { type: String, enum: ['emise', 'payee', 'en_retard', 'annulee'], default: 'emise', index: true },
    paidAt: Date,
    // Coordonnées figées au moment de l'émission (une facture ne change plus)
    billedTo: { name: String, legalName: String, address: mongoose.Schema.Types.Mixed, vatNumber: String, siret: String, billingEmail: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, versionKey: false }
);
invoiceSchema.pre('validate', function totals() {
  const ht = this.lines.reduce((s, l) => s + (l.quantity || 0) * (l.unitPrice || 0), 0);
  this.totalHT = Math.round(ht * 100) / 100;
  this.totalTVA = Math.round(ht * this.vatRate) / 100;
  this.totalTTC = Math.round((this.totalHT + this.totalTVA) * 100) / 100;
});
export const Invoice = mongoose.model('Invoice', invoiceSchema);
