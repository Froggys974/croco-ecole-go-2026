import { GoAST } from "@go";

export const identifier = GoAST.createIdentifier;
export const nullType = identifier("JSNull");
export const undefinedType = identifier("JSUndefined");
export const runtimeKeyPrefix = "@duplojs/lang/kind/@DuplojsLangEither/";
export const failRawJson = `{"${runtimeKeyPrefix}left":null,"${runtimeKeyPrefix}information":"fail","${runtimeKeyPrefix}value":null,"${runtimeKeyPrefix}fail":null}`;
export const okRawJson = `{"${runtimeKeyPrefix}right":null,"${runtimeKeyPrefix}information":"ok","${runtimeKeyPrefix}value":null,"${runtimeKeyPrefix}ok":null}`;

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
	eitherCompactType: identifier("EitherCompact"),
	eitherCompactSuccess: identifier("EitherCompactSuccess"),
	eitherCompactFail: identifier("EitherCompactFail"),
	eitherOrFailType: identifier("EitherOrFail"),
	eitherOrFailValue: identifier("EitherOrFailValue"),
	eitherOrFailLeft: identifier("EitherOrFailLeft"),
	isLeftMethod: identifier("IsLeft"),
	eitherTaggedType: identifier("EitherTagged"),
	eitherTaggedFail: identifier("EitherTaggedFail"),
	eitherTaggedOk: identifier("EitherTaggedOk"),
	eitherTaggedSuccess: identifier("EitherTaggedSuccess"),
	eitherTaggedError: identifier("EitherTaggedError"),
	eitherTaggedRight: identifier("EitherTaggedRight"),
	eitherTaggedLeft: identifier("EitherTaggedLeft"),
	eitherTaggedLeftEmpty: identifier("EitherTaggedLeftEmpty"),
	isRightAny: identifier("EitherIsRightAny"),
	isLeftAny: identifier("EitherIsLeftAny"),
};

export function returns(...values: GoAST.Expression[]) {
	return GoAST.createReturnStatement({ values });
}

export function block(...statements: GoAST.Statement[]) {
	return GoAST.createBlockStatement({ statements });
}

export function byteSliceLiteral(raw: string) {
	return GoAST.createConversionExpression({
		typeReference: GoAST.createSliceType({ elementType: GoAST.builtinTypeReferences.byte }),
		operand: GoAST.createStringLiteral({ value: raw }),
	});
}

export function jsonMarshalCall(argument: GoAST.Expression) {
	return GoAST.createCallExpression({
		callee: GoAST.createSelectorExpression({
			target: identifier("json"),
			identifier: identifier("Marshal"),
		}),
		arguments: [argument],
	});
}

export function createJsonEnvelopeType(params: {
	readonly typeName: GoAST.Identifier;
	readonly generic: GoAST.Identifier;
	readonly typeParam: GoAST.TypeParameter;
	readonly sideField: string;
	readonly sideKey: string;
	readonly markerField?: string;
	readonly markerKey?: string;
}) {
	const fields: GoAST.StructField[] = [
		GoAST.createStructField({
			identifier: identifier(params.sideField),
			typeReference: nullType,
			tag: `json:"${runtimeKeyPrefix}${params.sideKey}"`,
		}),
		GoAST.createStructField({
			identifier: identifier("Information"),
			typeReference: GoAST.builtinTypeReferences.string,
			tag: `json:"${runtimeKeyPrefix}information"`,
		}),
		GoAST.createStructField({
			identifier: identifier("Value"),
			typeReference: params.generic,
			tag: `json:"${runtimeKeyPrefix}value"`,
		}),
	];

	if (params.markerField && params.markerKey) {
		fields.push(
			GoAST.createStructField({
				identifier: identifier(params.markerField),
				typeReference: nullType,
				tag: `json:"${runtimeKeyPrefix}${params.markerKey}"`,
			}),
		);
	}

	return GoAST.createTypeDefinition({
		identifier: params.typeName,
		generic: [params.typeParam],
		type: GoAST.createStructType({ fields }),
	});
}
