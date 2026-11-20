import * as DCommon from "@duplojs/lang/common";
import { GoAST } from "@go";
import { createSharedDependency, goImports } from "@transformer";
import {
	block,
	byteSliceLiteral,
	createJsonEnvelopeType,
	eitherIdentifiers,
	failRawJson,
	identifier,
	jsonMarshalCall,
	returns,
	undefinedType,
} from "./helpers";

export const eitherCompactDependency = DCommon.memo(() => {
	const generic = identifier("T");
	const receiver = identifier("r");
	const valueIdent = identifier("Value");
	const rightIdent = identifier("Right");
	const sourceArg = identifier("s");
	const jsonTypeName = identifier("eitherCompactSuccessJSON");

	const typeParam = GoAST.createTypeParameter({
		identifier: generic,
		constraint: GoAST.builtinTypeReferences.any,
	});
	const compactRef = GoAST.createGenericTypeReference({
		typeReference: eitherIdentifiers.eitherCompactType,
		typeArguments: DCommon.cast([generic]),
	});
	const jsonRef = GoAST.createGenericTypeReference({
		typeReference: jsonTypeName,
		typeArguments: DCommon.cast([generic]),
	});
	const isRightExpr = GoAST.createSelectorExpression({ target: receiver, identifier: rightIdent });
	const valueExpr = GoAST.createSelectorExpression({ target: receiver, identifier: valueIdent });

	return createSharedDependency({
		imports: [goImports.encodingJson],
		init: [],
		declarations: [
			createJsonEnvelopeType({
				typeName: jsonTypeName,
				generic,
				typeParam,
				sideField: "Right",
				sideKey: "right",
				markerField: "Success",
				markerKey: "success",
			}),
			GoAST.createTypeDefinition({
				identifier: eitherIdentifiers.eitherCompactType,
				generic: [typeParam],
				type: GoAST.createStructType({
					fields: [
						GoAST.createStructField({ identifier: valueIdent, typeReference: generic }),
						GoAST.createStructField({ identifier: rightIdent, typeReference: GoAST.builtinTypeReferences.bool }),
					],
				}),
			}),
			GoAST.createMethodDeclaration({
				identifier: eitherIdentifiers.isRightMethod,
				receiver: [receiver, compactRef],
				generic: [],
				arguments: [],
				returnTypes: [GoAST.builtinTypeReferences.bool],
				body: block(returns(isRightExpr)),
			}),
			GoAST.createMethodDeclaration({
				identifier: eitherIdentifiers.getInformationMethod,
				receiver: [receiver, compactRef],
				generic: [],
				arguments: [],
				returnTypes: [GoAST.builtinTypeReferences.string],
				body: block(
					GoAST.createIfStatement({
						condition: isRightExpr,
						body: block(returns(GoAST.createStringLiteral({ value: "success" }))),
					}),
					returns(GoAST.createStringLiteral({ value: "fail" })),
				),
			}),
			GoAST.createMethodDeclaration({
				identifier: eitherIdentifiers.getValueMethod,
				receiver: [receiver, compactRef],
				generic: [],
				arguments: [],
				returnTypes: [GoAST.builtinTypeReferences.any],
				body: block(
					GoAST.createIfStatement({
						condition: isRightExpr,
						body: block(returns(valueExpr)),
					}),
					returns(GoAST.createStructLiteral({ typeReference: undefinedType, elements: [] })),
				),
			}),
			GoAST.createMethodDeclaration({
				identifier: identifier("MarshalJSON"),
				receiver: [receiver, compactRef],
				generic: [],
				arguments: [],
				returnTypes: [
					GoAST.createSliceType({ elementType: GoAST.builtinTypeReferences.byte }),
					GoAST.builtinTypeReferences.error,
				],
				body: block(
					GoAST.createIfStatement({
						condition: isRightExpr,
						body: block(returns(jsonMarshalCall(GoAST.createStructLiteral({
							typeReference: jsonRef,
							elements: [
								GoAST.createKeyedElement({
									key: identifier("Information"),
									value: GoAST.createStringLiteral({ value: "success" }),
								}),
								GoAST.createKeyedElement({ key: valueIdent, value: valueExpr }),
							],
						})))),
					}),
					returns(byteSliceLiteral(failRawJson), GoAST.createNilLiteral({})),
				),
			}),
			GoAST.createFunctionDeclaration({
				identifier: eitherIdentifiers.eitherCompactFail,
				generic: [typeParam],
				arguments: [],
				returnTypes: [compactRef],
				body: block(returns(GoAST.createStructLiteral({
					typeReference: compactRef,
					elements: [],
				}))),
			}),
			GoAST.createFunctionDeclaration({
				identifier: eitherIdentifiers.eitherCompactSuccess,
				generic: [typeParam],
				arguments: [GoAST.createFunctionArgument({ identifier: sourceArg, type: generic })],
				returnTypes: [compactRef],
				body: block(returns(GoAST.createStructLiteral({
					typeReference: compactRef,
					elements: [
						GoAST.createKeyedElement({ key: valueIdent, value: sourceArg }),
						GoAST.createKeyedElement({
							key: rightIdent,
							value: GoAST.createBooleanLiteral({ value: true }),
						}),
					],
				}))),
			}),
		],
	});
});
