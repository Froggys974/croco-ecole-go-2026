import * as DCommon from "@duplojs/lang/common";
import { GoAST } from "@go";
import { createSharedDependency, goImports } from "@transformer";
import {
	block,
	byteSliceLiteral,
	eitherIdentifiers,
	failRawJson,
	identifier,
	jsonMarshalCall,
	returns,
} from "./helpers";

export const eitherOrFailDependency = DCommon.memo(() => {
	const generic = identifier("T");
	const receiver = identifier("r");
	const valueIdent = identifier("Value");
	const failedIdent = identifier("Failed");
	const sourceArg = identifier("v");

	const typeParam = GoAST.createTypeParameter({
		identifier: generic,
		constraint: GoAST.builtinTypeReferences.any,
	});
	const orFailRef = GoAST.createGenericTypeReference({
		typeReference: eitherIdentifiers.eitherOrFailType,
		typeArguments: DCommon.cast([generic]),
	});
	const failedExpr = GoAST.createSelectorExpression({ target: receiver, identifier: failedIdent });
	const valueExpr = GoAST.createSelectorExpression({ target: receiver, identifier: valueIdent });

	return createSharedDependency({
		imports: [goImports.encodingJson],
		init: [],
		declarations: [
			GoAST.createTypeDefinition({
				identifier: eitherIdentifiers.eitherOrFailType,
				generic: [typeParam],
				type: GoAST.createStructType({
					fields: [
						GoAST.createStructField({ identifier: valueIdent, typeReference: generic }),
						GoAST.createStructField({
							identifier: failedIdent,
							typeReference: GoAST.builtinTypeReferences.bool,
						}),
					],
				}),
			}),
			GoAST.createMethodDeclaration({
				identifier: eitherIdentifiers.isLeftMethod,
				receiver: [receiver, orFailRef],
				generic: [],
				arguments: [],
				returnTypes: [GoAST.builtinTypeReferences.bool],
				body: block(returns(failedExpr)),
			}),
			GoAST.createMethodDeclaration({
				identifier: eitherIdentifiers.isRightMethod,
				receiver: [identifier("_"), orFailRef],
				generic: [],
				arguments: [],
				returnTypes: [GoAST.builtinTypeReferences.bool],
				body: block(returns(GoAST.createBooleanLiteral({ value: false }))),
			}),
			GoAST.createMethodDeclaration({
				identifier: identifier("MarshalJSON"),
				receiver: [receiver, orFailRef],
				generic: [],
				arguments: [],
				returnTypes: [
					GoAST.createSliceType({ elementType: GoAST.builtinTypeReferences.byte }),
					GoAST.builtinTypeReferences.error,
				],
				body: block(
					GoAST.createIfStatement({
						condition: failedExpr,
						body: block(returns(byteSliceLiteral(failRawJson), GoAST.createNilLiteral({}))),
					}),
					returns(jsonMarshalCall(valueExpr)),
				),
			}),
			GoAST.createFunctionDeclaration({
				identifier: eitherIdentifiers.eitherOrFailValue,
				generic: [typeParam],
				arguments: [GoAST.createFunctionArgument({ identifier: sourceArg, type: generic })],
				returnTypes: [orFailRef],
				body: block(returns(GoAST.createStructLiteral({
					typeReference: orFailRef,
					elements: [GoAST.createKeyedElement({ key: valueIdent, value: sourceArg })],
				}))),
			}),
			GoAST.createFunctionDeclaration({
				identifier: eitherIdentifiers.eitherOrFailLeft,
				generic: [typeParam],
				arguments: [],
				returnTypes: [orFailRef],
				body: block(returns(GoAST.createStructLiteral({
					typeReference: orFailRef,
					elements: [
						GoAST.createKeyedElement({
							key: failedIdent,
							value: GoAST.createBooleanLiteral({ value: true }),
						}),
					],
				}))),
			}),
		],
	});
});
