# Pistes d'Implémentation pour la Suite (Exercices 05 à 10 et Confort)

Notes de conception pour implémenter proprement les prochains exercices sur `hybrid-arch`, dans le strict respect d'`AGENTS.md` et `.agents/skills/typescript-to-go/SKILL.md` (**zéro `as any`**, **zéro `!`**, toujours `context.resolveReferenceModule` au lieu de matcher des noms textuels).

> Pour les choix déjà implémentés (`EitherCompact`, `EitherTagged`, `EitherOrFail`, `pipe` hybride), voir [rendu/08-approche-hybride/README.md](../../rendu/08-approche-hybride/README.md).

## 1. Briques prioritaires (Exercices 05 à 10)

| # | Fonctionnalité | Exo cible | Note d'implémentation propre (spécifique branche hybride) |
| :---: | :--- | :---: | :--- |
| **1** | **Ignorer `TypeAliasDeclaration` et `InterfaceDeclaration` dans `transformSourceFile.ts`** | **05+** | Débloque tout fichier contenant `type Foo = ...` ou `interface Bar { ... }` sans lever `notfound-transformer`. |
| **2** | **`ArrowFunction`, `DArray.map`, `DString.to`, `whenIsRightOtherwise`** | **05** | Traduire `ArrowFunction` dans `Callable` ; garder `whenIsRightOtherwise` déplié à plat dans `before` avec lecture `.Value`/`.RightValue` (jamais d'IIFE) ; `ArrayMap` (`make` + `for range`, variante 1 arg vs 2 args) et `StringFromNumber` via `encoding/json`. |
| **3** | **Factory de méthodes `Either` & `DEither.left("info")` à 1 arg** | **06** | Factoriser `IsRight()`, `GetInformation()`, `GetValue()` pour `EitherLeft[V]` / `EitherRight[V]` / `EitherError[V]`. Si `DEither.left` n'a qu'un argument, injecter `shard_dependencies.JSUndefined{}`. |
| **4** | **`DEither.rightPipe` (déroulage court-circuité)** | **07** | Réutiliser `getPipeSteps` + `applySteps` de `pipe.ts`, en insérant `if !step.IsRight()` entre étapes et en résolvant les callbacks via `resolveReferenceModule`. |
| **5** | **`Tuple2..Tuple8` contiguës + `ArrayBindingPattern`** | **08** | Structs value-type génériques (`V0..VN-1`) plutôt que `[]T0` ou `[]any`, avec extraction en tête de fonction. |
| **6** | **`DEither.group` (littéral déplié vs dynamique `for range`)** | **09** | Déplier le cas `[fn1(), fn2()]` via `isPureGoExpression` sans allouer de slice intermédiaire ; sur tableau dynamique, utiliser `make([]T, len)` + `break`. |
| **7** | **`Promise[T]` concurrente + `asyncGroup` séquentiel** | **10** | Goroutine + `close(chan struct{})` pour supporter multi-`Await()`. Exécuter les getters de `asyncGroup` séquentiellement via `.Await()`. |

## 2. Extensions de confort hors exos `00`–`10`

| # | Fonctionnalité | Note d'implémentation propre |
| :---: | :--- | :--- |
| **8** | **`type/intersection.ts` (`number & DNumber.Positive`)** | Retourner le premier membre concret non-tag sans `before`, en rejetant explicitement (`context.error`) les intersections contradictoires (`string & number`). |
| **9** | **`DString.length`, `DString.includes`, `DString.test(s, regex)`** | `length` -> `float64(utf8.RuneCountInString(s))` ; `includes` -> `strings.Contains`. Pour `test`, hisser `var Generated_N = regexp.MustCompile(...)` au niveau package (`declarations`) et convertir les flags `/i`, `/m`, `/s` en préfixe RE2 `(?ims)`. |
| **10** | **`nullLiteral` (`null` -> `JSNull{}`)** | Ajouter le transformer `NullKeyword` symétrique à `undefined` -> `JSUndefined{}`. |
| **11** | **`DEither.unwrapRight` + narrowing par `Symbol`** | Identifier les variables narrowées via `typeChecker.getSymbolAtLocation` (jamais par `node.text`). |
