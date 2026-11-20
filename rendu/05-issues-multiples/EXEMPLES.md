# 05 · Traiter chaque issue d'un résultat (exo 05, première partie) : exemples

Réécrits à la main pour montrer la logique : noms lisibles, préfixe `shard_dependencies.` retiré, `...` à la place de ce qui n'aide pas à comprendre.

## otherwise

```ts
import * as DEither from "@duplojs/lang/either";
import * as DArray from "@duplojs/lang/array";

const result = add(-1, 2); // Fail

// f reçoit le CONTENU d'un succès, g reçoit l'entrée ENTIÈRE pour toute autre issue.
const picked = DEither.whenIsRightOtherwise(result, DArray.coalescing, () => [-12]);

// Une flèche avec un paramètre non annoté : son type vient du contexte (number).
const bumped = DEither.whenIsRight(result, (value) => value + 1);

// Un Either qui n'est jamais un Left : la branche Left est impossible.
const kept = DEither.whenIsLeft(DEither.success(1), () => 0);
```

```go
result := add(-1, 2)

// Même squelette que whenIsRight, seule la branche « sinon » change.
// Les deux branches rendent un []float64 : l'union a un seul type Go, pas de boîte.
picked := func() []float64 {
	if EitherIsRight(result) {
		return []float64{result.Number()} // f = coalescing, boîte ouverte
	}
	// g = () => [-12] : une fonction littérale. Elle ne déclare aucun paramètre,
	// donc l'entrée que DuploJS lui passerait est ignorée, comme en JS.
	return func() []float64 { return []float64{-12} }()
}()

// La flèche (value) => value + 1, avec value typé float64 par le checker.
bumped := func() Value {
	if EitherIsRight(result) {
		return ValueNumber(func(value float64) float64 { return value + 1 }(result.Number()))
	}
	return result
}()

// Branche Left impossible (never) : pas de test, seule l'autre branche est écrite.
success := EitherSuccess(ValueNumber(1))
_ = success // garde l'entrée calculée, et évite « declared and not used » si plus rien ne la lit
kept := success
```
