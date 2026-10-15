# DouaneData — SaaS de données douanières Eurostat par code NC

Plate-forme **Node.js / Express / Vue 3 / MongoDB** pour analyser les échanges de marchandises
entre les **27 pays de l'UE** et les **pays hors UE**, code NC par code NC (nomenclature combinée
à 8 chiffres), au **mois près**, à partir des statistiques **Eurostat Comext**.

> « Quelle quantité la France a-t-elle exportée de vin entre mars 2018 et janvier 2019 ? »
> — c'est la question à laquelle l'outil répond en un instant.

## Fonctionnalités

| Menu | Ce qu'on y fait |
|---|---|
| **Vue d'ensemble** | Phrase de synthèse générée à partir des filtres (« La France a exporté 244 kt de vins vers les pays hors UE pour 2,23 Md € (9,17 €/kg), de mars 2018 à janvier 2019 ») ; indicateurs en valeur, **volume** et **prix moyen** ; évolution au mois, au trimestre ou à l'année selon la période, avec **prévision** ; clic sur une période → détail avec drapeaux |
| **Produits (codes NC)** | Grille des chapitres NC02 → sous-positions NC06 → codes NC8. **Toutes les données d'un code sur une seule fiche**, avec un sommaire collant (Synthèse · Évolution · Prix & volumes · Pays partenaires · Marché mondial) : voir ci-dessous |
| **Pays partenaires** | Carte et fiche de chaque pays, en valeur, en volume ou en prix moyen |
| **Comparer** | Jusqu'à 4 jeux de données sur le même graphique (temps ou pays, base 100, valeur / volume / prix) |
| **Lignes détaillées** | Toutes les déclarations, prix unitaire, conversion des anciens codes visible, export CSV |
| **Rapports** | Générés en un clic depuis chaque vue, éditables, mode présentation, export **PDF** et **PowerPoint** |
| **Compte & données** | Fraîcheur des données, journal des mises à jour, codes NC remplacés, quarantaine, sources |

Les volumes s'affichent dans l'unité adaptée (kg, t, kt, Mt). Une seule bascule « Valeur € / Volume / Prix €/kg »
pilote les indicateurs, graphiques et classements.

### La fiche d'un code NC (NC8, et NC6 pour une sous-position)

Une seule page, aucune donnée sur une page séparée :

1. **Synthèse** : importations, exportations, solde, **prix médian**, **volumes** (unité adaptée : kg → t → kt → Mt),
   croissance annuelle moyenne, poids dans la sous-position, mois de pointe, nombre de partenaires.
2. **Évolution** : valeurs, volumes ou prix au mois, au trimestre ou à l'année selon la période, prévision,
   tableau période par période (valeur, volume, prix, variations), saisonnalité, prix moyen au kilo.
3. **Prix & volumes par pays** : prix moyen, **prix médian pondéré par les volumes**, P25 / P75, min / max,
   dispersion, **pays au prix médian le plus bas / le plus haut**, premier en volume ; boîtes à moustaches,
   nuage prix / volume, évolution mensuelle du prix médian ; liste complète triable. Point de vue au choix :
   pays UE exportateurs (ou importateurs), clients / fournisseurs hors UE, ou **tous les pays du monde**.
4. **Pays partenaires** : carte, classements, tableaux complets, matrice *qui commerce avec qui*.
5. **Marché mondial** (SH6) : tous les pays, y compris hors Eurostat (sources nationales, UN Comtrade,
   reconstitution miroir), part de l'UE, carte mondiale, **comparaison miroir** des déclarations.

Les filtres de la fiche (période, pays, flux, mesure, codes bruts) s'appliquent à toutes les sections.
Les anciennes adresses `/prix?product=…` et `/monde?product=…` redirigent vers la section de la fiche.

## Évolution de la nomenclature : automatique

Les codes NC changent chaque année (scissions, fusions, renommages, codes réutilisés). L'outil s'adapte seul :

1. **Tables de correspondance** officielles lues dans `server/data/correspondances/` (format décrit dans
   `LISEZMOI.md` du dossier) et téléchargées automatiquement si `NC_CORRESPONDENCE_URLS` est renseignée.
2. **Liens déduits** quand une table manque : un code qui disparaît, remplacé l'année suivante par de
   nouveaux codes de la même position, est relié à eux (signalé « correspondance déduite »).
3. **Pondération par les volumes** : la répartition d'un ancien code entre ses successeurs est estimée sur
   les flux observés l'année du changement (valeur et quantité séparément, par flux).
4. **Conversion vers la nomenclature actuelle** : chaque ligne porte les codes actuels qu'elle couvre et ses
   facteurs. Résultat :
   - un code créé en 2022 affiche une **série continue** depuis 2015 (historique reconstitué) ;
   - un code supprimé affiche **ce qu'il est devenu** (sa part dans les nouveaux codes) ;
   - aucune double comptabilisation : la somme des codes actuels est **exactement** égale au total déclaré ;
   - un code réutilisé pour un autre produit n'est pas mélangé avec son ancien usage ;
   - les déclarations tardives sous un code supprimé sont rattachées à ses successeurs.
5. Les pages produit l'indiquent par un bandeau (« Code créé en 2022… ») ; la case « Codes déclarés »
   affiche les chiffres bruts. Côté API : `nc=brut`.

## Données hors Eurostat

| Source | Pays | Niveau | Clé |
|---|---|---|---|
| UN Comtrade (`comtrade`) | ~200 pays | SH6, mensuel, USD | `COMTRADE_API_KEY` (gratuite) |
| US Census Bureau (`us-census`) | États-Unis | SH6, mensuel, USD | — |
| HMRC UK Trade Info (`uk-hmrc`) | Royaume-Uni | 8 chiffres, mensuel, GBP | — |
| Statistisk sentralbyrå (`ssb`) | Norvège | SH8, mensuel, NOK | — |

Harmonisation automatique : codes ramenés au **SH6** (commun à tous les pays) puis convertis vers la version
actuelle du Système harmonisé, devises converties en euros au **taux mensuel BCE** (repli sur la moyenne
annuelle), pays en codes ISO. Les pays qui ne publient pas (Chine, Viêt Nam…) sont **reconstitués en miroir** à
partir des déclarations de leurs partenaires. Priorité : source nationale / Eurostat > Comtrade > miroir —
une source moins fiable n'écrase jamais une source plus fiable.

## Données toujours à jour et incassables

- **Mise à jour automatique** (`AUTO_UPDATE=true`) : toutes les `UPDATE_INTERVAL_HOURS` heures, **fichiers bulk
  Eurostat** nouveaux ou révisés (voir ci-dessous), sources mondiales (`WORLD_SOURCES=us-census,uk-hmrc,ssb,comtrade`),
  tables de correspondance, synchronisation de la nomenclature. Verrou distribué (une seule exécution à la fois),
  journal consultable, une étape en échec n'empêche pas les autres.
- **Contrôles de qualité** à l'entrée : codes, pays, flux, années, mois (12 valeurs, positives, pas dans le futur),
  cohérence des totaux (recalculés depuis les mois) ; toute ligne invalide part en **quarantaine** (90 jours) au
  lieu d'être insérée ; prix unitaires aberrants signalés et exclus des statistiques de prix.
- **Fusion mois par mois** : un import partiel ne remet jamais à zéro les autres mois.
- **Version des données** : chaque import incrémente une version qui invalide immédiatement les caches de
  toutes les instances.
- Commandes : `npm run update` (mise à jour complète), `npm run bulk:sync` (fichiers Eurostat),
  `npm run nc:sync` (nomenclature seule).

## Architecture

```
./
├── server/                       API Express + Mongoose
│   ├── src/
│   │   ├── app.js                routes, sécurité (helmet, rate-limit, CORS), cache des statistiques
│   │   ├── models/               User, Product, Nomenclature, TradeFlow (UE, NC8), WorldFlow (monde, SH6),
│   │   │                         NcLink (correspondances), Report, Meta / Rejected / JobRun / Lock / FxRate
│   │   ├── routes/               auth, meta, stats, trade, products, nomenclature, reports
│   │   ├── services/             nomenclature (ncGraph, ncSync, scope), qualité, ingestion, prix, prévisions,
│   │   │                         jeu mondial, mise à jour planifiée, verrou, version des données
│   │   ├── connectors/           Comtrade, US Census, HMRC, SSB, taux BCE
│   │   ├── data/                 sections et chapitres NC, pays, catalogue de démonstration
│   │   └── scripts/              seed (démo) et importEurostat (données réelles)
│   ├── data/correspondances/     tables de correspondance NC (CSV)
│   └── test/                     tests node:test (unitaires, intégration, robustesse)
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

npm run seed            # codes NC réels (dont 3 changements de nomenclature réels), janv. 2015 → juin 2026,
                        # valeurs simulées UE + 13 pays hors UE ; synchronisation NC et jeu mondial (~2 min)
npm run dev:server      # API sur http://localhost:4000
npm run dev:client      # interface sur http://localhost:5173
```

Compte de démonstration : **demo@douane-saas.eu / demo12345** (offre Pro).

### Avec les vraies données Eurostat (sans démo)

```bash
npm run install:all
cp server/.env.example server/.env        # NODE_ENV=production, JWT_SECRET, CORS_ORIGIN=http://localhost:4000
docker run -d --name douane-mongo -p 27017:27017 -v douane-mongo:/data/db mongo:7
npm run bulk:sync -- --from 2026-06 --to 2026-06   # 1 mois pour vérifier
npm run bulk:sync -- --from 2024-09                # puis 2 ans
npm run user:create -- --email moi@exemple.fr --password "motdepasse" --admin --pro
npm run build && npm start                          # http://localhost:4000
```

### Production

```bash
npm run build && npm start          # Express sert aussi le client compilé sur :4000
# ou
JWT_SECRET=$(openssl rand -hex 32) docker compose up -d --build
docker compose exec app node src/scripts/seed.js
```

Les réponses de `/api/stats/*` sont mises en cache 15 minutes en mémoire : redémarrez l'API après
un import pour voir immédiatement les nouvelles données.

## Données Eurostat réelles : fichiers bulk (source principale)

La base est constituée à partir des **fichiers bulk Comext** d'Eurostat, pas de l'API :

- un fichier mensuel contient **tous** les codes NC8, tous les pays déclarants et tous les partenaires ;
  aucun quota, aucune limite de requêtes : avec plusieurs clients en production, personne n'interroge Eurostat,
  tout le monde lit **notre base** ;
- chargement initial une fois, puis seuls les fichiers **nouveaux ou modifiés** (révisions Eurostat) sont
  retéléchargés : une requête `HEAD` par mois compare taille, date et ETag au dernier traitement
  (collection `bulkfiles`) ;
- traitement **en flux** (fichiers `.7z` via 7-Zip embarqué, `.zip`, `.gz` ou texte ; aucun fichier en mémoire),
  table intermédiaire, puis fusion **mois par mois** dans la base (`$merge`) : retraiter un fichier ne double
  jamais les valeurs, une révision remplace le mois concerné sans toucher aux autres ;
- filtres : déclarant UE, partenaire hors UE (commerce intra-UE ignoré), codes à 8 chiffres uniquement
  (totaux, chapitres et codes confidentiels ignorés), totaux annuels (période `AAAA52`) ignorés, régimes
  statistiques additionnés, Grèce `EL` → `GR` ; toute ligne invalide part en quarantaine ;
- les deux formats d'en-têtes connus sont reconnus (`DECLARANT_ISO`, `PRODUCT_NC`, `VALUE_IN_EUROS`,
  `QUANTITY_IN_KG`… et `REPORTER`, `PARTNER`, `VALUE_EUR`, `QUANTITY_KG`…), séparateur détecté automatiquement ;
  un fichier aux colonnes inattendues est refusé avec un message clair, la base reste intacte ;
- les nouveaux codes NC apparus dans un fichier sont ajoutés au catalogue ; un fichier de libellés officiels
  (`EUROSTAT_CN_LABELS_URL`, « code ⇥ libellé ») remplace les libellés provisoires ;
- un mois pas encore publié ou un fichier en échec n'empêche pas les autres ; l'état de chaque fichier est
  visible dans **Compte & données** (administrateurs).

```bash
npm run bulk:sync                                  # depuis EUROSTAT_BULK_FROM (2015-01) jusqu'au mois courant
npm run bulk:sync -- --from 2023-01 --to 2023-12   # une période
npm run bulk:sync -- --force                       # retraiter même les fichiers inchangés
npm run bulk:sync -- --file data/full_v2_202301.7z # un fichier déjà téléchargé
```

| Variable | Défaut | Rôle |
|---|---|---|
| `EUROSTAT_BULK_FILE_URL` | `…/api/dissemination/files/?file=comext%2FCOMEXT_DATA%2FPRODUCTS%2F{name}` | Adresse d'un fichier |
| `EUROSTAT_BULK_PATTERNS` | `full_v2_{YYYYMM}.7z,full{YYYYMM}.7z` | Noms essayés pour chaque mois, dans l'ordre |
| `EUROSTAT_BULK_FROM` | `2015-01` | Premier mois de la base |
| `EUROSTAT_BULK_DIR` / `EUROSTAT_BULK_KEEP` | `data/bulk` / `false` | Dossier de travail ; conserver les fichiers |
| `UPDATE_EUROSTAT_BULK` | `true` | Étape bulk de la mise à jour automatique |
| `UPDATE_EUROSTAT_API` | `false` | Complément par l'API (désactivé : limites de requêtes) |

L'import par l'API Comext (`npm run import:eurostat -- --products 22042109 --from 2023-01`) reste disponible
pour un dépannage ponctuel, mais n'est plus utilisé par défaut.

⚠️ L'environnement de développement n'a pas accès au serveur d'Eurostat : le téléchargement, la détection des
révisions, la décompression `.7z` et les deux formats d'en-têtes sont testés avec des fichiers et un serveur
locaux, mais un premier chargement réel doit être vérifié (`npm run bulk:sync -- --from 2024-01 --to 2024-01`),
notamment les noms de fichiers et de colonnes publiés au moment du déploiement.
Pour supprimer la démo après un chargement réel : `db.tradeflows.deleteMany({ source: "demo" })`.

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
| GET | `/api/stats/prices?product=&flow=&dimension=reporter\|partner` | Prix moyen, médian pondéré, quartiles, extrêmes par pays ; évolution |
| GET | `/api/stats/mirror?product=&reporters=FR&partners=US` | Déclarations croisées exportateur / importateur |
| GET | `/api/admin/status`, `POST /api/admin/update` | État des données, mise à jour manuelle (administrateurs) |
| GET | `/api/nomenclature`, `/api/nomenclature/:code` | Arborescence ; nœud NC02 / NC06 / NC08 avec parents et enfants |
| GET | `/api/trade`, `/api/trade/export.csv` | Lignes détaillées ; export CSV (1 000 lignes Gratuit, 100 000 Pro) |
| GET | `/api/products?q=`, `/api/products/:code` | Recherche ; fiche d'un code NC8 |
| GET/POST/PUT/DELETE | `/api/reports`, `/api/reports/:id`, `POST /api/reports/:id/blocks` | Rapports de l'utilisateur |

Toutes les routes statistiques acceptent `source=world` (données mondiales SH6) et `nc=brut` (codes tels que déclarés).
Filtres communs : `periodFrom` / `periodTo` (`AAAA-MM`), ou `yearFrom` / `yearTo` / `year` ;
`flow=import|export` ; `reporters=FR,DE` ; `partners=US,CN` ; `sections=IV,XVI` ; `chapters=22,84` ;
`product=2204` (préfixe de 2 à 8 chiffres). Chaque valeur est validée par liste blanche.

## Tests

```bash
npm test     # 73 tests : fichiers bulk (formats, .7z/.gz, intra-UE, totaux annuels, régimes, révisions,
             # idempotence, téléchargement conditionnel), : nomenclature (scissions, fusions, chaînes, réutilisations, permutations, conservation
             # de la masse, liens déduits), qualité (lignes corrompues), fusion partielle, priorité des sources,
             # devises, miroirs, connecteurs, verrou, mise à jour en échec partiel, API
```
