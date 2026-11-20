# 03 · Pistes explorées

## Comment traduire `whenIsRight(result, f)` ?

| Piste | Verdict | Pourquoi |
| --- | --- | --- |
| Traduire le code JS de DuploJS | impossible | Pas de source TypeScript dans le paquet (voir dossier 01). |
| Fonction du runtime générique `WhenIsRight[T, U](e, f func(T) U) U` | rejetée | Si `e` est un Fail et que `U` est `string`, on ne peut pas rendre le Fail : seule la valeur zéro (`""`) est possible, un résultat faux en silence. Plus le coût caché des génériques. |
| Fonction du runtime non générique `WhenIsRight(e Value, f func(Value) Value) Value` | rejetée | Tout passe par `Value` : le rappel reçoit la boîte, pas le contenu (faux : DuploJS passe le contenu), et chaque résultat doit être réemballé. Le rappel devient un appel indirect que Go n'optimise pas. |
| Un `if` qui modifie une variable | rejetée | `var r Value; if … { r = … } else { r = … }` : une mutation, et une variable déclarée sans valeur. |
| **Recette qui écrit le Go sur place, dans une fonction appelée tout de suite** | **retenue** | Le seul test restant est « est-ce un Right ? ». Le rappel reçoit le contenu déjà sorti de la boîte, avec son vrai type. Aucune mutation, aucun générique. |

## Ce que la recette décide à la traduction

| JavaScript, à chaque appel | La recette, une fois |
| --- | --- |
| `whenIsRight` : « 1 ou 2 arguments ? » (forme curryfiée ou complète) | on compte les arguments |
| `coalescing(x)` : « `x` est-il un tableau ? » | le type Go le dit : on écrit `[]float64{x}` |
| quel type a le contenu ? | la signature du rappel, résolue par le checker : `float64` → on lit `.Number()` |

## L'appelable : un mécanisme, pas un cas particulier

L'exo ne parle que de `whenIsRight`. Le vrai sujet est « une fonction utilisée comme une valeur » :
donnée en argument, appliquée à moitié (forme curryfiée), mise dans un pipe. Plutôt que de traiter
ces cas un par un, un seul outil, l'**appelable**, sait « s'appliquer à des arguments ». Résultat :
quand les fonctions fléchées ont été ajoutées (exo 05), elles ont marché partout d'un coup.

## Deux règles du Go produit

- **L'entrée est calculée une seule fois.** Elle sert dans le test et dans le `return`. Si c'est un
  appel (`whenIsRight(probe(), f)`), on le range d'abord dans une variable (cas 64).
- **Aucune mutation.** Le `if` au milieu d'une expression devient une fonction appelée tout de suite.

## Pourquoi pas une recette pour chaque fonction DEither déjà là ?

`success`, `left`, `isRight`… restent dans un aiguillage à part : ils construisent ou testent un
Either, ils n'ont pas d'« entrée » à transformer. Règle : une fonction qui prend une entrée et peut
servir d'étape de pipe va dans le registre.
