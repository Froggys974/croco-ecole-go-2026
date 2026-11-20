# 02 · Unions et Either (exos 01 et 04)

## La problématique

TypeScript sait dire « ou » : `string | number`, `Success<number> | Fail`. Go non : une variable Go a
un seul type, fixé à la compilation. En JS, chaque valeur porte une **étiquette** (`typeof` la lit) ;
en Go, un `float64` n'est que 8 octets. Il faut donc décider **où ranger la valeur, et où ranger
l'étiquette** qui dit ce qu'elle est.

## La solution : la valeur plate `Value`

Toute union, et tout Either DuploJS, devient **une seule struct Go, non générique** : une case par
genre de valeur JS, plus une étiquette qui dit quelle case est remplie.

```go
type Value struct {
	kind    ValueKind // l'étiquette : number, string, boolean, null, undefined, object, Left, Right
	payload ValueKind // pour un Either : le genre de son contenu
	message string    // pour un Either : "success", "must-be-positive"…
	number  float64
	text    string
	boolean bool
	object  any       // tout le reste : objets, tableaux, Either dans un Either
}
```

| Type TS | Type Go |
| --- | --- |
| `number`, `string`, `boolean` seuls | `float64`, `string`, `bool` : pas de boîte |
| Union dont tous les membres ont le même type Go (`"a" \| "b"`, `[number] \| number[]`) | ce type (`string`, `[]float64`) |
| Toute autre union, tout Either | `Value` |

- **Aux frontières** (`return`, argument, variable typée), on **emballe** (`ValueNumber(x)`) ou on
  **déballe** (`x.Number()`). La case est choisie à la traduction, d'après le type donné par le checker.
- **Mémoire** : `Value` passe par valeur. Les primitifs sont rangés dans la struct, sur la pile :
  **0 allocation**. Seule la case `object` (un `any`) peut allouer, quand un objet ou un tableau entre
  dans une union.
- **La case `object` (`any`) est un repli** : elle reçoit les types qu'on n'a pas rangés à plat dans
  `Value` (objets, tableaux, Either dans un Either). Ce n'est pas une limite : pour supporter un de
  ces types à plat, il suffit d'ajouter sa case dans `Value` (par exemple `numbers []float64`) avec
  ses fonctions pour emballer et déballer. On n'a pas eu besoin de le faire pour les exos.
- **Mesuré** sur `checkUserName` : **30,8 ns, 0 allocation**, la plus rapide des pistes testées.

Voir les [exemples](EXEMPLES.md), les [pistes](PISTES.md) et [l'approche hybride](../08-approche-hybride/)
exploitant la méthode par structs spécialisées sans boxing d'interface.

## Où dans le code

`sharedDependency/value.ts` (le runtime), `transformers/type/union.ts`, `transformers/common/coerce.ts`
(emballer / déballer), `transformers/common/valueType.ts` (le type déclaré, pas le type rétréci).
