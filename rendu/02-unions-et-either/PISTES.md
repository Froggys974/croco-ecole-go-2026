# 02 · Pistes explorées

La recommandation a changé plusieurs fois tant qu'on raisonnait sans mesurer ; une fois les
benchmarks lancés, le choix a été fait et n'a plus bougé. Les pistes étudiées se ramènent à cinq
familles.

## Les 5 pistes

| Piste | Idée | Verdict | Raison principale |
| --- | --- | --- | --- |
| 1. `any` | Toute union devient `any` ; on relit par assertion `x.(T)` | plan B | Le plus simple à générer, mais 1 allocation par frontière (42,5 ns sur `checkUserName`) et plus aucun typage Go |
| 2. Interface ou pointeur | L'idiome Go : une interface scellée et un `type switch`, ou `*T` pour `T \| null` | rejetée | Une flèche vers le tas, donc 1 allocation par valeur (18,5 ns contre 14,9) ; `string \| number` impose d'envelopper chaque primitif ; `null` et `undefined` indiscernables avec un pointeur |
| 3. Génériques Go | Une boîte `Either[L, R]` (notre v1), ou une boîte par union (`Union2[A, B]`…) | remplacée | Rapide (0 allocation, 31,7 ns), mais les génériques Go sont invariants : une conversion à chaque frontière (+6 ns), une version par nombre de membres, et `string \| number` refusé dans la v1 |
| 4. Imiter JavaScript | Une valeur JS universelle (JSValue), ou une `Value` récursive qui contient des `Value` | rejetée **après mesure** | Prédite meilleure, mesurée la plus lente (67 ns) : l'Either est recopié sur le tas. La version récursive ferait payer une allocation à **tous** les objets, même hors union |
| 5. **Valeur plate `Value`** | Une struct, primitifs à plat, case `object` pour le reste | **retenue** | 30,8 ns, 0 allocation ; aucune conversion entre unions ; aucun générique |

## Les mesures qui ont tranché

Benchmarks Go (`go test -bench -benchmem`), 3 passes, même machine, fonctions non inlinées pour
imiter du code généré.

| Scénario | Résultat |
| --- | --- |
| `checkUserName` complet | plate 30,8 ns · UnionN 31,7 · `any` 42,5 · JSValue 67 |
| 1 appel, struct contre interface | 14,9 ns · 0 alloc contre 18,5 ns · 1 alloc |
| Chaîne de 10 appels, valeur de 256 octets | struct copiée 310 ns · pointeur 850 · interface 1 030 |
| Générique contre non générique (inliné) | 12 ns contre 3,3 ns : le coût caché des génériques |

**Deux prédictions fausses.** « Une grosse struct perd contre un pointeur » : faux, copier 256 octets
reste moins cher qu'allouer. « JSValue est le meilleur compromis » : faux, c'est la plus lente.

## Pourquoi la struct plus lourde gagne

`Value` fait environ 64 octets (calculé) parce qu'elle prévoit une case pour chaque genre. On paie de
la place, on gagne du temps : une copie sur la pile ne coûte presque rien, une allocation demande de
chercher une place sur le tas puis du travail au ramasse-miettes.

## Décisions de détail

- **Le piège du narrowing.** Dans `if (isRight(r)) { print(r) }`, TS rétrécit `r`, mais la variable
  Go garde son type. On prend toujours le type **déclaré** (`common/valueType.ts`).
- **La mauvaise case.** Au début, la case était choisie d'après les drapeaux TS. Pour `"a" | "b"`,
  TS répond « union », et la valeur partait dans la case `object`. L'affichage restait juste, donc
  les tests ne le voyaient pas. Correction : choisir la case d'après le **type Go** (cas 66).
- **Union de même type Go (exo 05).** La règle `"a" | "b"` → `string` a été généralisée : si tous les
  membres ont le même type Go, l'union prend ce type (`readonly [number] | number[]` → `[]float64`).
- **Pas de champ marqueur.** La clé `success` / `fail` de l'objet JS est déduite du côté et du
  message. Écart accepté : `right("success", x)` affiche une clé que JS n'a pas.

## Limites assumées

- Toutes les unions ont le même type Go : Go ne vérifie plus quelles cases sont possibles. TS le
  garantit, et les tests différentiels servent de filet.
- Un objet ou un tableau **dans une union** coûte 1 allocation (déduit, pas mesuré pour les objets).
