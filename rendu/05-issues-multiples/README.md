# 05 · Traiter chaque issue d'un résultat (exo 05, première partie)

## La problématique

```ts
DEither.whenIsRightOtherwise(DArray.coalescing, () => [-12])
```

Un succès passe dans `coalescing`, toute autre issue passe dans `() => [-12]`. Trois nouveautés :
un **second rappel**, une **fonction écrite sur place** (fléchée), et un rappel qui **ignore
l'argument** qu'on lui donne.

## La solution

- **4 fonctions, un seul squelette.** `whenIsRight`, `whenIsLeft` et leurs `Otherwise` ne diffèrent
  que par le côté testé (`EitherIsRight` / `EitherIsLeft`) et la branche « sinon » (l'entrée telle
  quelle, ou `g(entrée)`). Un paramètre `side` et deux fabriques suffisent.
- **Boîte ouverte, boîte fermée.** Comme en JS : `f` reçoit le **contenu** (`e.Number()`), `g`
  reçoit l'**entrée entière** (`e`).
- **Fonctions fléchées et anonymes** → fonctions littérales Go. Les types viennent du checker, même
  sans annotation : dans `whenIsRight(r, (value) => …)`, `value` est un `float64`.
- **Le nombre d'arguments suit JavaScript**, pour tous les rappels : en trop, ignorés ; absents,
  `undefined` (refusé si le paramètre ne peut pas valoir `undefined`).
- **Branche impossible** (le rappel recevrait `never`) : retirée, sans `if`.

Voir [EXEMPLES.md](EXEMPLES.md) et [PISTES.md](PISTES.md).

## Où dans le code

`transformers/duplojs/either/when.ts`, `transformers/expression/function.ts`,
`transformers/common/callable.ts` (`applyCallback`, arité).
