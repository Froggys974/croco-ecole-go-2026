# 08 · Approche hybride : exemples

Réécrits à la main pour montrer la logique. Les sorties Go brutes exactes sont
consultables fichier par fichier dans [report-hybrid.html](report-hybrid.html) et
[report-develop.html](report-develop.html).

## 1. `EitherCompact[T]` + `EitherOrFail[T]` contre `Value` + IIFE (`s04`)

```ts
function parseOrderId(raw: number): DEither.Success<number> | DEither.Fail {
	if (raw <= 0) {
		return DEither.fail();
	}
	return DEither.success(raw + 100);
}

function runScenario(seed: number): number {
	const idEither = parseOrderId(seed - 100000);
	const batch = DEither.whenIsRight(idEither, DArray.coalescing);
	if (DEither.isLeft(batch)) {
		return 0;
	}
	return 1;
}
```

### Approche hybride : structs sur la pile et `whenIsRight` à plat

```go
func parseOrderId(raw float64) EitherCompact[float64] {
	if raw <= 0 {
		return EitherCompactFail[float64]()
	}
	return EitherCompactSuccess(raw + 100) // réécriture directe du constructeur
}

func runScenario(seed float64) float64 {
	idEither := parseOrderId(seed - 100000)

	var batch EitherOrFail[[]float64]
	if idEither.IsRight() {
		batch = EitherOrFailValue([]float64{idEither.Value})
	} else {
		batch = EitherOrFailLeft[[]float64]()
	}

	if batch.IsLeft() {
		return 0
	}
	return 1
}
```

### Voie `Value` (`develop`) : boîte universelle 64B et IIFE

```go
func parseOrderId(raw float64) Value {
	if raw <= 0 {
		return EitherFail()
	}
	return EitherSuccess(ValueNumber(raw + 100))
}

func runScenario(seed float64) float64 {
	idEither := parseOrderId(seed - 100000)

	batch := func() Value {
		if EitherIsRight(idEither) {
			return ValueObject([]float64{idEither.Number()})
		}
		return idEither
	}()

	if EitherIsLeft(batch) {
		return 0
	}
	return 1
}
```

Les trois différences de fond qui expliquent l'écart mesuré :
1. **Types concrets sur la pile :** `EitherCompact[float64]` et `EitherOrFail[[]float64]` évitent la copie de 64 octets et le passage par `ValueObject(any)`.
2. **Dépliage à plat :** sans IIFE `func() Value { ... }()`, la fonction reste courte et inlinable par Go.
3. **Pureté des expressions :** dans la sortie brute hybride, les littéraux et identifiants purs ne génèrent plus de variables `Generated_N` intermédiaires.

---

## 2. Pipeline `DCommon.pipe` à 4 étapes déplié à plat (`s09`)

```ts
function runScenario(seed: number): number {
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
func runScenario(seed float64) float64 {
	step1 := parseScore(seed - 15000)

	var step2 EitherCompact[float64]
	if step1.IsRight() {
		step2 = scaleScore(step1.Value)
	} else {
		step2 = step1
	}

	var step3 EitherCompact[float64]
	if step2.IsRight() {
		step3 = clampBand(step2.Value)
	} else {
		step3 = step2
	}

	var res EitherCompact[float64]
	if step3.IsRight() {
		res = scaleScore(step3.Value)
	} else {
		res = step3
	}

	if res.IsRight() {
		return 1
	}
	return 0
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
// Struct sur la pile avec Kind uint8 (0=Fail, 2=Success, 3=Error).
func transfer(amount float64) EitherTagged[float64, string] {
	if amount <= 0 {
		return EitherTaggedFail[float64, string]()
	}
	if amount > 1000 {
		return EitherTaggedError[float64, string]("limit-exceeded")
	}
	return EitherTaggedSuccess[float64, string](amount)
}

// Côté interface Either : struct{} de 0 octet + JSON préformaté sans réflexion.
type EitherFail struct{}

func (EitherFail) MarshalJSON() ([]byte, error) {
	return []byte(`{"@duplojs/lang/kind/@DuplojsLangEither/left":null,"@duplojs/lang/kind/@DuplojsLangEither/information":"fail","@duplojs/lang/kind/@DuplojsLangEither/value":null,"@duplojs/lang/kind/@DuplojsLangEither/fail":null}`), nil
}
```
