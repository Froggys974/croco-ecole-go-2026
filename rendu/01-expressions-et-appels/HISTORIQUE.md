# 01 · Historique

## `number` → quel type Go ?

| Piste | Verdict | Pourquoi |
| --- | --- | --- |
| `int` | rejetée | `10 / 4` vaut `2.5` en JS, `2` en Go avec des entiers. `0.1 + 0.2` est impossible. |
| Choisir `int` ou `float64` selon la valeur | rejetée | Le type d'une variable doit être connu à la traduction ; une valeur qui change de genre casserait le code. |
| **`float64`** | **retenue** | C'est exactement le `number` de JS (IEEE 754, 64 bits). Testé : cas 09 (`0.1 + 0.2`, `10 / 4`). |

## Appeler une fonction DuploJS

DuploJS n'existe pas en Go. Il faut, pour chaque fonction, savoir quel Go écrire.

| Piste | Verdict | Pourquoi |
| --- | --- | --- |
| Traduire automatiquement le code de DuploJS | impossible | Le paquet ne contient que du JS sans types (`.mjs`) et des types sans code (`.d.ts`). |
| Fonction Go générique `EitherSuccessOf[T]` (première version) | remplacée | `go vet` refusait la fonction générique rangée dans une variable sans son type : il fallait demander `T` au checker à chaque appel. La représentation des unions (dossier 02) a supprimé le besoin de générique. |
| **Runtime partagé non générique** | **retenue** | `EitherSuccess(ValueNumber(x))` : écrit une fois, importé partout, sans générique. |

## L'ordre d'évaluation

En JS, `f(a(), b())` évalue `f`, puis `a()`, puis `b()`, une seule fois chacun. Le transpileur range
chaque morceau dans une variable `before`, dans cet ordre. Le Go produit est plus long, mais il fait
exactement ce que fait JS.

**Le bug trouvé par les tests (cas 13).** Dans `a && probe()`, les lignes `before` du côté droit
étaient placées avant toute l'expression : `probe()` tournait même quand `a` était faux. Le Go
compilait, et seul le test différentiel l'a montré. Correction : enfermer le côté droit dans une
fonction appelée tout de suite, qui sort tôt si `a` est faux. Pas de variable modifiée.

## `-1` (exo 04)

Pour TypeScript, `-1` est une `PrefixUnaryExpression` : « moins » appliqué à `1`. Rien ne savait le
traduire, le build s'arrêtait. Ajout d'un traducteur pour `-` (sur un nombre) et `!` (sur un
booléen). `!5` est refusé : en JS il vaut `false` (règle « vrai / faux » propre à JS), Go n'a pas
d'équivalent, et on refuse plutôt que d'inventer (cas 76).
