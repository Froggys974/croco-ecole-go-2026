# 09 · Vision à long terme : exercices 06 à 10 et suite DuploJS

Les exercices **06 à 10** n'ont pas été implémentés dans le temps du hackathon, mais leurs
problématiques ont été analysées en amont. Comme deux architectures coexistent dans le dépôt
— **voie `Value`** (`develop`, type universel 64B) et **voie `Hybride`** (`08-approche-hybride`,
structs spécialisées + dépliage à plat) — ce dossier pose les pistes théoriques **pour les deux
trajectoires**, sans imposer de choix unique.

## Matrice des problématiques (`06` à `10`) selon les deux voies

| Exo | Problématique TS / DuploJS | Voie `Value` (`develop`) | Voie `Hybride` (`08`) |
| :---: | :--- | :--- | :--- |
| **06** | Ternaire (`a ? b : c`), `DEither.left`, `matchInformation(res, { ... })` | Ternaire en IIFE `func() T` ; `matchInformation` traduit en `switch res.message` avec déballage `.Number()`/`.String()` selon le type TS de chaque branche. | Ternaire déplié à plat dans `before` ; `matchInformation` traduit en `switch res.GetInformation()` (ou `switch res.Kind` sur `EitherTagged`) avec accès direct aux champs typés. |
| **07** | Multi-fichiers et `DEither.rightPipe` (court-circuit au premier `Left`) | Même déroulage récursif que `DCommon.pipe`, mais chaque étape s'arrête dès `EitherIsLeft(step)` en retournant directement `Value` (aucune conversion entre unions d'erreurs élargies). | Dépliage en blocs `if step.IsRight() { ... }` imbriqués ou retour anticipé dans `before`, avec élargissement automatique du type cible vers `EitherTagged[R, L]` ou `Either` selon les branches. |
| **08** | Tuples (`[number, number, number]`) et destructuring de paramètres `([a, b, c]) => ...` | Tuple homogène réduit à `[]float64` ; tuple hétérogène `[A, B]` représenté en `[]Value` ; extraction en tête de corps (`a := p[0].Number()`). | Structs génériques contiguës `Tuple2..Tuple8[T0, ...]` (ex. `Tuple3[float64, float64, float64]` = 24 octets contigus sans boxing), avec paramètre synthétique et extraction `a := p.V0`. |
| **09** | `DEither.group` (agrégation transactionnelle d'un tableau d'`Either`) | Helper générique ou fonction runtime `EitherGroup(items []Value) Value` qui s'arrête au premier `Left` et accumule sinon dans une slice emballée en `ValueObject`. | Deux cas : tableau littéral `[fn1(), fn2()]` déplié statiquement sans allouer `[]Either`, et tableau dynamique traité via `for range` + `make([]T, len)` + `break` au premier `Left`. |
| **10** | `async` / `await`, `Promise<T>`, `DEither.asyncGroup`, `rightAsyncPipe` | Struct `Promise[T]` (ou `Promise[Value]`) lancée sur goroutine avec `chan struct{}` fermé une fois résolue (`close(ch)` autorise plusieurs `.Await()` sur la même promesse). `asyncGroup` exécute les getters séquentiellement en appelant `.Await()`. | Même primitive concurrente `Promise[T]` sur goroutine + `chan struct{}` (mais typée sur la struct spécialisée `Promise[EitherCompact[T]]`), afin de préserver la sémantique concurrente réelle de JS sans tomber dans une traduction synchrone. |

## Synthèse des arbitrages pour la suite du projet

Le choix entre les deux trajectoires pour la suite de DuploJS dépend de la priorité retenue :

- **Pour maximiser la vitesse de couverture fonctionnelle :** la voie **`Value`** garde un transpileur plus simple (aucune coercition entre formes d'unions, élargissement gratuit dans `rightPipe` et `group`). Le point à surveiller à grande échelle sera le coût de `MarshalJSON` et les allocations `object any` sur les objets métier.
- **Pour maximiser les performances et la proximité avec du Go idiomatique :** la voie **`Hybride`** conserve le typage statique Go, reste à `0 B/op` sur les flux `Either` et évite la double réflexion JSON. Les prochains leviers identifiés sont les **Sum-Types générées sur mesure** pour les unions hétérogènes à 3+ types (mesurées à `3,96 ns` en micro-bench exploratoire) et la **spécialisation `int64`** pour éviter `math.Mod` sur les opérations `%` entières.
- **Une convergence reste possible :** conserver la couche de sûreté Go (`goImports`, `resolveValueType`, `_ = var`, `Callable`, `coalescing` inline) et n'appliquer la spécialisation de structs que sur les chemins chauds (`EitherCompact`, `EitherOrFail`), tout en gardant `Value` ou des Sum-Types générées comme repli général.

## Ouverture vers `@duplojs/server`

À plus long terme, traduire une application `@duplojs/server` vers Go prolonge directement ces briques :
- les pipelines de middlewares / steps (`check`, `extract`, `cut`, `handler`) reposent sur la même mécanique de composition court-circuitée que `rightPipe` ;
- les contrats de requêtes/réponses JSON bénéficient directement de structs Go typées avec tags `json:"..."` (au lieu de `map[string]any`), branchées sur le routeur standard `net/http` (Go 1.22+) et compilables avec `-ldflags="-s -w"` et `-pgo`.
