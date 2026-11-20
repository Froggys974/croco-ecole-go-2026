# Suite de Benchmarks Portable (`/benchmark`)

Suite autonome de scénarios TypeScript / DuploJS réalistes découverts dynamiquement dans `inputs/`, indépendante de l'implémentation interne du transpileur (`Value`, `EitherCompact`, `EitherTagged` ou `Either`).

## Exécution en 1 commande (Linux + Docker)

```bash
docker compose -f benchmark/compose.yml run --rm bench
```

Options disponibles (transmises directement à `src/runner.mjs`) :

```bash
# Ne rejouer qu'un ou deux scénarios
docker compose -f benchmark/compose.yml run --rm bench --only s02_banking_transfer,s09_risk_pipeline_4stages

# Fixer la graine ou la charge (défaut : graine horloge, 25 x 40 000 = 1 000 000 ops/cas)
docker compose -f benchmark/compose.yml run --rm bench --seed 123456 --iters 100000
```

## Exécution directe sans Docker (si Node 24, Bun 1.4 et Go 1.27 sont installés)

```bash
bash benchmark/entrypoint.sh
```

## Structure générée

- `benchmark/inputs/<id>/` : code TypeScript source découvert automatiquement (`kernel.ts` exporte `runScenario(seed: number): number`, `index.ts` sert d'entrée au CLI).
- `benchmark/outputs/<id>/go/` : code Go pur généré par le transpileur.
- `benchmark/outputs/<id>/result.json` : métriques brutes (Node, Bun, Go, P50/P95/P99, Mops/s, `B/op`, `allocs/op`, `numGC`, checksum).
- `benchmark/outputs/report.json` : agrégat global de la campagne.
- `benchmark/outputs/report.md` : tableau synthétique lisible sur GitHub.
- `benchmark/outputs/report.html` : rapport autonome ouvrable dans n'importe quel navigateur (vue groupée + vue individuelle avec code TS vs Go généré côte à côte).
