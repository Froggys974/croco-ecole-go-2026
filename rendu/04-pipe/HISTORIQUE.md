# 04 · Historique

## Les pistes

| Piste | Coût à l'exécution | Types | Mutations | Verdict |
| --- | --- | --- | --- | --- |
| Fonction runtime `Pipe(x any, fns ...func(any) any) any` | une liste, une boucle, des `any` donc des allocations | perdus : une assertion par étape, qui peut paniquer | l'accumulateur modifié à chaque tour | rejetée |
| Fonctions génériques `Pipe2[A, B]`, `Pipe3[A, B, C]`… | le coût caché des génériques (12 ns contre 3,3, mesuré) | exacts | aucune | rejetée : Go n'a pas de génériques variadiques, une version par nombre d'étapes |
| **Pipe déroulé à la traduction** | **aucun** : des appels successifs | **exacts, à chaque étape** | **aucune** : une variable par étape | **retenue** |

En une phrase : `pipe` n'existe pas à l'exécution, c'est une façon d'écrire des appels en chaîne.
On le traduit donc en appels en chaîne.

## Comment le transpileur connaît le type de chaque étape

DuploJS décrit `pipe` par des **surcharges**, une par nombre d'étapes :
`pipe(input, f1: (in: I) => O1, f2: (in: O1) => O2, …)`. Le checker résout la bonne à l'endroit de
l'appel, donc on sait ce que chaque étape attend et ce qu'elle rend.

## Pas de boucle dans le transpileur

Les étapes sont traitées par **récursion** : on applique la première, puis on recommence avec le
reste. C'est la règle du projet pour le code du transpileur.

## Une correction par rapport à nos premières notes

Une première version du carnet prévoyait un `if` de sortie après chaque étape (« court-circuit sur
Fail »). C'est faux pour `DCommon.pipe` : il passe la valeur à l'étape suivante, quelle qu'elle
soit. Le court-circuit est le comportement de `DEither.rightPipe` (exo 07), qui reprendra le même
déroulage avec une sortie au premier échec.

## Limites

- `pipe(x, ...fonctions)` : étapes inconnues à la traduction, refus clair.
- L'ordre d'évaluation : JS évalue toutes les étapes avant le premier appel, ici chacune à son tour.
  Aucune différence pour un nom de fonction ; seule une étape qui est elle-même un appel avec effet
  de bord (`pipe(x, fabrique())`) la verrait.
