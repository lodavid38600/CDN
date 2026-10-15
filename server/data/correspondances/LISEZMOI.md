# Tables de correspondance de la nomenclature

Chaque fichier CSV décrit les changements de codes entre deux versions de la nomenclature :
une ligne par couple « ancien code ; nouveau code ». L'année d'application est lue dans le nom
du fichier (`CN2021_CN2022.csv` → 2022) ou dans une colonne `year`.

- Codes NC à 8 chiffres (NC8, Eurostat) ou SH à 6 chiffres (SH6, données mondiales).
- Espaces et points acceptés dans les codes (`8517 12 00`).
- Un code qui continue d'exister pour une partie des marchandises peut figurer vers lui-même.

Ces fichiers sont lus à chaque synchronisation (`npm run nc:sync`, ou automatiquement après chaque
mise à jour). Les tables publiées par Eurostat peuvent être téléchargées automatiquement via la
variable `NC_CORRESPONDENCE_URLS`. Les changements absents des tables sont déduits des données
(un code qui disparaît, remplacé l'année suivante par de nouveaux codes de la même position).
