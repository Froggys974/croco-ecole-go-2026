import * as DCommon from "@duplojs/lang/common";
import { GoAST } from "@go";
import { createSharedDependency, goImports } from "@transformer";

/**
 * Runtime Go des types Either de DuploJS (regroupés sous l'interface Either).
 *
 * - EitherFail / EitherOk    : structs vides sans payload ni champ message, JSON préformaté.
 * - EitherSuccess[T] / Error : stockent uniquement Value T (message fixe rendu par méthode et JSON).
 * - EitherLeft[T] / Right[T] : stockent Information et Value pour les messages libres.
 * - EitherIsRightAny / Left  : testent dynamiquement un Either reçu dans une variable any.
 */

const identifier = GoAST.createIdentifier;
const nullType = identifier("JSNull");
const undefinedType = identifier("JSUndefined");
const runtimeKeyPrefix = "@duplojs/lang/kind/@DuplojsLangEither/";

export const eitherIdentifiers = {
	interface: identifier("Either"),
	isRightMethod: identifier("IsRight"),
	getInformationMethod: identifier("GetInformation"),
	getValueMethod: identifier("GetValue"),
	successType: identifier("EitherSuccess"),
	successOf: identifier("EitherSuccessOf"),
	errorType: identifier("EitherError"),
	errorOf: identifier("EitherErrorOf"),
	failType: identifier("EitherFail"),
	failOf: identifier("EitherFailOf"),
	okType: identifier("EitherOk"),
	okOf: identifier("EitherOkOf"),
	leftType: identifier("EitherLeft"),
	leftOf: identifier("EitherLeftOf"),
	rightType: identifier("EitherRight"),
	rightOf: identifier("EitherRightOf"),
	isRightAny: identifier("EitherIsRightAny"),
	isLeftAny: identifier("EitherIsLeftAny"),
};

function returns(...values: GoAST.Expression[]) {
	return GoAST.createReturnStatement({ values });
}

function block(...statements: GoAST.Statement[]) {
	return GoAST.createBlockStatement({ statements });
}

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
				arguments: [
					GoAST.createFunctionArgument({
						identifier: valueArg,
						type: generic,
					}),
				],
				returnTypes: [structRef],
				body: block(returns(GoAST.createStructLiteral({
					typeReference: structRef,
					elements: [
						GoAST.createKeyedElement({
							key: valueIdent,
							value: valueArg,
						}),
					],
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
						GoAST.createKeyedElement({
							key: infoIdent,
							value: infoArg,
						}),
						GoAST.createKeyedElement({
							key: valueIdent,
							value: valueArg,
						}),
					],
				}))),
			}),
		],
	});
}

export const eitherInterfaceDependency = DCommon.memo(() => createSharedDependency({
	imports: [],
	init: [],
	declarations: [
		GoAST.createTypeDefinition({
			identifier: eitherIdentifiers.interface,
			type: GoAST.createInterfaceType({
				elements: [
					GoAST.createInterfaceMethod({
						identifier: eitherIdentifiers.isRightMethod,
						arguments: [],
						returnTypes: [GoAST.builtinTypeReferences.bool],
					}),
					GoAST.createInterfaceMethod({
						identifier: eitherIdentifiers.getInformationMethod,
						arguments: [],
						returnTypes: [GoAST.builtinTypeReferences.string],
					}),
					GoAST.createInterfaceMethod({
						identifier: eitherIdentifiers.getValueMethod,
						arguments: [],
						returnTypes: [GoAST.builtinTypeReferences.any],
					}),
				],
			}),
		}),
	],
}));

export const eitherFailDependency = DCommon.memo(() => createZeroByteEitherDependency({
	typeName: eitherIdentifiers.failType,
	factoryName: eitherIdentifiers.failOf,
	isRightValue: false,
	information: "fail",
	rawJson: `{"${runtimeKeyPrefix}left":null,"${runtimeKeyPrefix}information":"fail","${runtimeKeyPrefix}value":null,"${runtimeKeyPrefix}fail":null}`,
}));

export const eitherOkDependency = DCommon.memo(() => createZeroByteEitherDependency({
	typeName: eitherIdentifiers.okType,
	factoryName: eitherIdentifiers.okOf,
	isRightValue: true,
	information: "ok",
	rawJson: `{"${runtimeKeyPrefix}right":null,"${runtimeKeyPrefix}information":"ok","${runtimeKeyPrefix}value":null,"${runtimeKeyPrefix}ok":null}`,
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

function createAnySideCheckDependency(fnIdentifier: GoAST.Identifier, expectRight: boolean) {
	const input = identifier("input");
	const matched = identifier("matched");
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
