# 07 · Méthode et vérification

Ce dossier décrit **notre méthode de travail** : le cheminement de pensée qu'on a suivi à chaque
exo, de la question de départ jusqu'à la vérification du Go produit.

## La problématique

Comment décider entre plusieurs traductions possibles, et comment prouver que le Go produit fait
la même chose que le TypeScript ?

## La méthode, à chaque exo

1. **Lire l'exo comme une question** : pas « traduis `whenIsRight` », mais « comment traduire un
   appel qui reçoit une fonction ? ».
2. **Lire ce que fait vraiment DuploJS** : le JS (`.mjs`), les types (`.d.ts`), la doc.
3. **Séparer ce qui est connu à la traduction de ce qui dépend de la valeur** : seul le second reste
   un test dans le Go.
4. **Chercher le mécanisme général** (l'appelable, le déroulage, la `Value`), pas le cas de l'exo.
5. **Construire en AST Go**, jamais en texte : le printer écrit toujours un Go bien formé.
6. **Mesurer avant de choisir**, quand plusieurs pistes se valent.
7. **Vérifier** : `tsc` sur le transpileur, puis les tests différentiels sur le Go produit.

## Les 4 règles du Go produit

| Règle | Comment |
| --- | --- |
| Aucune mutation visible | Un `if` au milieu d'une expression devient une fonction appelée tout de suite ; un pipe, une variable par étape. |
| Chaque valeur calculée une fois | Une expression utilisée deux fois est d'abord rangée dans une variable. |
| Les types exacts du checker | Pas de générique Go sur les types de données (`CommonPrint[T]` seul est générique pour l'affichage), pas de `any` hors de la case `object`. |
| Refuser plutôt que se tromper | Ce qui n'est pas traduit est refusé avec un message qui le nomme. Jamais de Go faux en silence. |

## Le test différentiel

Le même programme est lancé deux fois, et les sorties sont comparées **au caractère près** :

1. en TypeScript, avec `tsx` (l'affichage de `DCommon.print` remplacé par du JSON) ;
2. en Go : transpilation, `go vet`, `go run`.

Certains cas doivent au contraire être **refusés** avec une erreur claire. Le corpus contient
64 cas : les exos, des cas limites, et des refus attendus (exécutés dans un banc de test local non versionné dans le dépôt).

**Pourquoi c'est indispensable :** plusieurs bugs compilaient sans erreur et donnaient un résultat
plausible (le `&&` qui ne court-circuitait plus, la mauvaise case pour `"a" | "b"`). `go build`
seul ne les voyait pas.

## Les mesures

Benchmarks Go (`go test -bench -benchmem`), 3 passes, même machine, fonctions non inlinées pour
imiter du code généré (micro-benchmarks exploratoires lancés localement pour `02` et `06` ; suite
de référence sur les exos `01` à `04` versionnée dans `/benchmark/`). Elles ont renversé deux
prédictions (dossier 02) et tranché la boucle de `map` (dossier 06). Limite : ce sont des
micro-benchmarks, le coût du ramasse-miettes y est sous-estimé.

## Résultats

| Vérification | Résultat |
| --- | --- |
| `tsc` sur le transpileur | 0 erreur |
| Exos 00 à 05 | sortie Go identique à TypeScript |
| Corpus différentiel | 61 cas conformes sur 64 |

## Limites connues

| Cas | État | Pourquoi |
| --- | --- | --- |
| Fonction du projet avec un paramètre optionnel (`b?: number`) passée en rappel | Go invalide (refusé par le compilateur Go) | La fonction déclarée type `b` en `float64`, l'appel lui passe `undefined`. Correction prévue : typer `b?` en `T \| undefined`. |
| `x as T` | refusé | Pas encore traduit ; prévu : `x` converti en `T`. |
| `checkUserName` (cas 50) | refusé | Fonctions DuploJS pas encore traduites (`DString.test`…). |
| Objets, `typeof`, boucles, génériques, `void`, `async` | refusés | Pas encore traduits ; refus clairs. |
| Format de `print` | écart connu | Go affiche du JSON, tsx le format de Node : question posée aux organisateurs. |
| Benchmarks dans `/benchmark/` | versionnés | Suite de mesure Go/Node/Bun intégrée au dépôt (avec une version portable Docker sur la [branche hybride](https://github.com/Froggys974/croco-ecole-go-2026/tree/feature/hybrid-either-and-pipe/benchmark)). |
