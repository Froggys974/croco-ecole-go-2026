# Rapport de Benchmarks — TypeScript / DuploJS vers Go

- **Branche :** `feature/hybrid-either-and-pipe@7316a18`
- **Date :** `2026-11-20T11:59:50.000Z`
- **Runtimes :** Node `v24.22.3` · Bun `1.4.4` · `go version go1.27.4 linux/amd64`
- **Charge :** `1 000 000` ops/cas (`25 x 40000`, graine `223447`)
- **Couverture Go :** **10 / 10** cas valides (**10** à `0 B/op` · `0 alloc/op`)

## Vue groupée

| ID | Scénario | Node P50 | Bun P50 | Go P50 / Mops / RAM | Gain Go | Checksum |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: |
| `s01_auth_guard` | Garde d'accès & court-circuit logique (ok / fail / && / \|\|) | `399.05 ns`<br>`2.51 Mops/s` | `6.93 ns`<br>`144.28 Mops/s` | **`4.06 ns`**<br>`246.41 Mops/s`<br>`0 B` · `0 a` | vs Node: **98.29x**<br>vs Bun: **1.71x** | OK |
| `s02_banking_transfer` | Virement bancaire (Success<number> \| Error<string> \| Fail) | `477.33 ns`<br>`2.09 Mops/s` | `8.39 ns`<br>`119.15 Mops/s` | **`9.61 ns`**<br>`104.02 Mops/s`<br>`0 B` · `0 a` | vs Node: **49.67x**<br>vs Bun: **0.87x** | OK |
| `s03_http_status_router` | Routeur HTTP métier (DEither.left / right avec messages custom) | `304.58 ns`<br>`3.28 Mops/s` | `7.31 ns`<br>`136.77 Mops/s` | **`10.5 ns`**<br>`95.22 Mops/s`<br>`0 B` · `0 a` | vs Node: **29.01x**<br>vs Bun: **0.70x** | OK |
| `s04_batch_coalesce_direct` | Normalisation de lots (whenIsRight direct + DArray.coalescing) | `505.19 ns`<br>`1.98 Mops/s` | `42.2 ns`<br>`23.7 Mops/s` | **`1.87 ns`**<br>`535.93 Mops/s`<br>`0 B` · `0 a` | vs Node: **270.16x**<br>vs Bun: **22.57x** | OK |
| `s05_pipe_coalesce_curried` | Pipeline currié (DCommon.pipe + whenIsRight(DArray.coalescing)) | `536.16 ns`<br>`1.87 Mops/s` | `88.38 ns`<br>`11.31 Mops/s` | **`1.91 ns`**<br>`523.4 Mops/s`<br>`0 B` · `0 a` | vs Node: **280.71x**<br>vs Bun: **46.27x** | OK |
| `s06_mixed_union_dispatch` | Union hétérogène 5 types (number \| string \| bool \| Success \| Fail) | `473.35 ns`<br>`2.11 Mops/s` | `41.88 ns`<br>`23.88 Mops/s` | **`6.92 ns`**<br>`144.47 Mops/s`<br>`0 B` · `0 a` | vs Node: **68.40x**<br>vs Bun: **6.05x** | OK |
| `s07_nested_either_audit` | Double validation imbriquée (Success<Success<number>> \| Fail) | `401.12 ns`<br>`2.49 Mops/s` | `16.1 ns`<br>`62.11 Mops/s` | **`0.96 ns`**<br>`1046.55 Mops/s`<br>`0 B` · `0 a` | vs Node: **417.83x**<br>vs Bun: **16.77x** | OK |
| `s08_ecommerce_pricing_pipe` | Moteur tarification multi-modules (discount + tax + pipe utilisateur) | `1020.85 ns`<br>`0.98 Mops/s` | `128.26 ns`<br>`7.8 Mops/s` | **`3.82 ns`**<br>`261.79 Mops/s`<br>`0 B` · `0 a` | vs Node: **267.24x**<br>vs Bun: **33.58x** | OK |
| `s09_risk_pipeline_4stages` | Scoring risque 4 étapes (pipe + 3 whenIsRight enchaînés) | `2103.4 ns`<br>`0.48 Mops/s` | `130.41 ns`<br>`7.67 Mops/s` | **`4.3 ns`**<br>`232.75 Mops/s`<br>`0 B` · `0 a` | vs Node: **489.16x**<br>vs Bun: **30.33x** | OK |
| `s10_dynamic_clock_entropy` | Simulation dynamique horloge (anti-constant-folding + % + pipe) | `813.43 ns`<br>`1.23 Mops/s` | `127.66 ns`<br>`7.83 Mops/s` | **`201.32 ns`**<br>`4.97 Mops/s`<br>`0 B` · `0 a` | vs Node: **4.04x**<br>vs Bun: **0.63x** | OK |

## Détails par source

### `s01_auth_guard` — Garde d'accès & court-circuit logique (ok / fail / && / ||)

- Résultat JSON : [`s01_auth_guard/result.json`](./s01_auth_guard/result.json)
- Code Go généré : [`s01_auth_guard/go/`](./s01_auth_guard/go/)
- Go : P50 `4.06 ns` · P95 `4.59 ns` · P99 `5.86 ns` · `246.41 Mops/s` · `0 B/op` · `0 allocs/op` · `0 GC`

### `s02_banking_transfer` — Virement bancaire (Success<number> | Error<string> | Fail)

- Résultat JSON : [`s02_banking_transfer/result.json`](./s02_banking_transfer/result.json)
- Code Go généré : [`s02_banking_transfer/go/`](./s02_banking_transfer/go/)
- Go : P50 `9.61 ns` · P95 `12.68 ns` · P99 `12.88 ns` · `104.02 Mops/s` · `0 B/op` · `0 allocs/op` · `0 GC`

### `s03_http_status_router` — Routeur HTTP métier (DEither.left / right avec messages custom)

- Résultat JSON : [`s03_http_status_router/result.json`](./s03_http_status_router/result.json)
- Code Go généré : [`s03_http_status_router/go/`](./s03_http_status_router/go/)
- Go : P50 `10.5 ns` · P95 `11.73 ns` · P99 `11.9 ns` · `95.22 Mops/s` · `0 B/op` · `0 allocs/op` · `0 GC`

### `s04_batch_coalesce_direct` — Normalisation de lots (whenIsRight direct + DArray.coalescing)

- Résultat JSON : [`s04_batch_coalesce_direct/result.json`](./s04_batch_coalesce_direct/result.json)
- Code Go généré : [`s04_batch_coalesce_direct/go/`](./s04_batch_coalesce_direct/go/)
- Go : P50 `1.87 ns` · P95 `2.58 ns` · P99 `2.63 ns` · `535.93 Mops/s` · `0 B/op` · `0 allocs/op` · `0 GC`

### `s05_pipe_coalesce_curried` — Pipeline currié (DCommon.pipe + whenIsRight(DArray.coalescing))

- Résultat JSON : [`s05_pipe_coalesce_curried/result.json`](./s05_pipe_coalesce_curried/result.json)
- Code Go généré : [`s05_pipe_coalesce_curried/go/`](./s05_pipe_coalesce_curried/go/)
- Go : P50 `1.91 ns` · P95 `2.59 ns` · P99 `3.64 ns` · `523.4 Mops/s` · `0 B/op` · `0 allocs/op` · `0 GC`

### `s06_mixed_union_dispatch` — Union hétérogène 5 types (number | string | bool | Success | Fail)

- Résultat JSON : [`s06_mixed_union_dispatch/result.json`](./s06_mixed_union_dispatch/result.json)
- Code Go généré : [`s06_mixed_union_dispatch/go/`](./s06_mixed_union_dispatch/go/)
- Go : P50 `6.92 ns` · P95 `7.46 ns` · P99 `9.09 ns` · `144.47 Mops/s` · `0 B/op` · `0 allocs/op` · `0 GC`

### `s07_nested_either_audit` — Double validation imbriquée (Success<Success<number>> | Fail)

- Résultat JSON : [`s07_nested_either_audit/result.json`](./s07_nested_either_audit/result.json)
- Code Go généré : [`s07_nested_either_audit/go/`](./s07_nested_either_audit/go/)
- Go : P50 `0.96 ns` · P95 `0.96 ns` · P99 `0.96 ns` · `1046.55 Mops/s` · `0 B/op` · `0 allocs/op` · `0 GC`

### `s08_ecommerce_pricing_pipe` — Moteur tarification multi-modules (discount + tax + pipe utilisateur)

- Résultat JSON : [`s08_ecommerce_pricing_pipe/result.json`](./s08_ecommerce_pricing_pipe/result.json)
- Code Go généré : [`s08_ecommerce_pricing_pipe/go/`](./s08_ecommerce_pricing_pipe/go/)
- Go : P50 `3.82 ns` · P95 `4.65 ns` · P99 `5.17 ns` · `261.79 Mops/s` · `0 B/op` · `0 allocs/op` · `0 GC`

### `s09_risk_pipeline_4stages` — Scoring risque 4 étapes (pipe + 3 whenIsRight enchaînés)

- Résultat JSON : [`s09_risk_pipeline_4stages/result.json`](./s09_risk_pipeline_4stages/result.json)
- Code Go généré : [`s09_risk_pipeline_4stages/go/`](./s09_risk_pipeline_4stages/go/)
- Go : P50 `4.3 ns` · P95 `5.38 ns` · P99 `20.91 ns` · `232.75 Mops/s` · `0 B/op` · `0 allocs/op` · `0 GC`

### `s10_dynamic_clock_entropy` — Simulation dynamique horloge (anti-constant-folding + % + pipe)

- Résultat JSON : [`s10_dynamic_clock_entropy/result.json`](./s10_dynamic_clock_entropy/result.json)
- Code Go généré : [`s10_dynamic_clock_entropy/go/`](./s10_dynamic_clock_entropy/go/)
- Go : P50 `201.32 ns` · P95 `213.54 ns` · P99 `218.52 ns` · `4.97 Mops/s` · `0 B/op` · `0 allocs/op` · `0 GC`

