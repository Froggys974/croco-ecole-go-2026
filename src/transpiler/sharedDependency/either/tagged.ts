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
	okRawJson,
	returns,
	undefinedType,
} from "./helpers";

export const eitherTaggedDependency = DCommon.memo(() => {
	const rightGeneric = identifier("R");
	const leftGeneric = identifier("L");
	const receiver = identifier("t");
	const sourceArg = identifier("s");
	const infoIdent = identifier("Information");
	const rightValIdent = identifier("RightValue");
	const leftValIdent = identifier("LeftValue");
	const kindIdent = identifier("Kind");
	const valueIdent = identifier("Value");

	const rightParam = GoAST.createTypeParameter({
		identifier: rightGeneric,
		constraint: GoAST.builtinTypeReferences.any,
	});
	const leftParam = GoAST.createTypeParameter({
		identifier: leftGeneric,
		constraint: GoAST.builtinTypeReferences.any,
	});
	const taggedRef = GoAST.createGenericTypeReference({
		typeReference: eitherIdentifiers.eitherTaggedType,
		typeArguments: DCommon.cast([rightGeneric, leftGeneric]),
	});

	const successJsonName = identifier("taggedSuccessJSON");
	const errorJsonName = identifier("taggedErrorJSON");
	const rightJsonName = identifier("taggedRightJSON");
	const leftJsonName = identifier("taggedLeftJSON");

	const kindExpr = GoAST.createSelectorExpression({ target: receiver, identifier: kindIdent });
	const infoExpr = GoAST.createSelectorExpression({ target: receiver, identifier: infoIdent });
	const rightValExpr = GoAST.createSelectorExpression({ target: receiver, identifier: rightValIdent });
	const leftValExpr = GoAST.createSelectorExpression({ target: receiver, identifier: leftValIdent });

	const kindEq = (code: number) => GoAST.createBinaryExpression({
		operator: "==",
		left: kindExpr,
		right: GoAST.createIntegerLiteral({ value: BigInt(code) }),
	});
	const orExpr = (left: GoAST.Expression, right: GoAST.Expression) => GoAST.createBinaryExpression({
		operator: "||",
		left,
		right,
	});
	const kindLiteral = (code: number) => GoAST.createKeyedElement({
		key: kindIdent,
		value: GoAST.createIntegerLiteral({ value: BigInt(code) }),
	});
	const infoArgDecl = GoAST.createFunctionArgument({
		identifier: identifier("info"),
		type: GoAST.builtinTypeReferences.string,
	});
	const marshalEnvelope = (
		typeName: GoAST.Identifier,
		typeArg: GoAST.Type | GoAST.TypeReference,
		elements: readonly GoAST.KeyedElement<GoAST.Identifier>[],
	) => returns(jsonMarshalCall(GoAST.createStructLiteral({
		typeReference: GoAST.createGenericTypeReference({
			typeReference: typeName,
			typeArguments: DCommon.cast([typeArg]),
		}),
		elements,
	})));

	// 0=Fail, 1=Ok, 2=Success, 3=Error, 4=Right, 5=Left, 6=LeftEmpty
	return createSharedDependency({
		imports: [goImports.encodingJson],
		init: [],
		declarations: [
			createJsonEnvelopeType({
				typeName: successJsonName,
				generic: rightGeneric,
				typeParam: rightParam,
				sideField: "Right",
				sideKey: "right",
				markerField: "Success",
				markerKey: "success",
			}),
			createJsonEnvelopeType({
				typeName: errorJsonName,
				generic: leftGeneric,
				typeParam: leftParam,
				sideField: "Left",
				sideKey: "left",
				markerField: "Error",
				markerKey: "error",
			}),
			createJsonEnvelopeType({
				typeName: rightJsonName,
				generic: rightGeneric,
				typeParam: rightParam,
				sideField: "Right",
				sideKey: "right",
			}),
			createJsonEnvelopeType({
				typeName: leftJsonName,
				generic: leftGeneric,
				typeParam: leftParam,
				sideField: "Left",
				sideKey: "left",
			}),
			GoAST.createTypeDefinition({
				identifier: eitherIdentifiers.eitherTaggedType,
				generic: [rightParam, leftParam],
				type: GoAST.createStructType({
					fields: [
						GoAST.createStructField({
							identifier: infoIdent,
							typeReference: GoAST.builtinTypeReferences.string,
						}),
						GoAST.createStructField({
							identifier: rightValIdent,
							typeReference: rightGeneric,
						}),
						GoAST.createStructField({
							identifier: leftValIdent,
							typeReference: leftGeneric,
						}),
						GoAST.createStructField({
							identifier: kindIdent,
							typeReference: GoAST.builtinTypeReferences.uint8,
						}),
					],
				}),
			}),
			GoAST.createMethodDeclaration({
				identifier: eitherIdentifiers.isRightMethod,
				receiver: [receiver, taggedRef],
				generic: [],
				arguments: [],
				returnTypes: [GoAST.builtinTypeReferences.bool],
				body: block(returns(orExpr(orExpr(kindEq(1), kindEq(2)), kindEq(4)))),
			}),
			GoAST.createMethodDeclaration({
				identifier: eitherIdentifiers.getInformationMethod,
				receiver: [receiver, taggedRef],
				generic: [],
				arguments: [],
				returnTypes: [GoAST.builtinTypeReferences.string],
				body: block(
					GoAST.createIfStatement({
						condition: kindEq(0),
						body: block(returns(GoAST.createStringLiteral({ value: "fail" }))),
					}),
					GoAST.createIfStatement({
						condition: kindEq(1),
						body: block(returns(GoAST.createStringLiteral({ value: "ok" }))),
					}),
					GoAST.createIfStatement({
						condition: kindEq(2),
						body: block(returns(GoAST.createStringLiteral({ value: "success" }))),
					}),
					GoAST.createIfStatement({
						condition: kindEq(3),
						body: block(returns(GoAST.createStringLiteral({ value: "error" }))),
					}),
					returns(infoExpr),
				),
			}),
			GoAST.createMethodDeclaration({
				identifier: eitherIdentifiers.getValueMethod,
				receiver: [receiver, taggedRef],
				generic: [],
				arguments: [],
				returnTypes: [GoAST.builtinTypeReferences.any],
				body: block(
					GoAST.createIfStatement({
						condition: orExpr(kindEq(2), kindEq(4)),
						body: block(returns(rightValExpr)),
					}),
					GoAST.createIfStatement({
						condition: orExpr(kindEq(3), kindEq(5)),
						body: block(returns(leftValExpr)),
					}),
					returns(GoAST.createStructLiteral({ typeReference: undefinedType, elements: [] })),
				),
			}),
			GoAST.createMethodDeclaration({
				identifier: identifier("MarshalJSON"),
				receiver: [receiver, taggedRef],
				generic: [],
				arguments: [],
				returnTypes: [
					GoAST.createSliceType({ elementType: GoAST.builtinTypeReferences.byte }),
					GoAST.builtinTypeReferences.error,
				],
				body: block(
					GoAST.createIfStatement({
						condition: kindEq(0),
						body: block(returns(byteSliceLiteral(failRawJson), GoAST.createNilLiteral({}))),
					}),
					GoAST.createIfStatement({
						condition: kindEq(1),
						body: block(returns(byteSliceLiteral(okRawJson), GoAST.createNilLiteral({}))),
					}),
					GoAST.createIfStatement({
						condition: kindEq(2),
						body: block(marshalEnvelope(successJsonName, rightGeneric, [
							GoAST.createKeyedElement({
								key: infoIdent,
								value: GoAST.createStringLiteral({ value: "success" }),
							}),
							GoAST.createKeyedElement({ key: valueIdent, value: rightValExpr }),
						])),
					}),
					GoAST.createIfStatement({
						condition: kindEq(3),
						body: block(marshalEnvelope(errorJsonName, leftGeneric, [
							GoAST.createKeyedElement({
								key: infoIdent,
								value: GoAST.createStringLiteral({ value: "error" }),
							}),
							GoAST.createKeyedElement({ key: valueIdent, value: leftValExpr }),
						])),
					}),
					GoAST.createIfStatement({
						condition: kindEq(4),
						body: block(marshalEnvelope(rightJsonName, rightGeneric, [
							GoAST.createKeyedElement({ key: infoIdent, value: infoExpr }),
							GoAST.createKeyedElement({ key: valueIdent, value: rightValExpr }),
						])),
					}),
					GoAST.createIfStatement({
						condition: kindEq(6),
						body: block(marshalEnvelope(leftJsonName, undefinedType, [
							GoAST.createKeyedElement({ key: infoIdent, value: infoExpr }),
						])),
					}),
					marshalEnvelope(leftJsonName, leftGeneric, [
						GoAST.createKeyedElement({ key: infoIdent, value: infoExpr }),
						GoAST.createKeyedElement({ key: valueIdent, value: leftValExpr }),
					]),
				),
			}),
			GoAST.createFunctionDeclaration({
				identifier: eitherIdentifiers.eitherTaggedFail,
				generic: [rightParam, leftParam],
				arguments: [],
				returnTypes: [taggedRef],
				body: block(returns(GoAST.createStructLiteral({ typeReference: taggedRef, elements: [] }))),
			}),
			GoAST.createFunctionDeclaration({
				identifier: eitherIdentifiers.eitherTaggedOk,
				generic: [rightParam, leftParam],
				arguments: [],
				returnTypes: [taggedRef],
				body: block(returns(GoAST.createStructLiteral({
					typeReference: taggedRef,
					elements: [kindLiteral(1)],
				}))),
			}),
			GoAST.createFunctionDeclaration({
				identifier: eitherIdentifiers.eitherTaggedSuccess,
				generic: [rightParam, leftParam],
				arguments: [GoAST.createFunctionArgument({ identifier: sourceArg, type: rightGeneric })],
				returnTypes: [taggedRef],
				body: block(returns(GoAST.createStructLiteral({
					typeReference: taggedRef,
					elements: [
						kindLiteral(2),
						GoAST.createKeyedElement({ key: rightValIdent, value: sourceArg }),
					],
				}))),
			}),
			GoAST.createFunctionDeclaration({
				identifier: eitherIdentifiers.eitherTaggedError,
				generic: [rightParam, leftParam],
				arguments: [GoAST.createFunctionArgument({ identifier: sourceArg, type: leftGeneric })],
				returnTypes: [taggedRef],
				body: block(returns(GoAST.createStructLiteral({
					typeReference: taggedRef,
					elements: [
						kindLiteral(3),
						GoAST.createKeyedElement({ key: leftValIdent, value: sourceArg }),
					],
				}))),
			}),
			GoAST.createFunctionDeclaration({
				identifier: eitherIdentifiers.eitherTaggedRight,
				generic: [rightParam, leftParam],
				arguments: [
					infoArgDecl,
					GoAST.createFunctionArgument({ identifier: sourceArg, type: rightGeneric }),
				],
				returnTypes: [taggedRef],
				body: block(returns(GoAST.createStructLiteral({
					typeReference: taggedRef,
					elements: [
						kindLiteral(4),
						GoAST.createKeyedElement({ key: infoIdent, value: identifier("info") }),
						GoAST.createKeyedElement({ key: rightValIdent, value: sourceArg }),
					],
				}))),
			}),
			GoAST.createFunctionDeclaration({
				identifier: eitherIdentifiers.eitherTaggedLeft,
				generic: [rightParam, leftParam],
				arguments: [
					infoArgDecl,
					GoAST.createFunctionArgument({ identifier: sourceArg, type: leftGeneric }),
				],
				returnTypes: [taggedRef],
				body: block(returns(GoAST.createStructLiteral({
					typeReference: taggedRef,
					elements: [
						kindLiteral(5),
						GoAST.createKeyedElement({ key: infoIdent, value: identifier("info") }),
						GoAST.createKeyedElement({ key: leftValIdent, value: sourceArg }),
					],
				}))),
			}),
			GoAST.createFunctionDeclaration({
				identifier: eitherIdentifiers.eitherTaggedLeftEmpty,
				generic: [rightParam, leftParam],
				arguments: [infoArgDecl],
				returnTypes: [taggedRef],
				body: block(returns(GoAST.createStructLiteral({
					typeReference: taggedRef,
					elements: [
						kindLiteral(6),
						GoAST.createKeyedElement({ key: infoIdent, value: identifier("info") }),
					],
				}))),
			}),
		],
	});
});
