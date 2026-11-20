import { GoAST } from "@go";

/**
 * Imports Go de la bibliothèque standard utilisés par les dépendances partagées.
 *
 * Chaque import est un objet unique : deux dépendances qui importent le même
 * package partagent la même référence, ce qui permet à build.ts de dédoublonner.
 */
export const goImports = {
	encodingJson: GoAST.createImportDeclaration({ path: "encoding/json" }),
	errors: GoAST.createImportDeclaration({ path: "errors" }),
	os: GoAST.createImportDeclaration({ path: "os" }),
};
