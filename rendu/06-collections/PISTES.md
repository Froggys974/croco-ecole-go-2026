# 06 · Pistes explorées

## Quelle boucle pour `map` ? Mesuré, pas deviné

`map` de 1 000 nombres (`f(x) = x + 1`), benchmarks Go, 3 passes :

| Façon de faire | Temps | Allocations |
| --- | --- | --- |
| **`make` + `for range` (retenu)** | **1,9 µs** | **1 · 8 Ko** |
| `make(0, n)` + `append` | 2,5 µs | 1 |
| Fonction générique du runtime `Map[T, U](xs, f)` | 2,0 µs | 1 |
| Slice vide + `append` | 5,1 µs | 9 · 25 Ko |
| Récursion qui remplit une slice faite par `make` | 10,4 µs | 1 |
| Récursion « fonctionnelle » (sans boucle ni mutation) | 977 µs | 1 999 · 4,3 Mo |

- **`make`** réserve la slice à la bonne taille en une fois. Avec `append` sur une slice vide, Go
  doit l'agrandir quand elle est pleine : réserver plus grand, tout recopier, jeter l'ancienne.
- **La récursion perd** : Go ne la transforme pas en boucle, chaque élément coûte un vrai appel. La
  version fonctionnelle recopie tout à chaque niveau : le travail grandit comme le carré de la taille.
- **La règle « pas de `for` » vaut pour le transpileur**, pas pour le Go produit. Dans le Go produit,
  ce sont la vitesse et la mémoire qui comptent.
- **`out[i] = …` n'est pas une mutation visible** : la slice est toute neuve, personne ne la voit avant
  le `return`. C'est ce que fait `Array.prototype.map` en interne.
- **Le générique** va aussi vite ici parce que Go a pu recopier le rappel dans la boucle. Il
  n'apporte rien de plus, et sans cette recopie son coût caché revient.

## Mieux dans certains cas : gardé pour plus tard

| Piste | Mesure | Ce qu'il faut savoir à la traduction |
| --- | --- | --- |
| Écrire dans l'entrée au lieu d'une nouvelle slice | 0,25 µs · 0 alloc (×8) | L'entrée est un temporaire que personne ne relira, et le type ne change pas |
| Fusionner deux `map` qui se suivent | 2,0 µs au lieu de 3,8 (×2) | Deux `map` consécutifs dans un `pipe` |
| Dérouler un tuple de taille connue | 6,4 ns au lieu de 9,1 (1 élément) | Le type est un tuple : `[]string{f(x[0])}` |

Correctes mais demandant une analyse en plus : faute de temps, on garde `make` + `for range`, juste
dans tous les cas. À noter : avec `DString.to`, la conversion coûte 40,8 µs pour 1 000 nombres, la
boucle 2 µs. C'est la conversion qu'il faudra optimiser d'abord.

## Écrire un nombre comme JavaScript

`fmt.Sprint` ne donne pas toujours le texte de JS (`1e+21`, `1e-7`, `NaN`…). Or `encoding/json`
suit l'algorithme ES6 de `Number.prototype.toString` pour les nombres finis. `StringFromNumber`
s'en sert et traite à part ce que JSON écrit autrement : `NaN`, `Infinity`, `-Infinity`, `-0`
(JS écrit `"0"`). Vérifié par le cas 81 : sortie identique à JS.

## Les étiquettes de type (`&`)

Le résultat de `map` dans l'exo 05 a pour type `readonly (string & Number)[] & LengthEqual<1>`.

| Piste | Verdict | Pourquoi |
| --- | --- | --- |
| Réparer seulement `map` (déduire `[]string` du rappel) | rejetée | La variable, le `pipe` et le `print` demandent ensuite le même type |
| Ne plus utiliser les types TS, tout déduire du Go | rejetée | Refonte complète ; le checker reste indispensable aux frontières |
| **Retirer les étiquettes dans le traducteur de types** | **retenue** | Les membres qu'on ne sait pas traduire (`Number`, `LengthEqual<1>`) sont des étiquettes ; s'il reste un seul vrai type, c'est le résultat ; plusieurs vrais types différents : refus |

C'est sûr pour les textes et les nombres : en JS, ils ne peuvent pas porter de propriété. Pour une
fonction ou un tableau, ce n'est sûr que tant qu'on ne lit pas la propriété (aujourd'hui refusé).
