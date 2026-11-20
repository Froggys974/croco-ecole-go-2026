# 03 · Fonctions en argument (exo 02)

## La problématique

```ts
const newResult = DEither.whenIsRight(result, DArray.coalescing);
```

`whenIsRight` reçoit une **fonction** (un rappel). Si `result` est un Right, il applique `coalescing`
à son **contenu** et rend ce que `coalescing` rend (sans le remettre dans un Either). Sinon, il rend
`result` tel quel. Ni `whenIsRight` ni `coalescing` n'existent en Go.

## La solution

1. **La recette.** Pour chaque fonction DuploJS, une recette dit quel Go écrire à sa place. Elle
   décide à la traduction ce que le JS de DuploJS décide à l'exécution.
2. **Le registre.** Une table « `either.whenIsRight` → sa recette ». Ajouter une fonction DuploJS =
   une recette + une ligne. Une fonction absente est refusée avec son nom.
3. **L'appelable.** Une seule notion pour « une fonction utilisée comme valeur » : une fonction
   DuploJS (sa recette construit le Go sur place) ou une fonction du projet, une flèche, un paramètre
   (un appel Go normal). La recette `whenIsRight` ne sait pas quelle sorte de rappel elle reçoit.
4. **Le Go produit.** Une fonction appelée tout de suite, qui contient le seul test qui dépend vraiment
   de la valeur : `if EitherIsRight(…)`.

```go
newResult := func() Value {
	if EitherIsRight(result) {
		return ValueObject([]float64{result.Number()}) // coalescing, écrit sur place
	}
	return result
}()
```

Voir [EXEMPLES.md](EXEMPLES.md) et [PISTES.md](PISTES.md).

## Où dans le code

`transformers/common/callable.ts` (l'appelable), `transformers/duplojs/functions.ts` (le registre),
`transformers/duplojs/either/when.ts`, `transformers/duplojs/array/coalescing.ts`.
