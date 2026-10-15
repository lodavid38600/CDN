# DouaneData — SaaS de données douanières Eurostat par code NC

Plate-forme **Node.js / Express / Vue 3 / MongoDB** pour analyser les échanges de marchandises
entre les **27 pays de l'UE** et les **pays hors UE**, code NC par code NC (nomenclature combinée
à 8 chiffres), au **mois près**, à partir des statistiques **Eurostat Comext**.

> « Quelle quantité la France a-t-elle exportée de vin entre mars 2018 et janvier 2019 ? »
> — c'est la question à laquelle l'outil répond en un instant.

## Fonctionnalités

### Côté client

| Menu | Ce qu'on y fait |
|---|---|
| **Accueil** | Recherche d'un produit par mots, actualités de l'outil, dernières mises à jour des données, codes NC modifiés, carte des pays couverts / en cours d'intégration / prévus |
| **Produits** | Recherche par mots (accents et ordre ignorés) ou par code ; navigation chapitres → sous-positions → codes NC8, sans chiffres avant la fiche du code NC8. **Toutes les données d'un code sur une seule fiche** (voir ci-dessous) |
| **Pays partenaires** | Liste des pays et fiche de chaque pays |
| **Comparer des produits** | 2 à 4 codes NC8 : valeur, volume, prix moyen et médian, évolution sur un an, principaux pays, évolution superposée (base 100 possible), marchés communs |
| **Déclarations** | Une ligne = un flux sur un mois, la plus récente d'abord ; flux des dernières déclarations (500 lignes qui apparaissent progressivement) ; recherche, tri, export CSV |
| **Tableau de bord** | Graphiques personnels avec leurs filtres : suivis (période glissante, mis à jour avec chaque import) ou figés (chiffres gardés en mémoire) ; réorganisables par glisser-déposer |
| **Rapports** | Générés en un clic, éditables, mode présentation, export **PDF** et **PowerPoint** |
| **Assistance** | Demandes (tickets) avec suivi, messagerie instantanée avec l'équipe |
| **Ma société** | Abonnement et fonctionnalités incluses, coordonnées, membres (gérés par les responsables) |
| **Factures** | Factures de la société, imprimables en PDF (responsables) |

### Sociétés, rôles et droits

Chaque utilisateur appartient à une **société** et **hérite de ses droits** : offre souscrite (Essai, Essentiel, Pro,
Entreprise), fonctionnalités ajoutées ou retirées au cas par cas, nombre de places, plafond d'export, échéance.
Une société suspendue ou dont l'abonnement est échu garde l'accès à l'accueil, à l'assistance et aux factures,
mais plus aux données. Tout est vérifié côté serveur ; l'interface n'affiche que ce que l'utilisateur a le droit de voir.

| Rôle | Droits |
|---|---|
| Membre (client) | Utilise l'outil selon l'offre de sa société, ouvre des demandes |
| Responsable (client) | En plus : coordonnées de la société, membres (ajout, rôle, désactivation, mot de passe), factures, toutes les demandes de la société |
| Commercial (équipe) | Sociétés, comptes clients, abonnements et droits, facturation, tickets, messagerie |
| Administrateur (équipe) | Tout, y compris le journal d'activité, l'administration du site (données, libellés des produits, actualités, pays annoncés, bandeau) et les comptes de l'équipe |

**Journal d'activité** : connexions (réussies, échouées), refus d'accès, comptes, sociétés, abonnements, factures,
support, exports, administration, erreurs ; filtrable par catégorie, niveau, utilisateur, société, dates ; export CSV ; conservé un an.

**Libellés des produits** : l'administrateur importe la table officielle de la nomenclature combinée (NC8, publiée
chaque année par la douane) depuis *Site et données → Libellés des produits* : Excel .xlsx, CSV, TSV ou texte ;
colonnes reconnues automatiquement, libellé « autosuffisant » préféré s'il existe. La recherche par mots s'en sert.

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

## Rapidité sur des millions de lignes

Les vues générales ne parcourent jamais toutes les lignes détaillées : des **tables de synthèse**
(par chapitre, par pays déclarant, par partenaire, pays × chapitre, par pays × partenaire × chapitre,
par code NC) sont reconstruites automatiquement après chaque import, et au démarrage du serveur si
elles sont absentes ou périmées. Chaque requête lit la plus petite table capable d'y répondre exactement.
Pendant une reconstruction, les tables précédentes restent servies (pages rapides, chiffres du dernier
import visibles à la fin de la préparation, bandeau « Préparation des données en cours ») ;
`STATS_STALE_CUBES=false` impose à la place la lecture des lignes détaillées. Les calculs sont
lancés en parallèle par année et par sens (`STATS_BUILD_PARALLEL`, 4 par défaut).

**Déclarations récentes** : pour les 3 derniers mois, les déclarations les plus importantes de chaque
mois et de chaque sens sont préparées au global (5 000), par pays de l'UE (1 500) et par partenaire
(500), avec leur nombre exact : le flux en direct et « les déclarations d'un pays » s'affichent
instantanément. Au-delà (pages lointaines, période plus ancienne, plusieurs pays), lecture détaillée.

Mesuré sur 20 millions de lignes (environ 130 millions de déclarations mensuelles, 2 ans, 27 pays UE,
148 partenaires) : toutes les pages en moins d'une seconde (fiche pays 0,1 s, déclarations d'un pays
0,2 à 0,5 s, flux en direct 0,6 s), sauf une recherche par pays sur 12 mois (≈ 7 s). Reconstruction
complète des tables : 9 min (16 min base froide). Diagnostic : `STATS_CUBES=false` désactive les tables.

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

Comptes de démonstration (mot de passe **demo12345**) : **demo@douane-saas.eu** (responsable d'une société, offre Pro),
**analyste@demo-sas.example** (membre), **commercial@douane-saas.eu** (commercial), **admin@douane-saas.eu** (administrateur).

### Avec les vraies données Eurostat (sans démo)

```bash
npm run install:all
cp server/.env.example server/.env        # NODE_ENV=production, JWT_SECRET, CORS_ORIGIN=http://localhost:4000
docker run -d --name douane-mongo -p 27017:27017 -v douane-mongo:/data/db mongo:7
npm run bulk:sync -- --from 2026-06 --to 2026-06   # 1 mois pour vérifier
npm run bulk:sync -- --from 2024-09                # puis 2 ans
npm run user:create -- --email moi@exemple.fr --password "motdepasse" --admin     # compte administrateur
# puis, dans l'outil : Équipe → Sociétés → Nouvelle société (ou --company "Société" --plan pro)
npm run build && npm start                          # http://localhost:4000
```

Réglages utiles dans `server/.env` : `SIGNUP_ENABLED=false` (comptes créés uniquement par l'équipe commerciale),
`SELLER_NAME`, `SELLER_ADDRESS`, `SELLER_SIRET`, `SELLER_VAT`, `SELLER_IBAN`, `SELLER_EMAIL` (mentions des factures).
Au démarrage, les comptes créés avant l'arrivée des sociétés sont rattachés automatiquement à une société.

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
| GET/PUT | `/api/auth/me`, `PUT /api/auth/me/password` | Profil, société, droits effectifs ; changement de mot de passe |
| GET | `/api/home` | Accueil : actualités, mises à jour, codes NC modifiés, couverture |
| GET/PUT/POST | `/api/company`, `/api/company/members` | Ma société et ses membres (responsables) |
| GET/POST | `/api/support/tickets`, `/api/support/chat` | Demandes et messagerie |
| GET | `/api/invoices` | Factures de la société (responsables) |
| * | `/api/admin/*` | Équipe : sociétés, utilisateurs, abonnements, tickets, messagerie, factures, journal, site et données (chaque route exige sa permission) |
| GET | `/api/nomenclature`, `/api/nomenclature/:code` | Arborescence ; nœud NC02 / NC06 / NC08 avec parents et enfants |
| GET | `/api/trade/mois`, `/api/trade/mois.csv` | Déclarations au mois, les plus récentes d'abord ; export CSV (plafond selon l'offre) |
| GET | `/api/products?q=`, `/api/products/:code` | Recherche ; fiche d'un code NC8 |
| GET/POST/PUT/DELETE | `/api/reports`, `/api/reports/:id`, `POST /api/reports/:id/blocks` | Rapports de l'utilisateur |
| GET/PUT, POST/DELETE | `/api/tableau-de-bord`, `/api/tableau-de-bord/widgets[/:id]` | Tableau de bord personnel (ordre, tailles, graphiques suivis ou figés) |

Toutes les routes statistiques acceptent `source=world` (données mondiales SH6) et `nc=brut` (codes tels que déclarés).
Filtres communs : `periodFrom` / `periodTo` (`AAAA-MM`), ou `yearFrom` / `yearTo` / `year` ;
`flow=import|export` ; `reporters=FR,DE` ; `partners=US,CN` ; `sections=IV,XVI` ; `chapters=22,84` ;
`product=2204` (préfixe de 2 à 8 chiffres). Chaque valeur est validée par liste blanche.

## Tests

```bash
npm test     # 90 tests : droits (héritage, isolation entre sociétés, rôles, journal, migration), libellés et
             # recherche par mots, vue mensuelle, tables de synthèse, fichiers bulk (formats, .7z/.gz, intra-UE, totaux annuels, régimes, révisions,
             # idempotence, téléchargement conditionnel), : nomenclature (scissions, fusions, chaînes, réutilisations, permutations, conservation
             # de la masse, liens déduits), qualité (lignes corrompues), fusion partielle, priorité des sources,
             # devises, miroirs, connecteurs, verrou, mise à jour en échec partiel, API
```
