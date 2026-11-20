# Rapport de Benchmarks — TypeScript / DuploJS vers Go

- **Branche :** `unknown@unknown`
- **Date :** `2026-11-20T12:53:06.603Z`
- **Runtimes :** Node `v24.22.3` · Bun `1.4.4` · `go version go1.27.4 linux/amd64`
- **Charge :** `1 000 000` ops/cas (`25 x 40000`, graine `236601`)
- **Couverture Go :** **10 / 10** cas valides (**8** à `0 B/op` · `0 alloc/op`)

## Vue groupée

| ID | Scénario | Node P50 | Bun P50 | Go P50 / Mops / RAM | Gain Go | Checksum |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: |
| `s01_auth_guard` | Garde d'accès & court-circuit logique (ok / fail / && / \|\|) | `407.82 ns`<br>`2.45 Mops/s` | `8.11 ns`<br>`123.29 Mops/s` | **`3.96 ns`**<br>`252.28 Mops/s`<br>`0 B` · `0 a` | vs Node: **102.98x**<br>vs Bun: **2.05x** | OK |
| `s02_banking_transfer` | Virement bancaire (Success<number> \| Error<string> \| Fail) | `478.51 ns`<br>`2.09 Mops/s` | `8.42 ns`<br>`118.75 Mops/s` | **`10 ns`**<br>`99.97 Mops/s`<br>`0 B` · `0 a` | vs Node: **47.85x**<br>vs Bun: **0.84x** | OK |
| `s03_http_status_router` | Routeur HTTP métier (DEither.left / right avec messages custom) | `307.68 ns`<br>`3.25 Mops/s` | `6.44 ns`<br>`155.16 Mops/s` | **`10.26 ns`**<br>`97.46 Mops/s`<br>`0 B` · `0 a` | vs Node: **29.99x**<br>vs Bun: **0.63x** | OK |
| `s04_batch_coalesce_direct` | Normalisation de lots (whenIsRight direct + DArray.coalescing) | `502.72 ns`<br>`1.99 Mops/s` | `57.28 ns`<br>`17.46 Mops/s` | **`26.53 ns`**<br>`37.69 Mops/s`<br>`32 B` · `2 a` | vs Node: **18.95x**<br>vs Bun: **2.16x** | OK |
| `s05_pipe_coalesce_curried` | Pipeline currié (DCommon.pipe + whenIsRight(DArray.coalescing)) | `541.04 ns`<br>`1.85 Mops/s` | `71.77 ns`<br>`13.93 Mops/s` | **`54.68 ns`**<br>`18.29 Mops/s`<br>`32 B` · `2 a` | vs Node: **9.89x**<br>vs Bun: **1.31x** | OK |
| `s06_mixed_union_dispatch` | Union hétérogène 5 types (number \| string \| bool \| Success \| Fail) | `478.38 ns`<br>`2.09 Mops/s` | `27.51 ns`<br>`36.35 Mops/s` | **`6.75 ns`**<br>`148.24 Mops/s`<br>`0 B` · `0 a` | vs Node: **70.87x**<br>vs Bun: **4.08x** | OK |
| `s07_nested_either_audit` | Double validation imbriquée (Success<Success<number>> \| Fail) | `391.83 ns`<br>`2.55 Mops/s` | `15.09 ns`<br>`66.28 Mops/s` | **`0.93 ns`**<br>`1071.15 Mops/s`<br>`0 B` · `0 a` | vs Node: **421.32x**<br>vs Bun: **16.23x** | OK |
| `s08_ecommerce_pricing_pipe` | Moteur tarification multi-modules (discount + tax + pipe utilisateur) | `1035.4 ns`<br>`0.97 Mops/s` | `115.42 ns`<br>`8.66 Mops/s` | **`3.82 ns`**<br>`261.81 Mops/s`<br>`0 B` · `0 a` | vs Node: **271.05x**<br>vs Bun: **30.21x** | OK |
| `s09_risk_pipeline_4stages` | Scoring risque 4 étapes (pipe + 3 whenIsRight enchaînés) | `2261.39 ns`<br>`0.44 Mops/s` | `147.62 ns`<br>`6.77 Mops/s` | **`3.58 ns`**<br>`279.23 Mops/s`<br>`0 B` · `0 a` | vs Node: **631.67x**<br>vs Bun: **41.23x** | OK |
| `s10_dynamic_clock_entropy` | Simulation dynamique horloge (anti-constant-folding + % + pipe) | `803.75 ns`<br>`1.24 Mops/s` | `136.63 ns`<br>`7.32 Mops/s` | **`197.12 ns`**<br>`5.07 Mops/s`<br>`0 B` · `0 a` | vs Node: **4.08x**<br>vs Bun: **0.69x** | OK |

## Détails par source

### `s01_auth_guard` — Garde d'accès & court-circuit logique (ok / fail / && / ||)

- Résultat JSON : [`s01_auth_guard/result.json`](./s01_auth_guard/result.json)
- Code Go généré : [`s01_auth_guard/go/`](./s01_auth_guard/go/)
- Go : P50 `3.96 ns` · P95 `4.79 ns` · P99 `5.47 ns` · `252.28 Mops/s` · `0 B/op` · `0 allocs/op` · `0 GC`

### `s02_banking_transfer` — Virement bancaire (Success<number> | Error<string> | Fail)

- Résultat JSON : [`s02_banking_transfer/result.json`](./s02_banking_transfer/result.json)
- Code Go généré : [`s02_banking_transfer/go/`](./s02_banking_transfer/go/)
- Go : P50 `10 ns` · P95 `10.87 ns` · P99 `11.21 ns` · `99.97 Mops/s` · `0 B/op` · `0 allocs/op` · `0 GC`

### `s03_http_status_router` — Routeur HTTP métier (DEither.left / right avec messages custom)

- Résultat JSON : [`s03_http_status_router/result.json`](./s03_http_status_router/result.json)
- Code Go généré : [`s03_http_status_router/go/`](./s03_http_status_router/go/)
- Go : P50 `10.26 ns` · P95 `13.43 ns` · P99 `14.02 ns` · `97.46 Mops/s` · `0 B/op` · `0 allocs/op` · `0 GC`

### `s04_batch_coalesce_direct` — Normalisation de lots (whenIsRight direct + DArray.coalescing)

- Résultat JSON : [`s04_batch_coalesce_direct/result.json`](./s04_batch_coalesce_direct/result.json)
- Code Go généré : [`s04_batch_coalesce_direct/go/`](./s04_batch_coalesce_direct/go/)
- Go : P50 `26.53 ns` · P95 `35.16 ns` · P99 `35.58 ns` · `37.69 Mops/s` · `32 B/op` · `2 allocs/op` · `8 GC`

### `s05_pipe_coalesce_curried` — Pipeline currié (DCommon.pipe + whenIsRight(DArray.coalescing))

- Résultat JSON : [`s05_pipe_coalesce_curried/result.json`](./s05_pipe_coalesce_curried/result.json)
- Code Go généré : [`s05_pipe_coalesce_curried/go/`](./s05_pipe_coalesce_curried/go/)
- Go : P50 `54.68 ns` · P95 `134.97 ns` · P99 `251.49 ns` · `18.29 Mops/s` · `32 B/op` · `2 allocs/op` · `8 GC`

### `s06_mixed_union_dispatch` — Union hétérogène 5 types (number | string | bool | Success | Fail)

- Résultat JSON : [`s06_mixed_union_dispatch/result.json`](./s06_mixed_union_dispatch/result.json)
- Code Go généré : [`s06_mixed_union_dispatch/go/`](./s06_mixed_union_dispatch/go/)
- Go : P50 `6.75 ns` · P95 `7.85 ns` · P99 `9.14 ns` · `148.24 Mops/s` · `0 B/op` · `0 allocs/op` · `0 GC`

### `s07_nested_either_audit` — Double validation imbriquée (Success<Success<number>> | Fail)

- Résultat JSON : [`s07_nested_either_audit/result.json`](./s07_nested_either_audit/result.json)
- Code Go généré : [`s07_nested_either_audit/go/`](./s07_nested_either_audit/go/)
- Go : P50 `0.93 ns` · P95 `1 ns` · P99 `1.81 ns` · `1071.15 Mops/s` · `0 B/op` · `0 allocs/op` · `0 GC`

### `s08_ecommerce_pricing_pipe` — Moteur tarification multi-modules (discount + tax + pipe utilisateur)

- Résultat JSON : [`s08_ecommerce_pricing_pipe/result.json`](./s08_ecommerce_pricing_pipe/result.json)
- Code Go généré : [`s08_ecommerce_pricing_pipe/go/`](./s08_ecommerce_pricing_pipe/go/)
- Go : P50 `3.82 ns` · P95 `4.74 ns` · P99 `6.88 ns` · `261.81 Mops/s` · `0 B/op` · `0 allocs/op` · `0 GC`

### `s09_risk_pipeline_4stages` — Scoring risque 4 étapes (pipe + 3 whenIsRight enchaînés)

- Résultat JSON : [`s09_risk_pipeline_4stages/result.json`](./s09_risk_pipeline_4stages/result.json)
- Code Go généré : [`s09_risk_pipeline_4stages/go/`](./s09_risk_pipeline_4stages/go/)
- Go : P50 `3.58 ns` · P95 `4.66 ns` · P99 `5.45 ns` · `279.23 Mops/s` · `0 B/op` · `0 allocs/op` · `0 GC`

### `s10_dynamic_clock_entropy` — Simulation dynamique horloge (anti-constant-folding + % + pipe)

- Résultat JSON : [`s10_dynamic_clock_entropy/result.json`](./s10_dynamic_clock_entropy/result.json)
- Code Go généré : [`s10_dynamic_clock_entropy/go/`](./s10_dynamic_clock_entropy/go/)
- Go : P50 `197.12 ns` · P95 `217.25 ns` · P99 `220.7 ns` · `5.07 Mops/s` · `0 B/op` · `0 allocs/op` · `0 GC`

