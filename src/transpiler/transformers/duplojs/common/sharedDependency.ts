import * as DCommon from "@duplojs/lang/common";
import { GoAST } from "@go";
import { createSharedDependency, goImports } from "@transformer";

export const commonIdentifiers = {
	print: GoAST.createIdentifier("CommonPrint"),
};

/**
 * CommonPrint[T] affiche la valeur en JSON puis la renvoie, comme DCommon.print en JS.
 *
 *   func CommonPrint[T any](input T) T {
 *       encoder := json.NewEncoder(os.Stdout)
 *       encoder.SetEscapeHTML(false)
 *       encoder.Encode(input)
 *       return input
 *   }
 *
 * Format JSON : divergence connue avec tsx (util.inspect), à confirmer avec les organisateurs.
 */
export const commonPrintDependency = DCommon.memo(() => {
	const typeParameter = GoAST.createTypeParameter({
		identifier: GoAST.createIdentifier("T"),
		constraint: GoAST.builtinTypeReferences.any,
	});

	const input = GoAST.createIdentifier("input");
	const encoder = GoAST.createIdentifier("encoder");

	return createSharedDependency({
		imports: [goImports.encodingJson, goImports.os],
		init: [],
		declarations: [
			GoAST.createFunctionDeclaration({
				identifier: commonIdentifiers.print,
				generic: [typeParameter],
				arguments: [
					GoAST.createFunctionArgument({
						identifier: input,
						type: typeParameter.identifier,
					}),
				],
				returnTypes: [typeParameter.identifier],
				body: GoAST.createBlockStatement({
					statements: [
						GoAST.createShortVariableDeclarationStatement({
							identifier: encoder,
							initializer: GoAST.createCallExpression({
								callee: GoAST.createSelectorExpression({
									target: GoAST.createIdentifier("json"),
									identifier: GoAST.createIdentifier("NewEncoder"),
								}),
								arguments: [
									GoAST.createSelectorExpression({
										target: GoAST.createIdentifier("os"),
										identifier: GoAST.createIdentifier("Stdout"),
									}),
								],
							}),
						}),
						GoAST.createCallExpression({
							callee: GoAST.createSelectorExpression({
								target: encoder,
								identifier: GoAST.createIdentifier("SetEscapeHTML"),
							}),
							arguments: [GoAST.createBooleanLiteral({ value: false })],
						}),
						GoAST.createCallExpression({
							callee: GoAST.createSelectorExpression({
								target: encoder,
								identifier: GoAST.createIdentifier("Encode"),
							}),
							arguments: [input],
						}),
						GoAST.createReturnStatement({
							values: [input],
						}),
					],
				}),
			}),
		],
	});
});
