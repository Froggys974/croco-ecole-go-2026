# 08 · Pistes explorées et cheminement

L'approche hybride s'est construite par itérations mesurées sous Go `1.27.4`, Node `v24.22.3` et Bun `1.4.4`, en vérifiant systématiquement les allocations (`runtime.MemStats`) et l'échappement compilateur (`-gcflags="-m"`).

## L'évolution en 4 étapes

| Étape | Idée testée | Verdict | Ce que la mesure a montré |
| :--- | :--- | :---: | :--- |
| **0. Interface `Either` naïve** | Chaque constructeur (`EitherFail`, `EitherSuccess[T]`) porte `Information string` et circule derrière `interface Either`. | **écartée** | Dès qu'une fonction dépasse le seuil d'inlining, `Information string` force une allocation tas à chaque retour (`33,8 B/op`, `43,1 ns`). |
| **1. Hybride Phase 1 (`0 B` / `8 B`)** | `EitherFail` et `EitherOk` deviennent des `struct{}` (`0 octet`) ; `EitherSuccess[T]` ne stocke plus `Information`. | **intermédiaire** | **-71 % de RAM** (`33,8 -> 9,75 B/op`) et vitesse x2 sans changer d'API, mais `GetValue().(T)` boxe encore à la lecture. |
| **2. Hybride Phase 2 (`EitherCompact` + `EitherTagged`)** | Spécialiser `Success<T> \| Fail` et les unions `Either` homogènes en structs génériques sur la pile, avec lecture directe `.Value` / `.RightValue`. | **retenue** | Supprime le boxing sur les pipelines `Either` et divise la latence par 4 à 19 (`s09` : `84,8 -> 3,62 ns`, `s07` : `3,79 -> 0,96 ns`). |
| **3. Option C1 (`EitherOrFail[T]`)** | Spécialiser aussi les sorties binaires mixtes `T \| Fail` (comme `[]float64 \| Fail` renvoyé par `whenIsRight(..., DArray.coalescing)`). | **retenue** | Élimine le dernier repli `any` sur `p02`–`p04` et `s04`–`s05` (`32 B -> 0 B/op`, `27 -> 1,91 ns`). |

## Les pistes laissées derrière nous

| Piste écartée | Pourquoi elle a été abandonnée |
| :--- | :--- |
| **Full interface `Either`** | `GetValue().(T)` renvoie `any`, ce qui force du boxing sur le tas hors inlining, et ne couvre pas les sorties mixtes `T \| Fail`. |
| **Struct universelle `Value` 64 octets** | Copie 64 octets à chaque passage, perd le typage statique sur les slices/objets (`object any`), et souffre sur `MarshalJSON` (sur `u03` : `2 241 ns / 10,6 allocs` contre **`718 ns / 4,2 allocs`** en hybride, soit **3,1x plus rapide**). |
| **IIFE `func() Value { ... }()` dans `whenIsRight`** | Empile des closures dans un `pipe`, fait dépasser le seuil d'inlining Go (80 noeuds AST) et fait échapper les valeurs sur le tas. |
| **`json.NewEncoder` direct dans `CommonPrint`** | Entoure les chaînes de guillemets (`"hello"` au lieu de `hello`), cassant la parité E2E avec Node/Bun. Remplacé par un `switch (any)(v).(type)`. |

## Le `pipe` hybride : déroulage séquentiel et repli TypeChecker

Trois mécanismes rendent ce déroulage fiable :

1. **Dépliage à plat dans `before` :** chaque `whenIsRight` devient `var out ...; if step.IsRight() { ... } else { ... }` avec lecture directe `.Value`/`.RightValue`. Aucune closure, le code reste inlinable.
2. **Inférence hybride (`getPipeSteps` & `callable.ts`) :** quand la grosse surcharge générique de `DCommon.pipe` renvoie `ErrorType` ou `TypeParameter`, on se rabat sur `typeChecker.getTypeAtLocation(node)`. De plus, tester `signature.typeParameters.length > 0` (et non la simple truthiness d'un `[]`) permet à `Callable` d'accepter toutes les fonctions utilisateur dans les chaînes multi-modules (`s08`, `s09`).
3. **Coercition sans struct intermédiaire (`coerce.ts`) :** un `return DEither.success(x)` ciblant `EitherCompact[T]` ou `EitherTagged[R, L]` est réécrit directement en `EitherCompactSuccess[T](x)` sans construire d'objet intermédiaire.

## Tableau comparatif par scénario (médiane P50)

Mesuré sous Docker sur 1 000 000 opérations par cas (parité `Node == Bun == Go` vérifiée ; les deux branches Go tournent à `0 B/op · 0 alloc/op` sur l'ensemble des cas supportés) :

| Scénario | Node | Bun | Go `develop` | **Go `hybride`** |
| :--- | :---: | :---: | :---: | :---: |
| `p00_add` | `449,75 ns` | `8,25 ns` | `5,73 ns` | **`0,48 ns`** |
| `p01_add_branch` | `440,09 ns` | `8,10 ns` | `5,73 ns` | **`0,48 ns`** |
| `p02_when_is_right` | `508,74 ns` | `37,29 ns` | `14,11 ns` | **`0,48 ns`** |
| `p03_pipe_when_is_right` | `574,76 ns` | `75,51 ns` | `14,08 ns` | **`0,48 ns`** |
| `p04_pipe_fail_branch` | `502,58 ns` | `78,41 ns` | `14,36 ns` | **`1,60 ns`** |
| `s01_auth_guard` (`Ok \| Fail`) | `392,29 ns` | `6,99 ns` | `7,20 ns` | **`4,06 ns`** |
| `s02_banking_transfer` (`EitherTagged`) | `488,26 ns` | `7,72 ns` | `23,88 ns` | **`10,56 ns`** |
| `s03_http_status_router` (`EitherTagged`) | `299,22 ns` | `6,48 ns` | `18,45 ns` | **`10,90 ns`** |
| `s04_batch_coalesce_direct` (`EitherOrFail`) | `517,91 ns` | `37,89 ns` | `22,97 ns` | **`1,91 ns`** |
| `s05_pipe_coalesce_curried` (`EitherOrFail`) | `539,00 ns` | `46,41 ns` | `22,46 ns` | **`1,91 ns`** |
| `s06_mixed_union_dispatch` (5 types mixtes) | `481,50 ns` | `21,49 ns` | `12,96 ns` | **`7,06 ns`** |
| `s07_nested_either_audit` (`EitherCompact`) | `391,81 ns` | `16,00 ns` | `7,58 ns` | **`0,96 ns`** |
| `s08_ecommerce_pricing_pipe` (multi-modules) | `1 013,60 ns` | `144,34 ns` | *non supporté* | **`3,82 ns`** |
| `s09_risk_pipeline_4stages` (4 étapes) | `2 041,31 ns` | `127,79 ns` | *non supporté* | **`3,62 ns`** |
| `s10_dynamic_clock_entropy` (horloge `%`) | `805,21 ns` | `120,97 ns` | *non supporté* | **`198,03 ns`** |

## Décisions de détail et suite

- **Pureté des expressions (`expressionPurity.ts`) & packages relatifs :** suppression des `Generated_N` superflues sur les identifiants/littéraux purs, et retrait du préfixe `projectWorkDirectory` dans `createSourceIdentifier` (`Sourced_index001ats` au lieu d'un chemin absolu).
- **Sécurisation `isLeft` / `isRight` sur `any` :** motivée par le bug `Sourced_batch.IsRight undefined (type any)`, résolue par `EitherIsRightAny` / `EitherIsLeftAny` (`type switch` sur `Either`).
- **Pistes suivantes :**
  - **Sum-Types 32B** pour les unions mixtes `s06` (mesurée à `3,96 ns` en micro-bench contre `6,94 ns` pour `Value` 64B et `13,02 ns` pour `any`).
  - **Spécialisation `int64` sur `%`** pour supprimer les 4 appels `math.Mod` qui expliquent les `198 ns` de `s10`.
  - **Tuples et concurrence (`08`–`10`) :** `Tuple2..Tuple8` contiguës (vs `[]Value` ou `[]T0`) et `Promise[T]` sur goroutine + `chan struct{}`.
