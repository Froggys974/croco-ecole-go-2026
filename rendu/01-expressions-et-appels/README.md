# 01 · Expressions et appels (exos 00 et 04)

## La problématique

- Traduire `one + two` alors que les paramètres sont des `number` TypeScript.
- Traduire un appel à une fonction DuploJS (`DEither.success`), qui n'existe pas en Go.
- Préparer un appel sans changer l'**ordre d'évaluation** de JavaScript.
- Exo 04 : traduire `-1`, qui pour TypeScript n'est pas un nombre mais une opération.

## La solution

| Question | Réponse |
| --- | --- |
| `number` | `float64` : un nombre JS est toujours un flottant 64 bits. `10 / 4` vaut `2.5`, pas `2`. |
| Fonction DuploJS | Une fonction du **runtime partagé** (`shard_dependencies`), écrit une fois en Go et importé par chaque fichier : `DEither.success(x)` → `EitherSuccess(…)`. |
| Ordre d'évaluation | Chaque traducteur rend `{ before, result }` : les lignes à exécuter **avant** (`before`) et l'expression finale (`result`). La fonction appelée, puis chaque argument, de gauche à droite, une seule fois. |
| `a && b` | Si `b` a des lignes `before`, elles ne doivent tourner que si `a` est vrai : elles sont enfermées dans une fonction appelée tout de suite. |
| `-1`, `!ok` | Un traducteur des opérations à un seul côté. `!` est refusé sur un nombre : Go exige un vrai booléen. |

Voir [EXEMPLES.md](EXEMPLES.md) et [HISTORIQUE.md](HISTORIQUE.md).

## Où dans le code

`transformers/type/float.ts`, `transformers/shared/call.ts`, `transformers/expression/binary.ts`,
`transformers/expression/unary.ts`, `sharedDependency/`.
