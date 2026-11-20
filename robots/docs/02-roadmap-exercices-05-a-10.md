# 02 — Spécifications Techniques des Exercices 00 à 10 (Branche Hybride)

> **État actuel sur `hybrid-arch` :** les exercices **00 à 04** sont implémentés et validés E2E (`0 B/op`, voir [rendu/08-approche-hybride/README.md](../../rendu/08-approche-hybride/README.md)). Les exercices **05 à 10** restent à implémenter sur cette branche (résumé comparatif dans [rendu/09-vision-long-terme/README.md](../../rendu/09-vision-long-terme/README.md)).

## Matrice d'avancement

| Projet | Nouveaux noeuds / APIs TS | Statut hybride | Stratégie Go retenue pour `hybrid-arch` |
| :---: | :--- | :---: | :--- |
| **00–04** | `add`, `Success \| Fail`, `whenIsRight`, `DArray.coalescing`, `DCommon.pipe`, `-1` | **Fait** | `EitherCompact[T]`, `EitherOrFail[T]`, `pipe` déroulé + `whenIsRight` à plat dans `before`, `coalescing` inline `[]T{x}` |
| **05** | `ArrowFunction`, `ArrayLiteralExpression`, `whenIsRightOtherwise`, `DArray.map`, `DString.to` | **À faire** | `FunctionLiteral` + `SliceLiteral` + `ArrayMap` 1 arg vs 2 args + `StringFromNumber` (`encoding/json`) |
| **06** | Ternaire (`a ? b : c`), `ObjectLiteralExpression`, `DEither.left`, `matchInformation` | **À faire** | Ternaire à plat dans `before` ; `matchInformation` en `switch r.GetInformation()` (ou `switch r.Kind` sur `EitherTagged`) |
| **07** | Multi-fichiers, opérateur `/`, `DEither.rightPipe` | **À faire** | Dépliage séquentiel + court-circuit au premier `Left` (`if !step.IsRight()`) avec élargissement vers `EitherTagged` / `Either` |
| **08** | `TupleTypeNode`, `ArrayBindingPattern`, `DArray.map` imbriqué | **À faire** | Structs contiguës `Tuple2..Tuple8` (`Tuple3[T0, T1, T2]`) + extraction en tête de bloc (`Sourced_x := Generated_p.V0`) |
| **09** | `DEither.group` | **À faire** | Cas littéral `[fn1(), fn2()]` déplié sans slice, sinon `for range` + `make([]T, len)` + `break` au premier `Left` |
| **10** | `async`, `await`, `Promise<T>`, `rightAsyncPipe`, `asyncGroup`, `asyncPipe` | **À faire** | `Promise[T]` sur goroutine + `close(chan struct{})` pour multi-`Await()` ; `asyncGroup` séquentiel |

---

## Fiches d'implémentation pour la suite (`05` à `10`)

### Projet 05 — Fléchées, tableaux, `whenIsRightOtherwise`, `map` et `DString.to`
- **`ArrowFunction` (`() => [-12]`) :** traduire en `GoAST.FunctionLiteral` (réutiliser le mécanisme `Callable` de `callable.ts`).
- **`whenIsRightOtherwise(input, fnR, fnL)` :** appliquer le même dépliage à plat dans `before` que `whenIsRight` (`if step.IsRight() { out = ... } else { out = ... }`), avec lecture directe `.Value` / `.RightValue` selon la struct hybride.
- **`DArray.map` & `DString.to` :**
  - En JS, `DArray.map` passe `(element, { index, self })` mais `DString.to(n)` n'accepte qu'un argument. Prévoir `ArrayMap` 1 arg par défaut et `ArrayMapWithParams` si le callback déclare 2 paramètres.
  - Préférer `make` + `for range` (cf. `for range` choisi dans [rendu/06-collections/README.md](../../rendu/06-collections/README.md)).
  - `StringFromNumber` : déléguer les nombres finis à `encoding/json` (règles ES6), et traiter à part `NaN`, `±Infinity` et `-0` -> `"0"`.
- **Étiquettes d'intersection (`string & Number`) :** retirer les marques fantômes TS dans `type/intersection.ts` tout en rejetant les intersections impossibles (`string & number`).

### Projet 06 — Ternaire, `DEither.left` et `matchInformation`
- **Ternaire `one < 0 ? one : two` :** traduire via `var Generated_N T; if ... { Generated_N = ... } else { Generated_N = ... }` dans `before`.
- **`DEither.left("info", payload?)` :** gérer la forme à 1 argument (`DEither.Left<"info">`) en injectant `shard_dependencies.JSUndefined{}` par défaut.
- **`matchInformation(result, { ... })` :** traduire en `switch` sur `result.GetInformation()` (ou `result.Kind` si `EitherTagged`) dans `before`, avec lecture typée dans chaque `case` sans allouer de `map[string]func(any) any`.

### Projet 07 — Multi-fichiers et `DEither.rightPipe`
- Déplier `DEither.rightPipe(in, step1, step2, ...)` dans `before` comme `DCommon.pipe`, mais en insérant un court-circuit dès qu'une étape est `Left` (`!step.IsRight()`). Coercer les sorties d'erreurs vers l'union cible (`EitherTagged` ou `Either`) via `coerceGoExpression`.

### Projet 08 — Tuples et destructuring de paramètres
- Traduire `[number, number, number]` en `shard_dependencies.Tuple3[float64, float64, float64]` (24 octets contigus sur la pile, zéro boxing `[]any`).
- Pour `([one, two, divisor]) => ...` : émettre un paramètre synthétique `Generated_p Tuple3[...]` et injecter `Sourced_one := Generated_p.V0`, `Sourced_two := Generated_p.V1`, `Sourced_divisor := Generated_p.V2` en tête du corps Go.

### Projet 09 — `DEither.group`
- Si l'argument est un `ArrayLiteralExpression` (`DEither.group([fn1(), fn2()])`), déplier les appels séquentiellement sans allouer un `[]Either`.
- Sinon (`[]Either` dynamique), boucler avec `for range`, retourner au premier `Left`, ou construire la slice résultat via `make([]T, len(items))`.

### Projet 10 — Asynchronisme (`async` / `await` / `Promise`)
- `async function f(...) T` → `func f(...) *Promise[T]` ; `await expr` → `expr.Await()`.
- `Promise[T]` : exécution sur goroutine avec fermeture `close(p.ch)` sur un `chan struct{}` afin d'autoriser plusieurs `.Await()` sur la même promesse sans blocage.
- `DEither.asyncGroup` : exécuter chaque getter **séquentiellement dans l'ordre** via `.Await()` et s'arrêter au premier `Left` (conforme à `@duplojs/lang/either`).
