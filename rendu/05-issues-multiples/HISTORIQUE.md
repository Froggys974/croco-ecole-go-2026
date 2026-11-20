# 05 · Historique

## `whenIsRightOtherwise` : copier ou factoriser ?

| Piste | Verdict | Pourquoi |
| --- | --- | --- |
| Copier la recette `whenIsRight` | rejetée | La première copie n'appelait jamais `g`, et rendait l'entrée telle quelle quand ce n'était pas un Either. Deux bugs, et deux fois le même code. |
| Boucler sur les rappels `[f, g]` | rejetée | `f` et `g` ne reçoivent pas la même chose : `f` le contenu, `g` l'entrée entière. Une boucle ouvrirait la boîte pour `g`. |
| **Un squelette commun, un paramètre `side`, deux fabriques** | **retenue** | Seuls le test et la branche « sinon » changent. `whenIsLeft` et `whenIsLeftOtherwise` sont venus gratuitement. |

## Les fonctions fléchées

`() => [-12]` n'était traduit par rien. Go a l'équivalent exact : une fonction littérale, qui voit
les variables autour d'elle. Un paramètre non annoté prend le type de son contexte, donné par le
checker. Refusés clairement : génériques, paramètres optionnels, par défaut, `...rest`, déstructurés,
et fonctions qui ne rendent rien (`void`).

## Les deux bugs trouvés en lançant l'exo 05

1. **`un-support-callback-signature`.** L'appelable refusait les génériques avec
   `if (signature.typeParameters)`. Dans l'API de TypeScript 7, ce champ vaut toujours un tableau,
   vide si la fonction n'est pas générique, et un tableau vide compte comme « vrai » en JS : **tous**
   les rappels étaient refusés. `tsc` ne pouvait pas le voir ; le build l'a montré.
2. **`un-support-callback-arity`.** DuploJS déclare `g` avec un paramètre, `() => [-12]` n'en
   déclare aucun. JS ignore l'argument en trop ; Go refuse de compiler.

## Arité : correctif local ou règle générale ?

| Piste | Verdict | Pourquoi |
| --- | --- | --- |
| Corriger juste `whenIsRightOtherwise` | rejetée | Le même problème revient dans `map` (qui passe aussi l'index), dans `pipe`… |
| **La règle de JavaScript, dans l'appelable** | **retenue** | En trop : ignorés. Absents : `undefined` si le type l'accepte, sinon refus. Un rappel qui ne lit rien est appelé sans argument, même si le type de cet argument n'est pas traduisible. |

## Les branches mortes

`whenIsLeft(successSeul, f)` : `f` recevrait le type `never`, sa branche ne peut jamais s'exécuter.
Elle est retirée ; l'autre est écrite sans test. Une ligne `_ = e` garde l'entrée calculée (comme en
JS) et évite l'erreur Go « declared and not used » (cas 95).
