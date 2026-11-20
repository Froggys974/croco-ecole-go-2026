# 06 · Transformer chaque élément d'un tableau (exo 05, seconde partie)

## La problématique

```ts
DArray.map(DString.to) // [3] → ["3"]
```

Appliquer une transformation à chaque élément en gardant l'ordre et la structure. Et écrire un
nombre en texte **exactement comme JavaScript**.

## La solution

- **`DArray.map`** → une fonction appelée tout de suite : `make` réserve le résultat en une fois,
  `for range` le remplit. Choisi **sur mesures** : la récursion est 5 à 500 fois plus lente.
- **`DString.to`** → `StringFromNumber` dans le runtime. Le `encoding/json` de Go écrit les nombres
  finis avec le même algorithme que JS (ES6) ; `NaN`, `±Infinity` et `-0` sont traités à part.
- **Tableaux littéraux** → slices Go : `[1, 2]` → `[]float64{1, 2}` ; `[]` prend le type attendu.
- **Les types de DuploJS que Go n'a pas :**
  - les **étiquettes** collées par `&` (`string & Number`, `T[] & LengthEqual<1>`) n'existent qu'en
    TS : elles sont retirées, il reste `[]string` ;
  - les **types gabarits** (`` `${number}` ``) sont des `string` ;
  - une **union dont les membres ont le même type Go** prend ce type (`[number] | number[]` →
    `[]float64`).

```go
labels := func() []string {
	out := make([]string, len(numbers))
	for i, n := range numbers {
		out[i] = StringFromNumber(n)
	}
	return out
}()
```

Voir [EXEMPLES.md](EXEMPLES.md) et [HISTORIQUE.md](HISTORIQUE.md).

## Où dans le code

`transformers/duplojs/array/map.ts`, `transformers/duplojs/string/`, `transformers/expression/array.ts`,
`transformers/type/intersection.ts`, `transformers/type/union.ts`. Benchmarks : `sandbox/perf/map_test.go`.
