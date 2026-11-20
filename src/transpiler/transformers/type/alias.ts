import * as DArray from "@duplojs/lang/array";
import type { GoAST } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { SymbolFlags } from "typescript/async";
import { typeTransformers } from ".";

/**
 * Référence à un alias de type du projet, par exemple Result avec
 *     type Result = DEither.Success<number> | DEither.Fail;
 * On traduit directement le type désigné. L'alias n'existe pas dans le Go généré :
 * comme en JS, les déclarations de type sont effacées (voir transformSourceFile).
 *
 * Pour l'instant : alias non générique seulement (type Box<T> est refusé plus loin).
 */
export const typeAliasReferenceTransformer: Transformer<GoAST.Type | GoAST.TypeReference> = createTransformer(
	async(node, context) => {
		if (!TsAST.isTypeReferenceNode(node) || node.typeArguments) {
			return context.notSupport();
		}

		const { typeChecker } = context.transpilation;

		// Nœud du fichier : getSymbolAtLocation. Nœud fabriqué par le checker
		// (pos < 0, sans position) : on cherche le nom dans la portée du fichier.
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

		// Les déclarations sont des handles qu'il faut résoudre en nœuds AST.
		const declarationHandle = declaredSymbol.declarations && DArray.first(declaredSymbol.declarations);
		const declaration = declarationHandle && await declarationHandle.resolve();

		if (!declaration || !TsAST.isTypeAliasDeclaration(declaration) || declaration.typeParameters) {
			return context.notSupport();
		}

		return context.transform(declaration.type, typeTransformers.value);
	},
);
