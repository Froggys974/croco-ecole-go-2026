# 08 · Pistes explorées et cheminement

L'approche hybride s'est construite par itérations mesurées sous Go `1.27.4`, Node `v24.22.3` et Bun `1.4.4`, en vérifiant systématiquement les allocations (`runtime.MemStats`) et l'échappement compilateur (`-gcflags="-m"`).

## L'évolution en 4 étapes

| Étape | Idée testée | Verdict | Ce que la mesure a montré |
| :--- | :--- | :---: | :--- |
| **0. Interface `Either` naïve** | Chaque constructeur (`EitherFail`, `EitherSuccess[T]`) porte `Information string` et circule derrière `interface Either`. | **écartée** | Dès qu'une fonction dépasse le seuil d'inlining, `Information string` force une allocation tas à chaque retour (`33,8 B/op`, `43,1 ns`). |
| **1. Hybride Phase 1 (`0 B` / `8 B`)** | `EitherFail` et `EitherOk` deviennent des `struct{}` (`0 octet`) ; `EitherSuccess[T]` ne stocke plus `Information`. | **intermédiaire** | **-71 % de RAM** (`33,8 -> 9,75 B/op`) et vitesse x2 sans changer d'API, mais `GetValue().(T)` boxe encore à la lecture. |
| **2. Hybride Phase 2 (`EitherCompact` + `EitherTagged`)** | Spécialiser `Success<T> \| Fail` et les unions `Either` homogènes en structs génériques sur la pile, avec lecture directe `.Value` / `.RightValue`. | **retenue** | Supprime le boxing sur les pipelines `Either` et divise la latence par 4 à 20 (`s09` : `84,8 -> 4,24 ns`, `s07` : `3,79 -> 0,96 ns`). |
| **3. Hybride Phase 3 (`EitherOrFail[T]`)** | Spécialiser aussi les sorties binaires mixtes `T \| Fail` (comme `[]float64 \| Fail` renvoyé par `whenIsRight(..., DArray.coalescing)`). | **retenue** | Élimine le dernier repli `any` sur `p02`–`p04` et `s04`–`s05` (`32 B -> 0 B/op`, `27 -> 1,91 ns`). |

## Anatomie mémoire et arbitrages (`unsafe.Sizeof`)

La taille de la struct et la présence de pointeurs internes (`string` = 16 octets dont 1 pointeur, `any` = 16 octets dont 2 pointeurs) pilotent directement l'échappement pile/tas en Go :

| Représentation | `unsafe.Sizeof` (`amd64`) | Pointeur interne | Effet pratique |
| :--- | :---: | :---: | :--- |
| `EitherFail{}` / `EitherOk{}` | `0 octet` | Non | Mis dans une interface, pointe sur `runtime.zerobase` : 0 allocation même hors inlining. |
| `EitherCompact[float64]` | `16 octets` | Non | Copie légère sur la pile, 0 allocation même en `//go:noinline`. |
| `Value` (`develop`) | `64 octets` | Oui (`message`, `text`, `object`) | Type unique sans conversion entre unions ; 0 alloc sur primitifs, mais copie 64B et `any` pour slices/objets. |

Cet arbitrage explique aussi l'écart sur `MarshalJSON` (mesuré en micro-benchmark exploratoire `u03` : `2 241 ns / 10,6 allocs` sur `Value` contre `718 ns / 4,2 allocs` en hybride, soit **3,1x plus rapide**) : la sérialisation générique d'une `Value` passe par une struct temporaire `eitherJSON` contenant quatre `*JSNull` et une double réflexion `json.Marshal`, là où des structs spécialisées renvoient directement un `[]byte` préformaté pour les constantes (`Fail`/`Ok`) ou leurs champs typés.

## Les pistes laissées derrière nous

| Piste écartée | Pourquoi elle a été abandonnée dans cette branche |
| :--- | :--- |
| **Full interface `Either`** | `GetValue().(T)` renvoie `any`, ce qui force du boxing sur le tas hors inlining, et ne couvre pas les sorties mixtes `T \| Fail`. |
| **IIFE `func() Value { ... }()` dans `whenIsRight`** | Empile des closures dans un `pipe`, fait dépasser le seuil d'inlining Go (80 noeuds AST) et freine les optimisations de `gc`. |
| **`json.NewEncoder` direct dans `CommonPrint`** | Entoure les chaînes de guillemets (`"hello"` au lieu de `hello`), cassant la parité avec Node/Bun sur les chaînes brutes et `undefined`. Remplacé par un `switch (any)(v).(type)`. |

## Le `pipe` hybride : déroulage séquentiel et repli TypeChecker

Trois mécanismes rendent ce déroulage fiable :

1. **Dépliage à plat dans `before` :** chaque `whenIsRight` devient `var out ...; if step.IsRight() { ... } else { ... }` avec lecture directe `.Value`/`.RightValue`. Aucune closure, le code reste inlinable.
2. **Inférence hybride (`getPipeSteps` & `callable.ts`) :** quand la grosse surcharge générique de `DCommon.pipe` renvoie `ErrorType` ou `TypeParameter`, on se rabat sur `typeChecker.getTypeAtLocation(node)`. De plus, tester `signature.typeParameters.length > 0` (et non la simple truthiness d'un `[]`) permet à `Callable` d'accepter toutes les fonctions utilisateur dans les chaînes multi-modules (`s08`, `s09`).
3. **Coercition sans struct intermédiaire (`coerce.ts`) :** un `return DEither.success(x)` ciblant `EitherCompact[T]` ou `EitherTagged[R, L]` est réécrit directement en `EitherCompactSuccess[T](x)` sans construire d'objet intermédiaire.

## Tableau comparatif par scénario (médiane P50)

Mesuré sur la même graine (`56658`) et 1 000 000 opérations par cas (parité `Node == Bun == Go` vérifiée ; `0 B/op` sur 14/15 cas en hybride — `0,4 B/op` sur le repli `any` de `s06` — et sur 13/14 cas sur `develop` — `9,17 B/op` sur `s07`). Seul `s10` reste non supporté sur `develop` (`%` sur `float64`).

| Scénario | Node | Bun | Go `develop` | **Go `hybride`** |
| :--- | :---: | :---: | :---: | :---: |
| `p00_add` | `442,25 ns` | `7,66 ns` | `5,73 ns` | **`0,48 ns`** |
| `p01_add_branch` | `443,31 ns` | `7,94 ns` | `5,89 ns` | **`0,48 ns`** |
| `p02_when_is_right` | `548,07 ns` | `29,65 ns` | `14,12 ns` | **`0,47 ns`** |
| `p03_pipe_when_is_right` | `530,24 ns` | `46,95 ns` | `14,88 ns` | **`0,47 ns`** |
| `p04_pipe_fail_branch` | `501,34 ns` | `62,81 ns` | `14,32 ns` | **`1,56 ns`** |
| `s01_auth_guard` (`Ok \| Fail`) | `399,17 ns` | `11,84 ns` | `7,04 ns` | **`4,06 ns`** |
| `s02_banking_transfer` (`EitherTagged`) | `485,50 ns` | `14,27 ns` | `24,58 ns` | **`9,67 ns`** |
| `s03_http_status_router` (`EitherTagged`) | `347,72 ns` | `20,70 ns` | `18,98 ns` | **`10,93 ns`** |
| `s04_batch_coalesce_direct` (`EitherOrFail`) | `215,19 ns` | `39,25 ns` | `22,45 ns` | **`1,87 ns`** |
| `s05_pipe_coalesce_curried` (`EitherOrFail`) | `252,34 ns` | `96,59 ns` | `22,84 ns` | **`1,91 ns`** |
| `s06_mixed_union_dispatch` (5 types mixtes) | `301,51 ns` | `71,91 ns` | `13,62 ns` | **`10,42 ns`** |
| `s07_nested_either_audit` (`EitherCompact`) | `455,77 ns` | `24,44 ns` | `7,23 ns` | **`0,96 ns`** |
| `s08_ecommerce_pricing_pipe` (multi-modules) | `1 030,57 ns` | `128,18 ns` | `44,09 ns` | **`3,73 ns`** |
| `s09_risk_pipeline_4stages` (4 étapes) | `2 095,93 ns` | `138,63 ns` | `76,84 ns` | **`4,24 ns`** |
| `s10_dynamic_clock_entropy` (horloge `%`) | `808,44 ns` | `122,96 ns` | *non supporté* | **`202,54 ns`** |

## Décisions de détail et suite

- **Pureté des expressions (`expressionPurity.ts`) & packages relatifs :** suppression des `Generated_N` superflues sur les identifiants/littéraux purs, et retrait du préfixe `projectWorkDirectory` dans `createSourceIdentifier` (`Sourced_index001ats` au lieu d'un chemin absolu).
- **Sécurisation `isLeft` / `isRight` sur `any` :** motivée par le bug `Sourced_batch.IsRight undefined (type any)`, résolue par `EitherIsRightAny` / `EitherIsLeftAny` (`type switch` sur `Either`).
- **Pistes d'optimisation explorées :**
  - **Sum-Types 32B** pour les unions mixtes `s06` (mesurée à `3,96 ns` en micro-bench exploratoire contre `6,94 ns` pour `Value` 64B et `13,02 ns` pour `any`).
  - **Spécialisation `int64` sur `%`** pour supprimer les 4 appels `math.Mod` qui expliquent les `202,54 ns` de `s10`.
  - Voir [09-vision-long-terme](../09-vision-long-terme/) pour l'extension vers les exercices `06`–`10` (`matchInformation`, `rightPipe`, tuples, `group`, `Promise`).
