import mongoose from 'mongoose';

// Rapport éditable : une liste ordonnée de blocs (titre, texte, indicateurs, graphique, tableau, image).
const reportSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, default: 'Rapport sans titre', maxlength: 200 },
    subtitle: { type: String, default: '', maxlength: 400 },
    blocks: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true, versionKey: false, minimize: false }
);

export const Report = mongoose.model('Report', reportSchema);
