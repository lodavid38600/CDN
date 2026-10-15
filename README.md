# DouaneData — SaaS de données douanières Eurostat par code NC

Plate-forme **Node.js / Express / Vue 3 / MongoDB** pour analyser les échanges de marchandises
entre les **27 pays de l'UE** et les **pays hors UE**, code NC (nomenclature combinée à 8 chiffres)
par code NC, à partir des statistiques **Eurostat Comext**.

- Données classées par **catégorie** (21 sections → 96 chapitres → codes NC8) et par **année**
- **Filtres** combinables : période, flux (import/export), pays UE déclarant, partenaire hors UE,
  section, chapitre, préfixe de code NC — synchronisés dans l'URL (liens partageables)
- **Graphiques** : évolution annuelle import/export, classements des partenaires et des pays
  déclarants, répartition par section ; bascule valeur (€) / quantité (t), thème clair/sombre
- **Fiche produit** par code NC : KPI, solde, prix moyen au kg, partenaires, pays déclarants
- **Explorateur** : tableau trié/paginé de toutes les lignes, **export CSV** (plafonné selon l'offre)
- **Comptes utilisateurs** (JWT), offres Gratuit / Pro

## Architecture

```
./
├── server/                    API Express + Mongoose
│   ├── src/
│   │   ├── app.js             montage des routes, sécurité (helmet, rate-limit, CORS)
│   │   ├── models/            User, Product (code NC), TradeFlow (ligne de commerce)
│   │   ├── routes/            auth, meta, stats, trade, products
│   │   ├── services/          filtres validés, parseur JSON-stat Eurostat, libellés
│   │   ├── data/              nomenclature NC (sections/chapitres), pays UE / hors UE
│   │   └── scripts/           seed (démo) et importEurostat (données réelles)
│   └── test/                  tests node:test (unitaires + intégration MongoDB)
├── client/                    Vue 3 + Vite + Vue Router + Pinia + Chart.js
│   └── src/views/             Tableau de bord, Explorateur, Catégories, Fiche produit, Compte
├── Dockerfile, docker-compose.yml
```

Modèle de données : une ligne `TradeFlow` = **déclarant UE × partenaire hors UE × code NC8 × année × flux**,
avec `valueEur` et `quantityKg`. Le chapitre et la section sont dénormalisés pour des agrégations rapides
(index composés sur année/flux/section/chapitre, produit, partenaire).

## Démarrage rapide

Prérequis : Node.js ≥ 20 et MongoDB 6+ (ou Docker).

```bash
cd CDN
npm run install:all
cp server/.env.example server/.env        # ajustez MONGO_URL / JWT_SECRET

docker run -d -p 27017:27017 --name mongo mongo:7   # si MongoDB n'est pas installé

npm run seed            # 102 codes NC réels, 2015-2024, valeurs simulées + compte démo
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

## Données Eurostat réelles

Le jeu de démonstration utilise de **vrais codes NC** mais des **montants simulés** (`source: "demo"`).
Pour charger les données officielles, le script interroge l'API de diffusion Comext
(`DS-045409`, format JSON-stat) et fait un upsert dans MongoDB :

```bash
# codes NC précis, tous les pays UE, partenaires hors UE de référence
npm run import:eurostat -- --products 22042109,87032319,30049000 --years 2019-2024

# périmètre restreint
npm run import:eurostat -- --products 22042109 --reporters FR,IT,ES --partners US,CN,GB --years 2023

# rafraîchir tous les codes NC déjà présents en base
npm run import:eurostat -- --from-db --years 2024
```

- Les flux `1`/`2` deviennent `import`/`export` ; les indicateurs `VALUE_IN_EUROS` et
  `QUANTITY_IN_100KG` (ou `VALUE_EUR` / `QUANTITY_KG` selon le jeu) sont convertis en € et en kg.
- Les partenaires membres de l'UE sont ignorés (on ne garde que l'extra-UE).
- Les libellés des codes NC renvoyés par Eurostat alimentent la collection `products`.
- Autre jeu Comext : `--dataset DS-XXXXXX` ou variable `EUROSTAT_DATASET`.
- Pour supprimer la démo après un import réel : `db.tradeflows.deleteMany({ source: "demo" })`.

## API

Toutes les routes (sauf `/api/auth/*` et `/api/health`) exigent `Authorization: Bearer <jeton>`.

| Méthode | Route | Description |
|---|---|---|
| POST | `/api/auth/register` | Inscription `{ email, password, name?, company? }` |
| POST | `/api/auth/login` | Connexion → `{ token, user }` |
| GET | `/api/auth/me` | Utilisateur courant |
| GET | `/api/meta` | Années, pays déclarants/partenaires disponibles, arborescence NC |
| GET | `/api/stats/summary` | Totaux import/export, solde, nb de codes NC, variation N/N-1 |
| GET | `/api/stats/timeseries` | Série annuelle import/export (€ et kg) |
| GET | `/api/stats/top?dimension=partner\|reporter\|product\|chapter\|section&limit=10` | Classement |
| GET | `/api/trade?page=&limit=&sort=&order=` | Lignes détaillées paginées |
| GET | `/api/trade/export.csv` | Export CSV (`;`, UTF-8 BOM) — 1 000 lignes (Gratuit), 100 000 (Pro) |
| GET | `/api/products?q=&sections=&chapters=` | Recherche dans le catalogue NC |
| GET | `/api/products/:code` | Fiche d'un code NC8 |

Filtres communs (query string) : `yearFrom`, `yearTo`, `year`, `flow=import|export`,
`reporters=FR,DE`, `partners=US,CN`, `sections=IV,XVI`, `chapters=22,84`, `product=2204` (préfixe 2 à 8 chiffres).
Chaque valeur est validée par liste blanche (protection contre l'injection NoSQL).

## Tests

```bash
npm test     # parseur JSON-stat, filtres, et intégration API (si MongoDB est joignable)
```
