import * as DCommon from "@duplojs/lang/common";
import { GoAST } from "@go";
import { createSharedDependency, goImports } from "@transformer";

export const commonIdentifiers = {
	print: GoAST.createIdentifier("CommonPrint"),
};

/**
 * CommonPrint[T] affiche la valeur comme DCommon.print en JS :
 * - string      : texte brut (fmt.Println)
 * - JSUndefined : "undefined"
 * - autres      : encodage JSON (json.Marshal)
 */
export const commonPrintDependency = DCommon.memo(() => {
	const typeParameter = GoAST.createTypeParameter({
		identifier: GoAST.createIdentifier("T"),
		constraint: GoAST.builtinTypeReferences.any,
	});

	const value = GoAST.createIdentifier("value");
	const switched = GoAST.createIdentifier("v");
	const bytes = GoAST.createIdentifier("b");
	const err = GoAST.createIdentifier("err");

	return createSharedDependency({
		imports: [goImports.encodingJson, goImports.fmt],
		init: [],
		declarations: [
			GoAST.createFunctionDeclaration({
				identifier: commonIdentifiers.print,
				generic: [typeParameter],
				arguments: [
					GoAST.createFunctionArgument({
						identifier: value,
						type: typeParameter.identifier,
					}),
				],
				returnTypes: [typeParameter.identifier],
				body: GoAST.createBlockStatement({
					statements: [
						GoAST.createTypeSwitchStatementWithDefault({
							expression: GoAST.createConversionExpression({
								typeReference: GoAST.builtinTypeReferences.any,
								operand: value,
							}),
							identifier: switched,
							casesBeforeDefault: [
								GoAST.createTypeSwitchCase({
									types: DCommon.cast([GoAST.builtinTypeReferences.string]),
									statements: [
										GoAST.createCallExpression({
											callee: GoAST.createSelectorExpression({
												target: GoAST.createIdentifier("fmt"),
												identifier: GoAST.createIdentifier("Println"),
											}),
											arguments: [switched],
										}),
									],
								}),
								GoAST.createTypeSwitchCase({
									types: DCommon.cast([GoAST.createIdentifier("JSUndefined")]),
									statements: [
										GoAST.createCallExpression({
											callee: GoAST.createSelectorExpression({
												target: GoAST.createIdentifier("fmt"),
												identifier: GoAST.createIdentifier("Println"),
											}),
											arguments: [GoAST.createStringLiteral({ value: "undefined" })],
										}),
									],
								}),
							],
							defaultCase: GoAST.createDefaultCase({
								statements: [
									GoAST.createVariableDeclarationZeroValue({
										identifier: bytes,
										typeReference: GoAST.createSliceType({
											elementType: GoAST.builtinTypeReferences.byte,
										}),
									}),
									GoAST.createVariableDeclarationZeroValue({
										identifier: err,
										typeReference: GoAST.builtinTypeReferences.error,
									}),
									GoAST.createAssignmentStatement({
										targets: DCommon.cast([bytes, err]),
										values: DCommon.cast([
											GoAST.createCallExpression({
												callee: GoAST.createSelectorExpression({
													target: GoAST.createIdentifier("json"),
													identifier: GoAST.createIdentifier("Marshal"),
												}),
												arguments: [switched],
											}),
										]),
									}),
									GoAST.createIfStatement({
										condition: GoAST.createBinaryExpression({
											operator: "==",
											left: err,
											right: GoAST.createNilLiteral({}),
										}),
										body: GoAST.createBlockStatement({
											statements: [
												GoAST.createCallExpression({
													callee: GoAST.createSelectorExpression({
														target: GoAST.createIdentifier("fmt"),
														identifier: GoAST.createIdentifier("Println"),
													}),
													arguments: [
														GoAST.createConversionExpression({
															typeReference: GoAST.builtinTypeReferences.string,
															operand: bytes,
														}),
													],
												}),
											],
										}),
									}),
								],
							}),
							casesAfterDefault: [],
						}),
						GoAST.createReturnStatement({
							values: [value],
						}),
					],
				}),
			}),
		],
	});
});
