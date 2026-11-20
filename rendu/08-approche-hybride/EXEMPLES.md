# 08 · Approche hybride : exemples de code généré

Les deux premiers exemples sont les **sorties Go réelles** produites par le transpileur sur la suite `/benchmark` (sans aucune retouche).

## 1. Duel sur `s04` : `EitherCompact[T]` + `EitherOrFail[T]` contre `Value` + IIFE

```ts
export function parseOrderId(raw: number): DEither.Success<number> | DEither.Fail {
	if (raw <= 0) {
		return DEither.fail();
	}
	return DEither.success(raw + 100);
}

export function runScenario(seed: number): number {
	const idEither = parseOrderId(seed - 100000);
	const batch = DEither.whenIsRight(idEither, DArray.coalescing);
	if (DEither.isLeft(batch)) {
		return 0;
	}
	return 1;
}
```

### Go généré — Approche hybride

```go
package Sourced_kernel001ats

import "duplojs.local/transpiled/shard_dependencies"

func Sourced_parseOrderId(Sourced_raw float64) (shard_dependencies.EitherCompact[float64]) {
	if Sourced_raw <= (float64)(0) {
		return shard_dependencies.EitherCompactFail[float64]()
	}
	return shard_dependencies.EitherCompactSuccess[float64](Sourced_raw + (float64)(100))
}

func Sourced_runScenario(Sourced_seed float64) (float64) {
	Sourced_idEither := Sourced_parseOrderId(Sourced_seed - (float64)(100000))
	var Generated_4 shard_dependencies.EitherOrFail[[]float64]
	if Sourced_idEither.IsRight() {
		Generated_4 = shard_dependencies.EitherOrFailValue[[]float64](([]float64{
			Sourced_idEither.Value,
		}))
	} else {
		Generated_4 = shard_dependencies.EitherOrFailLeft[[]float64]()
	}
	Sourced_batch := Generated_4
	if Sourced_batch.IsLeft() {
		return (float64)(0)
	}
	return (float64)(1)
}
```

### Go généré — Branche `develop`

```go
package Sourced_001btmp001bcmp_develop001bbenchmark001binputs001bs04_batch_coalesce_direct001bkernel001ats

import "duplojs.local/transpiled/shard_dependencies"

func Sourced_parseOrderId(Sourced_raw float64) (shard_dependencies.Value) {
	Generated_13 := Sourced_raw
	Generated_14 := (float64)(0)
	if Generated_13 <= Generated_14 {
		return shard_dependencies.EitherFail()
	}
	Generated_15 := Sourced_raw
	Generated_16 := (float64)(100)
	return shard_dependencies.EitherSuccess(shard_dependencies.ValueNumber(Generated_15 + Generated_16))
}

func Sourced_runScenario(Sourced_seed float64) (float64) {
	Generated_17 := Sourced_parseOrderId
	Generated_18 := Sourced_seed
	Generated_19 := (float64)(100000)
	Generated_20 := Generated_18 - Generated_19
	Sourced_idEither := Generated_17(Generated_20)
	Sourced_batch := func() (shard_dependencies.Value) {
		if shard_dependencies.EitherIsRight(Sourced_idEither) {
			return shard_dependencies.ValueObject(([]float64{
				Sourced_idEither.Number(),
			}))
		}
		return Sourced_idEither
	}()
	if shard_dependencies.EitherIsLeft(Sourced_batch) {
		return (float64)(0)
	}
	return (float64)(1)
}
```

Le différentiel vient de trois points visibles directement dans le code :
1. **Types sur la pile :** `EitherCompact[float64]` et `EitherOrFail[[]float64]` remplacent `Value` (64 octets) et `ValueObject(any)`.
2. **Dépliage à plat :** pas d'IIFE `func() Value { ... }()`, la fonction reste inlinable.
3. **Pureté des expressions :** disparition des variables `Generated_13..20` et nom de package relatif (`Sourced_kernel001ats`).

---

## 2. Pipeline `DCommon.pipe` à 4 étapes sur `s09`

```ts
export function runScenario(seed: number): number {
	const res = DCommon.pipe(
		seed - 15000,
		parseScore,
		DEither.whenIsRight(scaleScore),
		DEither.whenIsRight(clampBand),
		DEither.whenIsRight(scaleScore),
	);
	if (DEither.isRight(res)) {
		return 1;
	}
	return 0;
}
```

```go
func Sourced_runScenario(Sourced_seed float64) (float64) {
	Generated_3 := Sourced_parseScore(Sourced_seed - (float64)(15000))
	var Generated_4 shard_dependencies.EitherCompact[float64]
	if Generated_3.IsRight() {
		Generated_4 = Sourced_scaleScore(Generated_3.Value)
	} else {
		Generated_4 = Generated_3
	}
	Generated_5 := Generated_4
	var Generated_6 shard_dependencies.EitherCompact[float64]
	if Generated_5.IsRight() {
		Generated_6 = Sourced_clampBand(Generated_5.Value)
	} else {
		Generated_6 = Generated_5
	}
	Generated_7 := Generated_6
	var Generated_8 shard_dependencies.EitherCompact[float64]
	if Generated_7.IsRight() {
		Generated_8 = Sourced_scaleScore(Generated_7.Value)
	} else {
		Generated_8 = Generated_7
	}
	Sourced_res := Generated_8
	if Sourced_res.IsRight() {
		return (float64)(1)
	}
	return (float64)(0)
}
```

---

## 3. Union homogène (`EitherTagged[R, L]`) et constante 0 octet (`EitherFail`)

```ts
function transfer(amount: number): DEither.Success<number> | DEither.Error<string> | DEither.Fail {
	if (amount <= 0) return DEither.fail();
	if (amount > 1000) return DEither.error("limit-exceeded");
	return DEither.success(amount);
}
```

```go
// Struct sur la pile avec Kind uint8 (0=Fail, 2=Success, 3=Error), sans préfixe pour la lisibilité.
func transfer(amount float64) EitherTagged[float64, string] {
	if amount <= 0 {
		return EitherTaggedFail[float64, string]()
	}
	if amount > 1000 {
		return EitherTaggedError[float64, string]("limit-exceeded")
	}
	return EitherTaggedSuccess[float64, string](amount)
}

// Et côté interface Either : 0 octet + JSON préformaté sans réflexion.
type EitherFail struct{}

func (EitherFail) MarshalJSON() ([]byte, error) {
	return []byte(`{"@duplojs/lang/kind/@DuplojsLangEither/left":null,"@duplojs/lang/kind/@DuplojsLangEither/information":"fail","@duplojs/lang/kind/@DuplojsLangEither/value":null,"@duplojs/lang/kind/@DuplojsLangEither/fail":null}`), nil
}
```
