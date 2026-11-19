import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { GoAST } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { type BuildContext } from "../../context/build";
import { coerceExpression } from "../common/coerce";
import { resolveValueType } from "../common/valueType";
import { expressionTransformers } from "../expression";

/**
 * const result = add(1, 2); devient Sourced_result := <expression>
 *
 * Avec un type annoté (const x: A | B = ...), la valeur est convertie vers ce type.
 * Une variable jamais lue est permise en TS mais refusée par Go (declared and not used).
 * On ajoute alors _ = Sourced_x, la façon Go de dire qu'elle est inutilisée exprès.
 *
 * Pour l'instant : une seule déclaration, un nom simple, une valeur initiale.
 * Le reste est refusé clairement, jamais de Go faux en silence.
 */

async function isNeverRead(
	name: TsAST.Identifier,
	context: BuildContext,
) {
	const { typeChecker } = context.transpilation;
	const symbol = await typeChecker.getSymbolAtLocation(name);

	if (!symbol) {
		return false;
	}

	const references = await typeChecker.getReferencesToSymbolInFile(
		context.file.sourceFile.fileName,
		symbol,
	);

	// La déclaration compte comme une référence. En cas de doute (1 ou moins),
	// ajouter _ = x est sans danger : c'est juste une ligne de plus.
	return DArray.length(references) <= 1;
}

export const variableStatementTransformer: Transformer<GoAST.Statement> = createTransformer(
	async(node, context) => {
		if (!TsAST.isVariableStatement(node)) {
			return context.notSupport();
		}

		const { declarations } = node.declarationList;
		const declaration = DArray.first(declarations);

		if (!declaration || !DArray.lengthEqual(declarations, 1)) {
			return context.error(node, "un-support-multiple-variable-declarations");
		}

		if (!TsAST.isIdentifier(declaration.name)) {
			return context.error(declaration, "un-support-destructuring-variable-declaration");
		}

		if (!declaration.initializer) {
			return context.error(declaration, "un-support-variable-declaration-without-initializer");
		}

		const initializer = await DCommon.asyncPipe(
			context.transform(declaration.initializer, expressionTransformers.value),
			DEither.unwrapRight,
		);

		if (DEither.isLeft(initializer)) {
			return initializer;
		}

		const { typeChecker } = context.transpilation;

		const value = declaration.type
			? await DCommon.asyncPipe(
				coerceExpression(
					initializer.result,
					await resolveValueType(declaration.initializer, context),
					await typeChecker.getTypeFromTypeNode(declaration.type),
					declaration.initializer,
					context,
				),
				DEither.unwrapRight,
			)
			: { result: initializer.result };

		if (DEither.isLeft(value)) {
			return value;
		}

		const identifier = context.createSourceIdentifier(declaration.name.text);

		const variableDeclaration = GoAST.createShortVariableDeclarationStatement({
			identifier,
			initializer: value.result,
		});

		if (!await isNeverRead(declaration.name, context)) {
			return context.success({
				before: initializer.before,
				result: variableDeclaration,
			});
		}

		return context.success({
			before: DArray.push(initializer.before, variableDeclaration),
			result: GoAST.createAssignmentStatement({
				targets: DCommon.cast([GoAST.createIdentifier("_")]),
				values: DCommon.cast([identifier]),
			}),
		});
	},
);
