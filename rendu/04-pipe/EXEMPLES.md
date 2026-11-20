# 04 · Le pipe (exo 03) : exemples

## pipe

```ts
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import * as DArray from "@duplojs/lang/array";

function double(value: number): number { ... }
function check(value: number): DEither.Success<number> | DEither.Fail { ... }

const out = DCommon.pipe(
	3,
	double,                                 // number → number
	check,                                  // number → Success | Fail
	DEither.whenIsRight(DArray.coalescing), // forme curryfiée : l'entrée vient du pipe
);
```

```go
// Ce que fait DuploJS en JS, à l'exécution :
//
//	acc := input
//	for _, step := range steps { acc = step(acc) } // liste + boucle + mutation
//
// Ce qu'on produit : le pipe déroulé, une variable par étape, pas de fonction Pipe.

step1 := double(3)      // float64
step2 := check(step1)   // Value (Success | Fail)
out := func() Value {   // whenIsRight appliqué à step2
	if EitherIsRight(step2) {
		return ValueObject([]float64{step2.Number()})
	}
	return step2
}()
```
