# 01 · Expressions et appels (exos 00 et 04) : exemples

## appel

```ts
import * as DEither from "@duplojs/lang/either";

export function add(one: number, two: number) {
	return DEither.success(one + two);
}

const ratio = 10 / 4;          // 2.5 en JS
const result = add(-1, ratio); // la fonction, puis -1, puis ratio, de gauche à droite
```

```go
// number → float64 : un nombre JS est toujours un flottant 64 bits.
func add(one float64, two float64) Value {
	return EitherSuccess(ValueNumber(one + two))
}

func init() {
	ratio := 10.0 / 4.0 // 2.5

	// Ordre d'évaluation de JS : la fonction, puis chaque argument, une seule fois.
	callee := add
	first := -1.0 // -1 est une opération unaire : « moins » appliqué à 1
	second := ratio
	result := callee(first, second)
	...
}
```

## court-circuit

```ts
function probe(value: number): boolean {
	DCommon.print("probe");
	return value > 0;
}

// probe(2) ne doit tourner que si ready est vrai.
const ok = ready && probe(2);
```

```go
// FAUX (premier jet) : les lignes « before » du côté droit remontent avant le &&.
//
//	argument := 2.0
//	probed := probe(argument) // tourne même si ready est faux !
//	ok := ready && probed

// JUSTE : le côté droit est enfermé dans une fonction appelée tout de suite.
ok := func() bool {
	if !ready {
		return false // court-circuit : probe n'est jamais appelé
	}
	argument := 2.0
	return probe(argument)
}()

// Sans lignes « before » à droite, le && de Go suffit : il court-circuite déjà.
```
