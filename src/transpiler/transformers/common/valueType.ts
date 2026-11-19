import { TsAST } from "@typescript";
import { SymbolFlags, type Type } from "typescript/async";
import { type BuildContext } from "../../context/build";

/**
 * Type de la VALEUR Go d'une expression TS.
 *
 * Piège du narrowing : dans
 *     if (DEither.isRight(result)) { DCommon.print(result); }
 * le checker dit que `result` est Success<number> (rétréci par le if),
 * mais la variable Go, elle, garde son type déclaré : Either[JSUndefined, float64].
 * Go ne rétrécit jamais une variable : pour une référence à une variable,
 * on prend donc le type DÉCLARÉ du symbole, pas le type rétréci.
 */
export async function resolveValueType(
	expression: TsAST.Expression,
	context: BuildContext,
): Promise<Type> {
	const { typeChecker } = context.transpilation;

	if (TsAST.isIdentifier(expression)) {
		const symbol = await typeChecker.getSymbolAtLocation(expression);

		if (symbol) {
			const declaredSymbol = symbol.flags & SymbolFlags.Alias
				? await typeChecker.getAliasedSymbol(symbol)
				: symbol;

			return typeChecker.getTypeOfSymbol(declaredSymbol);
		}
	}

	return typeChecker.getTypeAtLocation(expression);
}
