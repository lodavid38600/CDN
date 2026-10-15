import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, trim: true, default: '' },
    jobTitle: { type: String, trim: true, default: '', maxlength: 120 },
    phone: { type: String, trim: true, default: '', maxlength: 40 },
    passwordHash: { type: String, required: true },
    // Client : société de rattachement (droits hérités) et rôle dans cette société
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true },
    companyRole: { type: String, enum: ['owner', 'member'], default: 'member' },
    // Équipe du SaaS (sans société) : administrateur ou commercial
    staffRole: { type: String, enum: ['admin', 'commercial', null], default: null },
    active: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },
    lastLoginAt: Date,
    // Anciens champs (avant les sociétés), migrés au démarrage
    company: { type: String, trim: true },
    plan: { type: String },
    role: { type: String },
  },
  { timestamps: true }
);

userSchema.methods.setPassword = async function setPassword(password) {
  this.passwordHash = await bcrypt.hash(password, 10);
};

userSchema.methods.checkPassword = function checkPassword(password) {
  return bcrypt.compare(password, this.passwordHash);
};

userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    email: this.email,
    name: this.name,
    jobTitle: this.jobTitle,
    phone: this.phone,
    companyId: this.companyId?.toString() || null,
    companyRole: this.staffRole ? null : this.companyRole,
    staffRole: this.staffRole || null,
    active: this.active,
    mustChangePassword: this.mustChangePassword,
    lastLoginAt: this.lastLoginAt,
    createdAt: this.createdAt,
  };
};

export const User = mongoose.model('User', userSchema);
