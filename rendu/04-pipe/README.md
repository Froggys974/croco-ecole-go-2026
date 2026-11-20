# 04 · Le pipe (exo 03)

## La problématique

```ts
const newResult = DCommon.pipe(result, DEither.whenIsRight(DArray.coalescing));
```

`pipe(x, f, g, h)` veut dire `h(g(f(x)))` : chaque étape reçoit le résultat de la précédente. En JS,
DuploJS garde les étapes dans une liste et la parcourt avec une boucle qui modifie un accumulateur,
à l'exécution. Go n'a ni pipe, ni génériques à nombre d'arguments variable.

## La solution : dérouler le pipe à la traduction

Les étapes sont écrites dans le code : on les connaît à la traduction. Chaque étape devient un
appel, rangé dans une **nouvelle variable**. La fonction `pipe` disparaît du Go produit.

```go
step1 := double(x)
step2 := check(step1)
out := whenIsRight(step2, …) // la recette de l'étape, écrite sur place
```

- **Rapide** : de simples appels, que Go optimise. **Typé** : chaque variable a son vrai type.
  **Sans mutation** : une variable par étape.
- **La forme curryfiée** `whenIsRight(f)` est reconnue par l'appelable (un argument de moins que la
  forme complète) : `f` est gardée, l'entrée viendra du pipe. Même Go qu'en forme complète.
- **Entre deux étapes**, la valeur est emballée ou déballée si les types diffèrent (même outil
  qu'aux autres frontières).

Voir [EXEMPLES.md](EXEMPLES.md) et [HISTORIQUE.md](HISTORIQUE.md).

## Où dans le code

`transformers/duplojs/common/pipe.ts`, `transformers/common/callable.ts`.
