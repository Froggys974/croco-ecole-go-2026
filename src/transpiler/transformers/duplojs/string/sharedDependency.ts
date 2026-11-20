import * as DCommon from "@duplojs/lang/common";
import { GoAST } from "@go";
import { createSharedDependency, goImports } from "@transformer";

export const stringIdentifiers = {
	fromNumber: GoAST.createIdentifier("StringFromNumber"),
	fromBoolean: GoAST.createIdentifier("StringFromBoolean"),
};

function text(value: string) {
	return GoAST.createStringLiteral({ value });
}

function returns(value: GoAST.Expression) {
	return GoAST.createReturnStatement({ values: [value] });
}

function binary(operator: GoAST.BinaryExpression["operator"], left: GoAST.Expression, right: GoAST.Expression) {
	return GoAST.createBinaryExpression({ operator, left, right });
}

function ifReturns(condition: GoAST.Expression, statements: readonly GoAST.Statement[]) {
	return GoAST.createIfStatement({
		condition,
		body: GoAST.createBlockStatement({ statements }),
	});
}

/**
 * Un nombre écrit comme JS l'écrit (`${value}`).
 * encoding/json suit l'algorithme ES6 de Number#toString pour les nombres finis ;
 * NaN, ±Infinity et -0 (que JSON écrit "-0") sont traités avant.
 *
 *   func StringFromNumber(value float64) string {
 *       if value != value { return "NaN" }
 *       if value-value != 0 { if value > 0 { return "Infinity" }; return "-Infinity" }
 *       if value == 0 { return "0" }
 *       var text []byte
 *       text, _ = json.Marshal(value)
 *       return string(text)
 *   }
 */
export const stringDependency = DCommon.memo(() => {
	const value = GoAST.createIdentifier("value");
	const encoded = GoAST.createIdentifier("text");
	const zero = GoAST.createFloatLiteral({ value: "0" });
	const string = GoAST.builtinTypeReferences.string;

	return createSharedDependency({
		imports: [goImports.encodingJson],
		init: [],
		declarations: [
			GoAST.createFunctionDeclaration({
				identifier: stringIdentifiers.fromNumber,
				generic: [],
				arguments: [GoAST.createFunctionArgument({ identifier: value, type: GoAST.builtinTypeReferences.float64 })],
				returnTypes: [string],
				body: GoAST.createBlockStatement({
					statements: [
						ifReturns(binary("!=", value, value), [returns(text("NaN"))]),
						ifReturns(binary("!=", binary("-", value, value), zero), [
							ifReturns(binary(">", value, zero), [returns(text("Infinity"))]),
							returns(text("-Infinity")),
						]),
						ifReturns(binary("==", value, zero), [returns(text("0"))]),
						GoAST.createVariableDeclarationZeroValue({
							identifier: encoded,
							typeReference: GoAST.createSliceType({ elementType: GoAST.builtinTypeReferences.byte }),
						}),
						GoAST.createAssignmentStatement({
							targets: DCommon.cast([encoded, GoAST.createIdentifier("_")]),
							values: DCommon.cast([
								GoAST.createCallExpression({
									callee: GoAST.createSelectorExpression({
										target: GoAST.createIdentifier("json"),
										identifier: GoAST.createIdentifier("Marshal"),
									}),
									arguments: [value],
								}),
							]),
						}),
						returns(GoAST.createConversionExpression({ typeReference: string, operand: encoded })),
					],
				}),
			}),
			GoAST.createFunctionDeclaration({
				identifier: stringIdentifiers.fromBoolean,
				generic: [],
				arguments: [GoAST.createFunctionArgument({ identifier: value, type: GoAST.builtinTypeReferences.bool })],
				returnTypes: [string],
				body: GoAST.createBlockStatement({
					statements: [
						ifReturns(value, [returns(text("true"))]),
						returns(text("false")),
					],
				}),
			}),
		],
	});
});
