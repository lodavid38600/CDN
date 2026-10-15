import mongoose from 'mongoose';

// Tableau de bord personnel : une liste ordonnée de graphiques enregistrés avec leurs filtres.
// Un graphique « suivi » se recalcule à chaque ouverture sur une période glissante ; un graphique
// « figé » garde les chiffres du jour où il a été enregistré (snapshot).
const dashboardSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    widgets: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true, versionKey: false, minimize: false }
);

export const Dashboard = mongoose.model('Dashboard', dashboardSchema);
