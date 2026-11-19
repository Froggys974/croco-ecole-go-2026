import * as DArray from "@duplojs/lang/array";
import type { GoAST } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { SymbolFlags } from "typescript/async";
import { typeTransformers } from ".";

/**
 * Référence à un alias de type du projet : `Result` avec
 *     type Result = DEither.Success<number> | DEither.Fail;
 * → on traduit directement le type aliasé (l'alias n'existe pas en Go généré :
 *   comme en JS, les déclarations de type sont effacées, cf. transformSourceFile).
 *
 * v1 : alias non générique uniquement (`type Box<T> = …` est refusé plus loin).
 */
export const typeAliasReferenceTransformer: Transformer<GoAST.Type | GoAST.TypeReference> = createTransformer(
	async(node, context) => {
		if (!TsAST.isTypeReferenceNode(node) || node.typeArguments) {
			return context.notSupport();
		}

		const { typeChecker } = context.transpilation;

		// Nœud réel du fichier → getSymbolAtLocation ; nœud fabriqué par le checker
		// (pos < 0, pas de position) → recherche du nom dans la portée du fichier.
		const symbol = node.pos >= 0
			? await typeChecker.getSymbolAtLocation(node.typeName)
			: TsAST.isIdentifier(node.typeName)
				? await typeChecker.resolveName(node.typeName.text, SymbolFlags.Type, context.file.sourceFile)
				: undefined;

		if (!symbol) {
			return context.notSupport();
		}

		const declaredSymbol = symbol.flags & SymbolFlags.Alias
			? await typeChecker.getAliasedSymbol(symbol)
			: symbol;

		// Les déclarations sont des « handles » : il faut les résoudre en nœuds AST.
		const declarationHandle = declaredSymbol.declarations && DArray.first(declaredSymbol.declarations);
		const declaration = declarationHandle && await declarationHandle.resolve();

		if (!declaration || !TsAST.isTypeAliasDeclaration(declaration) || declaration.typeParameters) {
			return context.notSupport();
		}

		return context.transform(declaration.type, typeTransformers.value);
	},
);
