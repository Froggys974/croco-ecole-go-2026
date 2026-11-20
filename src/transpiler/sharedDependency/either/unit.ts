import * as DCommon from "@duplojs/lang/common";
import { GoAST } from "@go";
import { createSharedDependency, goImports } from "@transformer";
import {
	block,
	eitherIdentifiers,
	failRawJson,
	identifier,
	nullType,
	okRawJson,
	returns,
	runtimeKeyPrefix,
	undefinedType,
} from "./helpers";

function createZeroByteEitherDependency(params: {
	readonly typeName: GoAST.Identifier;
	readonly factoryName: GoAST.Identifier;
	readonly isRightValue: boolean;
	readonly information: string;
	readonly rawJson: string;
}) {
	const { typeName, factoryName, isRightValue, information, rawJson } = params;
	const ignored = identifier("_");

	return createSharedDependency({
		imports: [],
		init: [],
		declarations: [
			GoAST.createTypeDefinition({
				identifier: typeName,
				type: GoAST.createStructType({ fields: [] }),
			}),
			GoAST.createMethodDeclaration({
				identifier: eitherIdentifiers.isRightMethod,
				receiver: [ignored, typeName],
				generic: [],
				arguments: [],
				returnTypes: [GoAST.builtinTypeReferences.bool],
				body: block(returns(GoAST.createBooleanLiteral({ value: isRightValue }))),
			}),
			GoAST.createMethodDeclaration({
				identifier: eitherIdentifiers.getInformationMethod,
				receiver: [ignored, typeName],
				generic: [],
				arguments: [],
				returnTypes: [GoAST.builtinTypeReferences.string],
				body: block(returns(GoAST.createStringLiteral({ value: information }))),
			}),
			GoAST.createMethodDeclaration({
				identifier: eitherIdentifiers.getValueMethod,
				receiver: [ignored, typeName],
				generic: [],
				arguments: [],
				returnTypes: [GoAST.builtinTypeReferences.any],
				body: block(returns(GoAST.createStructLiteral({
					typeReference: undefinedType,
					elements: [],
				}))),
			}),
			GoAST.createMethodDeclaration({
				identifier: identifier("MarshalJSON"),
				receiver: [ignored, typeName],
				generic: [],
				arguments: [],
				returnTypes: [
					GoAST.createSliceType({ elementType: GoAST.builtinTypeReferences.byte }),
					GoAST.builtinTypeReferences.error,
				],
				body: block(returns(
					GoAST.createConversionExpression({
						typeReference: GoAST.createSliceType({ elementType: GoAST.builtinTypeReferences.byte }),
						operand: GoAST.createStringLiteral({ value: rawJson }),
					}),
					GoAST.createNilLiteral({}),
				)),
			}),
			GoAST.createFunctionDeclaration({
				identifier: factoryName,
				generic: [],
				arguments: [],
				returnTypes: [typeName],
				body: block(returns(GoAST.createStructLiteral({
					typeReference: typeName,
					elements: [],
				}))),
			}),
		],
	});
}

function createFixedInfoGenericEitherDependency(params: {
	readonly typeName: GoAST.Identifier;
	readonly jsonTypeName: GoAST.Identifier;
	readonly factoryName: GoAST.Identifier;
	readonly isRightValue: boolean;
	readonly information: string;
	readonly sideFieldName: string;
	readonly sideJsonKey: string;
	readonly markerFieldName: string;
	readonly markerJsonKey: string;
}) {
	const {
		typeName,
		jsonTypeName,
		factoryName,
		isRightValue,
		information,
		sideFieldName,
		sideJsonKey,
		markerFieldName,
		markerJsonKey,
	} = params;

	const generic = identifier("T");
	const receiver = identifier("s");
	const ignored = identifier("_");
	const valueIdent = identifier("Value");
	const valueArg = identifier("value");

	const typeParam = GoAST.createTypeParameter({
		identifier: generic,
		constraint: GoAST.builtinTypeReferences.any,
	});
	const structRef = GoAST.createGenericTypeReference({
		typeReference: typeName,
		typeArguments: DCommon.cast([generic]),
	});
	const jsonStructRef = GoAST.createGenericTypeReference({
		typeReference: jsonTypeName,
		typeArguments: DCommon.cast([generic]),
	});

	return createSharedDependency({
		imports: [goImports.encodingJson],
		init: [],
		declarations: [
			GoAST.createTypeDefinition({
				identifier: jsonTypeName,
				generic: [typeParam],
				type: GoAST.createStructType({
					fields: [
						GoAST.createStructField({
							identifier: identifier(sideFieldName),
							typeReference: nullType,
							tag: `json:"${runtimeKeyPrefix}${sideJsonKey}"`,
						}),
						GoAST.createStructField({
							identifier: identifier("Information"),
							typeReference: GoAST.builtinTypeReferences.string,
							tag: `json:"${runtimeKeyPrefix}information"`,
						}),
						GoAST.createStructField({
							identifier: valueIdent,
							typeReference: generic,
							tag: `json:"${runtimeKeyPrefix}value"`,
						}),
						GoAST.createStructField({
							identifier: identifier(markerFieldName),
							typeReference: nullType,
							tag: `json:"${runtimeKeyPrefix}${markerJsonKey}"`,
						}),
					],
				}),
			}),
			GoAST.createTypeDefinition({
				identifier: typeName,
				generic: [typeParam],
				type: GoAST.createStructType({
					fields: [
						GoAST.createStructField({ identifier: valueIdent, typeReference: generic }),
					],
				}),
			}),
			GoAST.createMethodDeclaration({
				identifier: eitherIdentifiers.isRightMethod,
				receiver: [ignored, structRef],
				generic: [],
				arguments: [],
				returnTypes: [GoAST.builtinTypeReferences.bool],
				body: block(returns(GoAST.createBooleanLiteral({ value: isRightValue }))),
			}),
			GoAST.createMethodDeclaration({
				identifier: eitherIdentifiers.getInformationMethod,
				receiver: [ignored, structRef],
				generic: [],
				arguments: [],
				returnTypes: [GoAST.builtinTypeReferences.string],
				body: block(returns(GoAST.createStringLiteral({ value: information }))),
			}),
			GoAST.createMethodDeclaration({
				identifier: eitherIdentifiers.getValueMethod,
				receiver: [receiver, structRef],
				generic: [],
				arguments: [],
				returnTypes: [GoAST.builtinTypeReferences.any],
				body: block(returns(GoAST.createSelectorExpression({
					target: receiver,
					identifier: valueIdent,
				}))),
			}),
			GoAST.createMethodDeclaration({
				identifier: identifier("MarshalJSON"),
				receiver: [receiver, structRef],
				generic: [],
				arguments: [],
				returnTypes: [
					GoAST.createSliceType({ elementType: GoAST.builtinTypeReferences.byte }),
					GoAST.builtinTypeReferences.error,
				],
				body: block(returns(GoAST.createCallExpression({
					callee: GoAST.createSelectorExpression({
						target: identifier("json"),
						identifier: identifier("Marshal"),
					}),
					arguments: [
						GoAST.createStructLiteral({
							typeReference: jsonStructRef,
							elements: [
								GoAST.createKeyedElement({
									key: identifier("Information"),
									value: GoAST.createStringLiteral({ value: information }),
								}),
								GoAST.createKeyedElement({
									key: valueIdent,
									value: GoAST.createSelectorExpression({
										target: receiver,
										identifier: valueIdent,
									}),
								}),
							],
						}),
					],
				}))),
			}),
			GoAST.createFunctionDeclaration({
				identifier: factoryName,
				generic: [typeParam],
				arguments: [GoAST.createFunctionArgument({ identifier: valueArg, type: generic })],
				returnTypes: [structRef],
				body: block(returns(GoAST.createStructLiteral({
					typeReference: structRef,
					elements: [GoAST.createKeyedElement({ key: valueIdent, value: valueArg })],
				}))),
			}),
		],
	});
}

function createDynamicInfoGenericEitherDependency(params: {
	readonly typeName: GoAST.Identifier;
	readonly jsonTypeName: GoAST.Identifier;
	readonly factoryName: GoAST.Identifier;
	readonly isRightValue: boolean;
	readonly sideFieldName: string;
	readonly sideJsonKey: string;
}) {
	const {
		typeName,
		jsonTypeName,
		factoryName,
		isRightValue,
		sideFieldName,
		sideJsonKey,
	} = params;

	const generic = identifier("T");
	const receiver = identifier("e");
	const ignored = identifier("_");
	const infoIdent = identifier("Information");
	const valueIdent = identifier("Value");
	const infoArg = identifier("information");
	const valueArg = identifier("value");

	const typeParam = GoAST.createTypeParameter({
		identifier: generic,
		constraint: GoAST.builtinTypeReferences.any,
	});
	const structRef = GoAST.createGenericTypeReference({
		typeReference: typeName,
		typeArguments: DCommon.cast([generic]),
	});
	const jsonStructRef = GoAST.createGenericTypeReference({
		typeReference: jsonTypeName,
		typeArguments: DCommon.cast([generic]),
	});

	return createSharedDependency({
		imports: [goImports.encodingJson],
		init: [],
		declarations: [
			GoAST.createTypeDefinition({
				identifier: jsonTypeName,
				generic: [typeParam],
				type: GoAST.createStructType({
					fields: [
						GoAST.createStructField({
							identifier: identifier(sideFieldName),
							typeReference: nullType,
							tag: `json:"${runtimeKeyPrefix}${sideJsonKey}"`,
						}),
						GoAST.createStructField({
							identifier: infoIdent,
							typeReference: GoAST.builtinTypeReferences.string,
							tag: `json:"${runtimeKeyPrefix}information"`,
						}),
						GoAST.createStructField({
							identifier: valueIdent,
							typeReference: generic,
							tag: `json:"${runtimeKeyPrefix}value"`,
						}),
					],
				}),
			}),
			GoAST.createTypeDefinition({
				identifier: typeName,
				generic: [typeParam],
				type: GoAST.createStructType({
					fields: [
						GoAST.createStructField({
							identifier: infoIdent,
							typeReference: GoAST.builtinTypeReferences.string,
						}),
						GoAST.createStructField({
							identifier: valueIdent,
							typeReference: generic,
						}),
					],
				}),
			}),
			GoAST.createMethodDeclaration({
				identifier: eitherIdentifiers.isRightMethod,
				receiver: [ignored, structRef],
				generic: [],
				arguments: [],
				returnTypes: [GoAST.builtinTypeReferences.bool],
				body: block(returns(GoAST.createBooleanLiteral({ value: isRightValue }))),
			}),
			GoAST.createMethodDeclaration({
				identifier: eitherIdentifiers.getInformationMethod,
				receiver: [receiver, structRef],
				generic: [],
				arguments: [],
				returnTypes: [GoAST.builtinTypeReferences.string],
				body: block(returns(GoAST.createSelectorExpression({
					target: receiver,
					identifier: infoIdent,
				}))),
			}),
			GoAST.createMethodDeclaration({
				identifier: eitherIdentifiers.getValueMethod,
				receiver: [receiver, structRef],
				generic: [],
				arguments: [],
				returnTypes: [GoAST.builtinTypeReferences.any],
				body: block(returns(GoAST.createSelectorExpression({
					target: receiver,
					identifier: valueIdent,
				}))),
			}),
			GoAST.createMethodDeclaration({
				identifier: identifier("MarshalJSON"),
				receiver: [receiver, structRef],
				generic: [],
				arguments: [],
				returnTypes: [
					GoAST.createSliceType({ elementType: GoAST.builtinTypeReferences.byte }),
					GoAST.builtinTypeReferences.error,
				],
				body: block(returns(GoAST.createCallExpression({
					callee: GoAST.createSelectorExpression({
						target: identifier("json"),
						identifier: identifier("Marshal"),
					}),
					arguments: [
						GoAST.createStructLiteral({
							typeReference: jsonStructRef,
							elements: [
								GoAST.createKeyedElement({
									key: infoIdent,
									value: GoAST.createSelectorExpression({
										target: receiver,
										identifier: infoIdent,
									}),
								}),
								GoAST.createKeyedElement({
									key: valueIdent,
									value: GoAST.createSelectorExpression({
										target: receiver,
										identifier: valueIdent,
									}),
								}),
							],
						}),
					],
				}))),
			}),
			GoAST.createFunctionDeclaration({
				identifier: factoryName,
				generic: [typeParam],
				arguments: [
					GoAST.createFunctionArgument({
						identifier: infoArg,
						type: GoAST.builtinTypeReferences.string,
					}),
					GoAST.createFunctionArgument({
						identifier: valueArg,
						type: generic,
					}),
				],
				returnTypes: [structRef],
				body: block(returns(GoAST.createStructLiteral({
					typeReference: structRef,
					elements: [
						GoAST.createKeyedElement({ key: infoIdent, value: infoArg }),
						GoAST.createKeyedElement({ key: valueIdent, value: valueArg }),
					],
				}))),
			}),
		],
	});
}

export const eitherFailDependency = DCommon.memo(() => createZeroByteEitherDependency({
	typeName: eitherIdentifiers.failType,
	factoryName: eitherIdentifiers.failOf,
	isRightValue: false,
	information: "fail",
	rawJson: failRawJson,
}));

export const eitherOkDependency = DCommon.memo(() => createZeroByteEitherDependency({
	typeName: eitherIdentifiers.okType,
	factoryName: eitherIdentifiers.okOf,
	isRightValue: true,
	information: "ok",
	rawJson: okRawJson,
}));

export const eitherSuccessDependency = DCommon.memo(() => createFixedInfoGenericEitherDependency({
	typeName: eitherIdentifiers.successType,
	jsonTypeName: identifier("eitherSuccessJSON"),
	factoryName: eitherIdentifiers.successOf,
	isRightValue: true,
	information: "success",
	sideFieldName: "Right",
	sideJsonKey: "right",
	markerFieldName: "Success",
	markerJsonKey: "success",
}));

export const eitherErrorDependency = DCommon.memo(() => createFixedInfoGenericEitherDependency({
	typeName: eitherIdentifiers.errorType,
	jsonTypeName: identifier("eitherErrorJSON"),
	factoryName: eitherIdentifiers.errorOf,
	isRightValue: false,
	information: "error",
	sideFieldName: "Left",
	sideJsonKey: "left",
	markerFieldName: "Error",
	markerJsonKey: "error",
}));

export const eitherLeftDependency = DCommon.memo(() => createDynamicInfoGenericEitherDependency({
	typeName: eitherIdentifiers.leftType,
	jsonTypeName: identifier("eitherLeftJSON"),
	factoryName: eitherIdentifiers.leftOf,
	isRightValue: false,
	sideFieldName: "Left",
	sideJsonKey: "left",
}));

export const eitherRightDependency = DCommon.memo(() => createDynamicInfoGenericEitherDependency({
	typeName: eitherIdentifiers.rightType,
	jsonTypeName: identifier("eitherRightJSON"),
	factoryName: eitherIdentifiers.rightOf,
	isRightValue: true,
	sideFieldName: "Right",
	sideJsonKey: "right",
}));
