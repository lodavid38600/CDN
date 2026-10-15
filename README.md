# DouaneData — SaaS de données douanières Eurostat par code NC

Plate-forme **Node.js / Express / Vue 3 / MongoDB** pour analyser les échanges de marchandises
entre les **27 pays de l'UE** et les **pays hors UE**, code NC par code NC (nomenclature combinée
à 8 chiffres), au **mois près**, à partir des statistiques **Eurostat Comext**.

> « Quelle quantité la France a-t-elle exportée de vin entre mars 2018 et janvier 2019 ? »
> — c'est la question à laquelle l'outil répond en un instant.

## Fonctionnalités

| Écran | Ce qu'on y fait |
|---|---|
| **Tableau de bord** | *Question rapide* en langage naturel (pays, flux, produit, partenaire, mois de début et de fin) ; indicateurs (import, export, solde, couverture, variation sur un an) ; évolution **mensuelle ou annuelle** avec **prévision** ; classements partenaires / pays UE / sections ; **un clic sur une colonne ouvre le détail du mois** (pays avec drapeaux, produits) |
| **Nomenclature NC** | Grande grille des **chapitres NC02** par section (valeur, part, mini-courbe) → **sous-positions NC06** → **codes NC8** |
| **Fiche NC8** | Tout ce qu'on peut agréger sur un produit : valeurs, volumes, prix moyen au kg, solde, couverture, croissance annuelle moyenne, poids dans la sous-position, mois de pointe, saisonnalité, évolution des prix, prévision, **carte des partenaires**, classements, matrice *qui commerce avec qui* (déclarants × partenaires) |
| **Carte du monde** | Tous les pays couverts (UE et hors UE), choroplèthe, survol avec drapeau, **fiche pays** (tendance, contreparties, produits) |
| **Comparateur** | Jusqu'à **4 jeux de données sur le même graphique** (produit × flux × pays) : dans le temps (avec base 100) ou par pays — ex. *pays UE exportateurs vs importateurs de choux* |
| **Explorateur** | Lignes détaillées, tri, pagination, profil mensuel, **export CSV** |
| **Rapports** | **Génération en un clic** depuis le tableau de bord, une fiche NC ou la carte ; ajout de n'importe quel graphique via son menu ⤓ ; **éditeur** (texte riche, indicateurs, tableaux, images, glisser-déposer, sauvegarde automatique) ; **mode présentation** plein écran ; **export PDF et PowerPoint** |

Chaque graphique s'exporte en **PNG** ou **CSV**, bascule en **vue tableau**, et peut être ajouté à un rapport.
Les filtres sont synchronisés dans l'URL (liens partageables). Thème clair / sombre, interface responsive.

## Architecture

```
./
├── server/                       API Express + Mongoose
│   ├── src/
│   │   ├── app.js                routes, sécurité (helmet, rate-limit, CORS), cache des statistiques
│   │   ├── models/               User, Product (NC8), Nomenclature (NC02/04/06/08), TradeFlow, Report
│   │   ├── routes/               auth, meta, stats, trade, products, nomenclature, reports
│   │   ├── services/             filtres (périodes au mois), prévisions, JSON-stat Eurostat, libellés
│   │   ├── data/                 sections et chapitres NC, pays, catalogue de démonstration
│   │   └── scripts/              seed (démo) et importEurostat (données réelles)
│   └── test/                     tests node:test (unitaires + intégration MongoDB)
├── client/                       Vue 3 + Vite + Vue Router + Pinia + Chart.js + d3-geo
│   └── src/
│       ├── views/                Tableau de bord, Nomenclature, NC, Fiche produit, Carte,
│       │                         Comparateur, Explorateur, Rapports, Éditeur de rapport
│       ├── components/           graphiques, carte, drapeaux, sélecteur de période, blocs de rapport…
│       └── lib/                  specs de graphiques, export PNG/CSV, PowerPoint, nettoyage HTML
├── Dockerfile, docker-compose.yml
```

**Modèle de données** : une ligne `TradeFlow` = déclarant UE × partenaire hors UE × code NC8 × année × flux,
avec les totaux annuels (`valueEur`, `quantityKg`) **et le détail mensuel** (`months`, `monthsKg`, 12 valeurs).
Une période comme *mars 2018 → janvier 2019* additionne uniquement les mois concernés ; les agrégations
annuelles restent rapides. Sous-position NC06, chapitre et section sont dénormalisés et indexés.

**Prévisions** : Holt-Winters additif (saisonnalité 12 mois) pour les séries mensuelles, Holt à tendance
amortie pour les séries annuelles, paramètres choisis par recherche sur grille, intervalle de confiance à 95 %.
Elles sont indicatives et ne tiennent pas compte des chocs à venir.

## Démarrage rapide

Prérequis : Node.js ≥ 20 et MongoDB 6+ (ou Docker).

```bash
npm run install:all
cp server/.env.example server/.env        # ajustez MONGO_URL / JWT_SECRET

docker run -d -p 27017:27017 --name mongo mongo:7   # si MongoDB n'est pas installé

npm run seed            # 109 codes NC réels, janv. 2015 → juin 2026, valeurs mensuelles simulées
npm run dev:server      # API sur http://localhost:4000
npm run dev:client      # interface sur http://localhost:5173
```

Compte de démonstration : **demo@douane-saas.eu / demo12345** (offre Pro).

### Production

```bash
npm run build && npm start          # Express sert aussi le client compilé sur :4000
# ou
JWT_SECRET=$(openssl rand -hex 32) docker compose up -d --build
docker compose exec app node src/scripts/seed.js
```

Les réponses de `/api/stats/*` sont mises en cache 15 minutes en mémoire : redémarrez l'API après
un import pour voir immédiatement les nouvelles données.

## Données Eurostat réelles

Le jeu de démonstration utilise de **vrais codes NC** mais des **montants simulés** (`source: "demo"`).
Pour charger les données officielles, le script interroge l'API de diffusion Comext
(`DS-045409`, format JSON-stat, **mensuel par défaut**) et fait un upsert dans MongoDB :

```bash
# codes NC précis, tous les pays UE, partenaires hors UE de référence
npm run import:eurostat -- --products 22042109,87032319,30049000 --years 2019-2024

# périmètre restreint
npm run import:eurostat -- --products 22042109 --reporters FR,IT,ES --partners US,CN,GB --years 2023

# données annuelles seulement
npm run import:eurostat -- --products 22042109 --years 2015-2024 --freq A

# rafraîchir tous les codes NC déjà présents en base
npm run import:eurostat -- --from-db --years 2024
```

- Les flux `1`/`2` deviennent `import`/`export` ; les indicateurs `VALUE_IN_EUROS` et
  `QUANTITY_IN_100KG` (ou `VALUE_EUR` / `QUANTITY_KG` selon le jeu) sont convertis en € et en kg.
- Les périodes mensuelles (`2023M01` ou `2023-01`) remplissent le détail `months` / `monthsKg`.
- Les partenaires membres de l'UE sont ignorés (on ne garde que l'extra-UE).
- Les libellés renvoyés par Eurostat (NC02 à NC08) alimentent `products` et `nomenclatures`.
- Autre jeu Comext : `--dataset DS-XXXXXX` ou variable `EUROSTAT_DATASET`.
- Pour supprimer la démo après un import réel : `db.tradeflows.deleteMany({ source: "demo" })`.

⚠️ Le script n'a pas pu être exécuté contre l'API Eurostat depuis l'environnement de développement
(réseau restreint) : seul le décodage JSON-stat est couvert par les tests. Vérifiez un premier import
sur un petit périmètre, notamment le format des périodes mensuelles accepté par l'API.

## API

Toutes les routes (sauf `/api/auth/*` et `/api/health`) exigent `Authorization: Bearer <jeton>`.

| Méthode | Route | Description |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login` | Inscription, connexion → `{ token, user }` |
| GET | `/api/meta` | Première / dernière période, pays disponibles, arborescence NC |
| GET | `/api/stats/summary` | Totaux, solde, nombre de codes NC / partenaires, comparaison sur un an |
| GET | `/api/stats/timeseries?granularity=month\|year` | Série import / export (€ et kg) |
| GET | `/api/stats/forecast?granularity=&horizon=&measure=value\|quantity` | Prévision + intervalle à 95 % |
| GET | `/api/stats/top?dimension=partner\|reporter\|product\|hs6\|chapter\|section` | Classement |
| GET | `/api/stats/sparklines?dimension=` | Séries annuelles par élément (mini-courbes) |
| GET | `/api/stats/matrix?rows=reporter&cols=partner&size=8` | Matrice croisée |
| GET | `/api/nomenclature`, `/api/nomenclature/:code` | Arborescence ; nœud NC02 / NC06 / NC08 avec parents et enfants |
| GET | `/api/trade`, `/api/trade/export.csv` | Lignes détaillées ; export CSV (1 000 lignes Gratuit, 100 000 Pro) |
| GET | `/api/products?q=`, `/api/products/:code` | Recherche ; fiche d'un code NC8 |
| GET/POST/PUT/DELETE | `/api/reports`, `/api/reports/:id`, `POST /api/reports/:id/blocks` | Rapports de l'utilisateur |

Filtres communs : `periodFrom` / `periodTo` (`AAAA-MM`), ou `yearFrom` / `yearTo` / `year` ;
`flow=import|export` ; `reporters=FR,DE` ; `partners=US,CN` ; `sections=IV,XVI` ; `chapters=22,84` ;
`product=2204` (préfixe de 2 à 8 chiffres). Chaque valeur est validée par liste blanche.

## Tests

```bash
npm test     # filtres et périodes, prévisions, parseur JSON-stat, intégration API (si MongoDB est joignable)
```
