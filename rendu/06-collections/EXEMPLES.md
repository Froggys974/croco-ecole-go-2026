# 06 · Transformer chaque élément d'un tableau (exo 05, seconde partie) : exemples

## etiquettes

```ts
// Le type que TypeScript donne au résultat de DArray.map(DString.to) dans l'exo 05 :
type Labels = readonly (string & Number)[] & LengthEqual<1>;
//                      ^^^^^^^^^^^^^^^      ^^^^^^^^^^^^^^
//                      « ce texte vient     « ce tableau a
//                       d'un nombre »        exactement 1 élément »
//
// Ces étiquettes n'existent que pour TypeScript. À l'exécution : un tableau de textes.
//
// Traduction Go : on garde le seul vrai type, on retire les étiquettes.
//   string & Number              → string
//   readonly string[] & LengthEqual<1> → []string
//
// Autres exemples :
//   number & Positive            → float64   (le cas 50 en aura besoin)
//   string & ("a" | "b")         → string    (les deux membres sont des string)
//   { a: number } & { b: string } → refusé   (deux vrais types : on ne devine pas)
```

## map

```ts
import * as DArray from "@duplojs/lang/array";
import * as DString from "@duplojs/lang/string";

const numbers = [3, 0.1 + 0.2, 1e21];

const labels = DArray.map(numbers, DString.to); // ["3", "0.30000000000000004", "1e+21"]

// Une flèche qui utilise une variable extérieure.
const offset = 10;
const shifted = DArray.map(numbers, (value) => value + offset);
```

```go
numbers := []float64{3, 0.1 + 0.2, 1e21}

// make réserve le résultat en une fois (1 allocation), for range le remplit.
// out[i] = … écrit dans une slice toute neuve : rien n'est modifié vu de l'extérieur.
labels := func() []string {
	out := make([]string, len(numbers))
	for i, value := range numbers {
		out[i] = StringFromNumber(value)
	}
	return out
}()

// La flèche devient une fonction littérale ; elle capture offset.
offset := 10.0
shifted := func() []float64 {
	out := make([]float64, len(numbers))
	for i, value := range numbers {
		out[i] = func(value float64) float64 { return value + offset }(value)
	}
	return out
}()
```

## string-from-number

```go
// `${value}` en JS. encoding/json écrit les nombres finis comme JS (algorithme ES6) ;
// les cas que JSON écrit autrement sont traités avant.
func StringFromNumber(value float64) string {
	if value != value {
		return "NaN" // seul NaN est différent de lui-même
	}
	if value-value != 0 { // ±Infinity : Infinity - Infinity = NaN
		if value > 0 {
			return "Infinity"
		}
		return "-Infinity"
	}
	if value == 0 {
		return "0" // -0 aussi : JS écrit "0", JSON écrirait "-0"
	}
	var text []byte
	text, _ = json.Marshal(value) // 3 → "3", 0.1 → "0.1", 1e21 → "1e+21", 1e-7 → "1e-7"
	return string(text)
}
```
