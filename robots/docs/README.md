# Documentation technique interne (`robots/docs/`)

Ce dossier conserve uniquement les spécifications et checklists techniques utiles pour **prolonger la branche hybride** ([`hybrid-arch`](https://github.com/Froggys974/croco-ecole-go-2026/tree/hybrid-arch)) après le hackathon.

Pour l'architecture déjà implémentée (`00`–`04`), les benchmarks et les choix fondateurs, se référer directement au rendu public :
- [rendu/README.md](../../rendu/README.md) — vue d'ensemble des problématiques `01`–`07`
- [rendu/08-approche-hybride/README.md](../../rendu/08-approche-hybride/README.md) — structs spécialisées (`EitherCompact`, `EitherTagged`, `EitherOrFail`), `pipe` à plat et benchmarks
- [rendu/09-vision-long-terme/README.md](../../rendu/09-vision-long-terme/README.md) — synthèse des deux trajectoires pour `06`–`10` et `@duplojs/server`

## Documents

| Document | Rôle pour la suite de `hybrid-arch` |
| :--- | :--- |
| [01-strategies-ts-go-et-either.md](01-strategies-ts-go-et-either.md) | Taxonomie des 4 familles d'écarts TS → Go et des 11 variantes `@duplojs/lang/either`, calée sur l'architecture hybride. |
| [02-roadmap-exercices-05-a-10.md](02-roadmap-exercices-05-a-10.md) | État d'implémentation (`00`–`04` faits) et fiches détaillées pour coder les exercices `05`–`10`. |
| [03-pistes-implementation-05-a-10.md](03-pistes-implementation-05-a-10.md) | Recettes d'implémentation propres (`AGENTS.md`, `resolveReferenceModule`, zéro `as any`) pour les exercices `05`–`10` et le confort restant. |
| [04-garde-fous-et-optimisations.md](04-garde-fous-et-optimisations.md) | Checklist des garde-fous compilateur Go et optimisations restantes (`Sum-Types 32B`, `int64` sur `%`, PGO). |
