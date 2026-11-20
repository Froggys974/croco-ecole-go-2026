# 02 · Unions et Either (exos 01 et 04) : exemples

## either

```ts
import * as DEither from "@duplojs/lang/either";
import * as DCommon from "@duplojs/lang/common";

export function add(one: number, two: number) {
	if (one === -1) {
		return DEither.fail();
	}
	return DEither.success(one + two);
}

const result = add(1, 2);

if (DEither.isRight(result)) {
	DCommon.print(result);
}
```

```go
// Fail | Success<number> : une union → Value. Les deux chemins rendent le même type Go.
func add(one float64, two float64) Value {
	if one == -1 {
		return EitherFail() // kind = Left, message = "fail", payload = undefined
	}
	return EitherSuccess(ValueNumber(one + two)) // kind = Right, message = "success", number = 3
}

func init() {
	result := add(1, 2)

	if EitherIsRight(result) { // lit l'étiquette kind == Right
		CommonPrint(result) // MarshalJSON
	}
}

// Sortie, identique à TypeScript :
// {"…/right":null,"…/information":"success","…/value":3,"…/success":null}
```

## union

```ts
function parse(flag: number): number | string | null {
	if (flag === 0) {
		return 42;
	}
	if (flag === 1) {
		return "zero";
	}
	return null;
}

function role(admin: boolean): "admin" | "user" {
	...
}
```

```go
// number | string | null : trois genres différents → une Value.
// Chaque return est une frontière : la case est choisie à la traduction, d'après le type du return.
func parse(flag float64) Value {
	if flag == 0 {
		return ValueNumber(42) // kind = number, number = 42
	}
	if flag == 1 {
		return ValueString("zero") // kind = string, text = "zero"
	}
	return ValueNull(JSNull{}) // kind = null, aucune case
}

// "admin" | "user" : tous les membres sont des string → pas d'union pour Go, pas de boîte.
func role(admin bool) string {
	...
}

// Relire : on teste l'étiquette, puis on lit la case, sans assertion.
func show(value Value) {
	if value.kind == KindNumber {
		total := value.Number() + 1 // déballer : la case number
		...
	}
}
```

## memoire

```go
// Où vit la mémoire ? Pile (gratuite) ou tas (allocation + travail du ramasse-miettes).

// 1. Un primitif dans une union : 0 allocation.
//    Value passe par valeur : le nombre est DANS la struct, la struct est copiée sur la pile.
func double(x float64) Value {
	return ValueNumber(x * 2) // copie de ≈ 64 octets, aucune allocation
}

// 2. Un Either de primitif : 0 allocation, même raison.
func check(x float64) Value {
	return EitherSuccess(ValueNumber(x)) // contenu rangé à plat dans la même struct
}

// 3. Un tableau ou un objet DANS une union : 1 allocation.
//    Il va dans la case object (un any) : un any est un type + un POINTEUR vers la valeur.
//    La valeur sort de la fonction, Go la range sur le tas (« escapes to heap »).
func wrap(list []float64) Value {
	return ValueObject(list) // 1 allocation : seul cas qui en coûte
}

// 4. Le même tableau HORS union : rien de plus que d'habitude.
func keep(list []float64) []float64 {
	return list // pas de Value, pas de any
}

// On ne paie l'allocation que dans le cas rare (un objet dans une union),
// jamais dans le cas courant (des nombres, des textes, des Either de primitifs).
```
