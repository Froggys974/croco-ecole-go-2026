# Croco École — Hackathon Go 2026

Projet réalisé pendant un hackathon. Le but : écrire un **transpileur** qui prend du
**TypeScript écrit avec DuploJS** et le traduit en **Go**, avec un programme Go qui donne
exactement le même résultat que le TypeScript.

## Le rendu

Toutes les explications sont dans le dossier [rendu/](rendu/) :
les problématiques rencontrées, les solutions retenues, les pistes abandonnées et des exemples.

Le dossier [07-methode-et-verification](rendu/07-methode-et-verification/) décrit notre méthode de
travail et notre cheminement de pensée ; [08-approche-hybride](rendu/08-approche-hybride/) explore
une piste parallèle sur le périmètre `00`–`04`, et [09-vision-long-terme](rendu/09-vision-long-terme/)
pose les pistes théoriques pour la suite (`06`–`10` et `@duplojs/server`).

## Les projets réussis

Les exercices 00 à 05 produisent une sortie Go identique à celle de TypeScript.

| Projet | Sujet |
| --- | --- |
| [00](projects/00/) | Traduire une addition |
| [01](projects/01/) | Représenter un retour composé de plusieurs variantes |
| [02](projects/02/) | Transmettre une fonction pour transformer un résultat |
| [03](projects/03/) | Composer des transformations dans un pipe |
| [04](projects/04/) | Représenter plusieurs chemins de retour |
| [05](projects/05/) | Transformer les différentes issues d'un résultat |

Les projets 06 à 10 n'ont pas été implémentés ; leurs pistes théoriques de traduction sont
présentées dans [rendu/09-vision-long-terme/](rendu/09-vision-long-terme/).

## Le reste du dépôt

- [src/](src/) : le code du transpileur
- [benchmark/](benchmark/) : comparaison des performances Node.js, Bun et Go
- [robots/](robots/) : documentation technique interne et tests différentiels pour la suite (`05`–`10`)
