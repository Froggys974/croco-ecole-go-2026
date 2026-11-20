# 03 · Fonctions en argument (exo 02) : exemples

## when-is-right

```ts
import * as DEither from "@duplojs/lang/either";
import * as DArray from "@duplojs/lang/array";

const result = add(1, 2); // Success<number> | Fail

// Le rappel est une fonction DuploJS.
const wrapped = DEither.whenIsRight(result, DArray.coalescing); // Right : [3]

// Le rappel est une fonction du projet.
function double(value: number): number {
	return value * 2;
}
const doubled = DEither.whenIsRight(result, double); // Right : 6

// L'entrée est un appel : il ne doit tourner qu'une fois.
const once = DEither.whenIsRight(add(5, 5), double);
```

```go
result := add(1, 2)

// Le contenu sort de la boîte (.Number()) ; coalescing ne teste rien : le type Go dit déjà que ce n'est pas un tableau.
wrapped := func() Value {
	if EitherIsRight(result) {
		return ValueObject([]float64{result.Number()}) // le résultat retourne dans une union
	}
	return result // pas un Right : rendu tel quel
}()

// Contenu déjà déballé avant l'appel.
doubled := func() Value {
	if EitherIsRight(result) {
		return ValueNumber(double(result.Number()))
	}
	return result
}()

// Entrée qui est un appel : rangée d'abord, pour n'être calculée qu'une fois.
input := add(5, 5)
once := func() Value {
	if EitherIsRight(input) {
		return ValueNumber(double(input.Number()))
	}
	return input
}()
```
