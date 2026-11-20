import * as DCommon from "@duplojs/lang/common";
import { GoAST } from "@go";
import { createSharedDependency } from "@transformer";
import { block, eitherIdentifiers, returns } from "./helpers";

function createAnySideCheckDependency(fnIdentifier: GoAST.Identifier, expectRight: boolean) {
	const input = GoAST.createIdentifier("input");
	const matched = GoAST.createIdentifier("matched");
	const checkExpr: GoAST.Expression = GoAST.createCallExpression({
		callee: GoAST.createSelectorExpression({
			target: matched,
			identifier: eitherIdentifiers.isRightMethod,
		}),
		arguments: [],
	});

	return createSharedDependency({
		imports: [],
		init: [],
		declarations: [
			GoAST.createFunctionDeclaration({
				identifier: fnIdentifier,
				generic: [],
				arguments: [
					GoAST.createFunctionArgument({
						identifier: input,
						type: GoAST.builtinTypeReferences.any,
					}),
				],
				returnTypes: [GoAST.builtinTypeReferences.bool],
				body: block(
					GoAST.createTypeSwitchStatementWithoutDefault({
						expression: input,
						identifier: matched,
						cases: [
							GoAST.createTypeSwitchCase({
								types: DCommon.cast([eitherIdentifiers.interface]),
								statements: [
									returns(
										expectRight
											? checkExpr
											: GoAST.createUnaryExpression({
												operator: "!",
												operand: checkExpr,
											}),
									),
								],
							}),
						],
					}),
					returns(GoAST.createBooleanLiteral({ value: false })),
				),
			}),
		],
	});
}

export const eitherIsRightAnyDependency = DCommon.memo(
	() => createAnySideCheckDependency(eitherIdentifiers.isRightAny, true),
);

export const eitherIsLeftAnyDependency = DCommon.memo(
	() => createAnySideCheckDependency(eitherIdentifiers.isLeftAny, false),
);
