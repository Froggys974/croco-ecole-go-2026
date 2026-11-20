# Carnet Technique — Garde-fous & Optimisations (Branche Hybride)

Checklist technique maintenue pour les évolutions futures de [`hybrid-arch`](https://github.com/Froggys974/croco-ecole-go-2026/tree/hybrid-arch).
Les réalisations déjà en place (`EitherCompact`, `EitherTagged`, `EitherOrFail`, `pipe` hybride, `expressionPurity`, `CommonPrint`) sont documentées dans [rendu/08-approche-hybride/PISTES.md](../../rendu/08-approche-hybride/PISTES.md).

## 1. Garde-fous compilateur Go à conserver ou généraliser

| ID | Garde-fou | État hybride | Règle à vérifier sur les prochains transformers |
| :--- | :--- | :---: | :--- |
| **COMP-01** | **Anti-narrowing (`resolveValueType`)** | **En place** | Toujours lire le type déclaré (`getTypeOfSymbol`) sur les variables, paramètres et frontières pour ne pas récupérer un type rétréci dans un `if`. |
| **COMP-02** | **Singletons `goImports` + strip `shard_dependencies`** | **En place** | Tout nouvel import Go passe par `sharedDependency/goImports.ts` ; la couche de build supprime l'import si non utilisé. |
| **COMP-03** | **Rejet strict des types non supportés** | **À surveiller** | Dans `union` et `intersection`, toujours propager `context.error` si un membre non-tag échoue (ne jamais masquer en `any` ou `float64`). |
| **COMP-04** | **Court-circuit `&&` / `||` + garde `BooleanLike`** | **À vérifier** | Si le côté droit d'un `&&` / `||` produit des statements dans `before`, l'encapsuler pour garantir qu'il ne s'exécute pas en cas de court-circuit JS. |
| **COMP-05** | **Paramètres optionnels & rest en `FunctionDeclaration`** | **À ajouter (`05`+)** | Aligner `declaration/function.ts` sur `expression/function.ts` : gérer ou rejeter proprement `b?: T`, valeurs par défaut et `...rest`. |
| **COMP-06** | **Opérateurs bitwise & `%` sur `float64`** | **`%` fait (`math.Mod`)** | `&`, `|`, `^`, `<<`, `>>` génèrent du Go invalide sur `float64` : soit convertir en `int64`, soit rejeter explicitement. |

## 2. Optimisations ciblées identifiées (post-hackathon)

| ID | Levier | Gain mesuré / attendu | Où intervenir |
| :--- | :--- | :--- | :--- |
| **OPT-01** | **Sum-Types générées `32 B` sur unions mixtes 3+ types** | Remplace le repli `any` sur `s06` : mesuré à **`3,96 ns / 0 B`** en micro-bench (vs `10,42 ns` en `any`). | `transformers/type/union/` |
| **OPT-02** | **Spécialisation `int64` pour `%`** | Supprime les 4 appels `math.Mod` (~35 ns/appel) qui expliquent les `202,54 ns` de `s10`. | `transformers/expression/binary.ts` |
| **OPT-03** | **Budget d'inlining Go (80 noeuds AST)** | Auditer chaque nouveau combinateur (`whenIsRightOtherwise`, `rightPipe`, `matchInformation`) avec `go build -gcflags="-m"` pour éviter les escapes sur le tas. | Suite `/benchmark` |
| **OPT-04** | **Build release (`-ldflags="-s -w"`, `-pgo`)** | `-34,3 %` sur la taille binaire avec `-s -w` ; `+6,5 %` médian avec `-pgo` sur un profil d'exécution représentatif. | Build Go / CLI |
