import { TsAST } from "@typescript";
import { SymbolFlags, type Type } from "typescript/async";
import { type BuildContext } from "../../context/build";

/**
 * Le type Go réel d'une expression TS.
 *
 * Piège du narrowing : dans
 *     if (DEither.isRight(result)) { DCommon.print(result); }
 * le checker dit que result est un Success<number>, rétréci par le if.
 * Mais la variable Go garde son type déclaré, shard_dependencies.Value,
 * car Go ne rétrécit jamais une variable. On prend donc le type déclaré.
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
