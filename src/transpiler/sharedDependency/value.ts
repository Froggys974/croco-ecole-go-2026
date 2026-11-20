import * as DCommon from "@duplojs/lang/common";
import { GoAST } from "@go";
import { createSharedDependency, goImports } from "@transformer";

/**
 * Le runtime Go de la valeur plate.
 * Toute valeur dont le type TS est une union ou un Either devient une `Value`.
 *
 *   type Value struct {
 *       kind        ValueKind     // étiquette : quelle case est remplie
 *       payload     ValueKind     // pour un Either : le genre de son contenu
 *       boolean     bool          // case booléen
 *       message     string        // pour un Either : son message (information en DuploJS)
 *       number      float64       // case nombre
 *       text        string        // case texte
 *       object      any           // case objet : tout ce qui ne tient pas à plat
 *   }
 *
 * Les primitifs, null, undefined et les Either de primitifs sont rangés à plat, sans allocation.
 * Les objets, les tableaux et un Either dans un Either vont dans la case object (1 allocation).
 * Un seul type pour toutes les unions, donc aucune conversion entre elles.
 * Pas de générique, donc pas de coût caché.
 *
 * Il n'y a pas de champ marqueur. La clé success, fail, error ou ok de l'objet JS
 * est retrouvée grâce au côté et au message. Seul écart connu : DEither.right("success", x)
 * affiche une clé success que JS n'a pas.
 *
 * L'AST Go ne gère pas les blocs const avec iota, les étiquettes sont donc numérotées à la main.
 */

const identifier = GoAST.createIdentifier;

export const valueIdentifiers = {
	type: identifier("Value"),
	// emballer une valeur ordinaire dans une Value
	fromNumber: identifier("ValueNumber"),
	fromString: identifier("ValueString"),
	fromBoolean: identifier("ValueBoolean"),
	fromNull: identifier("ValueNull"),
	fromUndefined: identifier("ValueUndefined"),
	fromObject: identifier("ValueObject"),
	// déballer (méthodes)
	toNumber: identifier("Number"),
	toString: identifier("Text"),
	toBoolean: identifier("Boolean"),
	toNull: identifier("Null"),
	toUndefined: identifier("Undefined"),
	toObject: identifier("Object"),
	// DEither
	success: identifier("EitherSuccess"),
	fail: identifier("EitherFail"),
	error: identifier("EitherError"),
	ok: identifier("EitherOk"),
	left: identifier("EitherLeft"),
	right: identifier("EitherRight"),
	isRight: identifier("EitherIsRight"),
	isLeft: identifier("EitherIsLeft"),
	// le contenu d'un Either, remis en Value (méthode)
	content: identifier("Content"),
};

const kindType = identifier("ValueKind");
const nullType = identifier("JSNull");
const undefinedType = identifier("JSUndefined");
const jsonViewType = identifier("eitherJSON");
const markerFunction = identifier("valueMarker");
const eitherOfFunction = identifier("eitherOf");
const contentMethod = valueIdentifiers.content;
const runtimeKeyPrefix = "@duplojs/lang/kind/@DuplojsLangEither/";

const fields = {
	kind: identifier("kind"),
	payload: identifier("payload"),
	boolean: identifier("boolean"),
	message: identifier("message"),
	number: identifier("number"),
	text: identifier("text"),
	object: identifier("object"),
};

const kinds = {
	invalid: identifier("KindInvalid"),
	undefined: identifier("KindUndefined"),
	null: identifier("KindNull"),
	boolean: identifier("KindBoolean"),
	number: identifier("KindNumber"),
	string: identifier("KindString"),
	object: identifier("KindObject"),
	left: identifier("KindLeft"),
	right: identifier("KindRight"),
};


// --- Raccourcis de construction de l'AST Go ------------------------------------

function constant(name: GoAST.Identifier, typeReference: GoAST.Identifier, value: number) {
	return GoAST.createConstantDeclaration({
		identifier: name,
		typeReference,
		initializer: GoAST.createIntegerLiteral({ value: BigInt(value) }),
	});
}

function select(target: GoAST.Expression, member: GoAST.Identifier) {
	return GoAST.createSelectorExpression({
		target,
		identifier: member,
	});
}

function equals(left: GoAST.Expression, right: GoAST.Expression) {
	return GoAST.createBinaryExpression({
		operator: "==",
		left,
		right,
	});
}

function or(left: GoAST.Expression, right: GoAST.Expression) {
	return GoAST.createBinaryExpression({
		operator: "||",
		left,
		right,
	});
}

function and(left: GoAST.Expression, right: GoAST.Expression) {
	return GoAST.createBinaryExpression({
		operator: "&&",
		left,
		right,
	});
}

function keyed(key: GoAST.Identifier, value: GoAST.Expression) {
	return GoAST.createKeyedElement({
		key,
		value,
	});
}

function call(callee: GoAST.Expression, callArguments: readonly GoAST.Expression[]) {
	return GoAST.createCallExpression({
		callee,
		arguments: callArguments,
	});
}

function returns(...values: GoAST.Expression[]) {
	return GoAST.createReturnStatement({ values });
}

function block(...statements: GoAST.Statement[]) {
	return GoAST.createBlockStatement({ statements });
}

function argument(name: GoAST.Identifier, type: GoAST.FunctionArgument["type"]) {
	return GoAST.createFunctionArgument({
		identifier: name,
		type,
	});
}

function valueLiteral(elements: readonly GoAST.KeyedElement<GoAST.Identifier>[]) {
	return GoAST.createStructLiteral({
		typeReference: valueIdentifiers.type,
		elements,
	});
}

// func NOM(ARGUMENTS) Value { STATEMENTS }
function valueFunction(
	name: GoAST.Identifier,
	functionArguments: readonly GoAST.FunctionArgument[],
	statements: readonly GoAST.Statement[],
	returnType: GoAST.FunctionDeclaration["returnTypes"][number] = valueIdentifiers.type,
) {
	return GoAST.createFunctionDeclaration({
		identifier: name,
		generic: [],
		arguments: functionArguments,
		returnTypes: [returnType],
		body: GoAST.createBlockStatement({ statements }),
	});
}

// func (input Value) NOM() TYPE { return input.CHAMP }
function getter(
	name: GoAST.Identifier,
	returnType: GoAST.FunctionDeclaration["returnTypes"][number],
	value: GoAST.Expression,
	input: GoAST.Identifier,
) {
	return GoAST.createMethodDeclaration({
		identifier: name,
		receiver: [input, valueIdentifiers.type],
		generic: [],
		arguments: [],
		returnTypes: [returnType],
		body: block(returns(value)),
	});
}

export const valueDependency = DCommon.memo(() => {
	const input = identifier("input");
	const value = identifier("value");
	const content = identifier("content");
	const message = identifier("message");
	const kind = identifier("kind");
	const present = identifier("present");
	const nested = identifier("nested");
	const ignored = identifier("_");

	const nullPointer = GoAST.createPointerType({ typeReference: nullType });

	function jsonField(name: string, typeReference: GoAST.StructField["typeReference"], key: string, omitEmpty: boolean) {
		return GoAST.createStructField({
			identifier: identifier(name),
			typeReference,
			tag: `json:"${runtimeKeyPrefix}${key}${omitEmpty ? ",omitempty" : ""}"`,
		});
	}

	function eitherOf(eitherKind: GoAST.Identifier, eitherMessage: GoAST.Expression, eitherContent: GoAST.Expression) {
		return call(eitherOfFunction, [eitherKind, eitherMessage, eitherContent]);
	}

	// La clé en plus de l'objet JS, retrouvée grâce au côté et au message.
	function hasMarkerKey(side: GoAST.Identifier, name: string) {
		return and(
			equals(select(input, fields.kind), side),
			equals(select(input, fields.message), GoAST.createStringLiteral({ value: name })),
		);
	}

	function jsonMarshal(target: GoAST.Expression) {
		return call(select(identifier("json"), identifier("Marshal")), [target]);
	}

	return createSharedDependency({
		imports: [goImports.encodingJson, goImports.errors],
		init: [],
		declarations: [
			// --- Étiquettes ---------------------------------------------------------
			GoAST.createTypeDefinition({
				identifier: kindType,
				type: GoAST.builtinTypeReferences.uint8,
			}),
			constant(kinds.invalid, kindType, 0),
			constant(kinds.undefined, kindType, 1),
			constant(kinds.null, kindType, 2),
			constant(kinds.boolean, kindType, 3),
			constant(kinds.number, kindType, 4),
			constant(kinds.string, kindType, 5),
			constant(kinds.object, kindType, 6),
			constant(kinds.left, kindType, 7),
			constant(kinds.right, kindType, 8),

			// --- La valeur plate ----------------------------------------------------
			GoAST.createTypeDefinition({
				identifier: valueIdentifiers.type,
				type: GoAST.createStructType({
					fields: [
						GoAST.createStructField({ identifier: fields.message, typeReference: GoAST.builtinTypeReferences.string }),
						GoAST.createStructField({ identifier: fields.text, typeReference: GoAST.builtinTypeReferences.string }),
						GoAST.createStructField({ identifier: fields.object, typeReference: GoAST.builtinTypeReferences.any }),
						GoAST.createStructField({ identifier: fields.number, typeReference: GoAST.builtinTypeReferences.float64 }),
						GoAST.createStructField({ identifier: fields.kind, typeReference: kindType }),
						GoAST.createStructField({ identifier: fields.payload, typeReference: kindType }),
						GoAST.createStructField({ identifier: fields.boolean, typeReference: GoAST.builtinTypeReferences.bool }),
					],
				}),
			}),

			// --- Emballer une valeur ordinaire dans une Value ---
			valueFunction(valueIdentifiers.fromUndefined, [argument(ignored, undefinedType)], [
				returns(valueLiteral([keyed(fields.kind, kinds.undefined)])),
			]),
			valueFunction(valueIdentifiers.fromNull, [argument(ignored, nullType)], [
				returns(valueLiteral([keyed(fields.kind, kinds.null)])),
			]),
			valueFunction(valueIdentifiers.fromBoolean, [argument(value, GoAST.builtinTypeReferences.bool)], [
				returns(valueLiteral([keyed(fields.kind, kinds.boolean), keyed(fields.boolean, value)])),
			]),
			valueFunction(valueIdentifiers.fromNumber, [argument(value, GoAST.builtinTypeReferences.float64)], [
				returns(valueLiteral([keyed(fields.kind, kinds.number), keyed(fields.number, value)])),
			]),
			valueFunction(valueIdentifiers.fromString, [argument(value, GoAST.builtinTypeReferences.string)], [
				returns(valueLiteral([keyed(fields.kind, kinds.string), keyed(fields.text, value)])),
			]),
			valueFunction(valueIdentifiers.fromObject, [argument(value, GoAST.builtinTypeReferences.any)], [
				returns(valueLiteral([keyed(fields.kind, kinds.object), keyed(fields.object, value)])),
			]),

			// --- Sortir une valeur ordinaire d'une Value (après un test d'étiquette) ---
			getter(valueIdentifiers.toNumber, GoAST.builtinTypeReferences.float64, select(input, fields.number), input),
			getter(valueIdentifiers.toString, GoAST.builtinTypeReferences.string, select(input, fields.text), input),
			getter(valueIdentifiers.toBoolean, GoAST.builtinTypeReferences.bool, select(input, fields.boolean), input),
			getter(valueIdentifiers.toObject, GoAST.builtinTypeReferences.any, select(input, fields.object), input),
			getter(valueIdentifiers.toNull, nullType, GoAST.createStructLiteral({ typeReference: nullType, elements: [] }), input),
			getter(valueIdentifiers.toUndefined, undefinedType, GoAST.createStructLiteral({ typeReference: undefinedType, elements: [] }), input),

			// --- Either -------------------------------------------------------------
			// func eitherOf(kind ValueKind, message string, content Value) Value
			// Le contenu est rangé à plat, sauf si c'est lui-même un Either (case object).
			valueFunction(
				eitherOfFunction,
				[
					argument(kind, kindType),
					argument(message, GoAST.builtinTypeReferences.string),
					argument(content, valueIdentifiers.type),
				],
				[
					GoAST.createIfStatement({
						condition: or(
							equals(select(content, fields.kind), kinds.left),
							equals(select(content, fields.kind), kinds.right),
						),
						body: block(
							returns(valueLiteral([
								keyed(fields.kind, kind),
								keyed(fields.message, message),
								keyed(fields.payload, kinds.object),
								keyed(fields.object, content),
							])),
						),
					}),
					returns(valueLiteral([
						keyed(fields.kind, kind),
						keyed(fields.message, message),
						keyed(fields.payload, select(content, fields.kind)),
						keyed(fields.boolean, select(content, fields.boolean)),
						keyed(fields.number, select(content, fields.number)),
						keyed(fields.text, select(content, fields.text)),
						keyed(fields.object, select(content, fields.object)),
					])),
				],
			),
			valueFunction(valueIdentifiers.success, [argument(content, valueIdentifiers.type)], [
				returns(eitherOf(kinds.right, GoAST.createStringLiteral({ value: "success" }), content)),
			]),
			valueFunction(valueIdentifiers.ok, [], [
				returns(valueLiteral([
					keyed(fields.kind, kinds.right),
					keyed(fields.message, GoAST.createStringLiteral({ value: "ok" })),
					keyed(fields.payload, kinds.undefined),
				])),
			]),
			valueFunction(valueIdentifiers.right, [argument(message, GoAST.builtinTypeReferences.string), argument(content, valueIdentifiers.type)], [
				returns(eitherOf(kinds.right, message, content)),
			]),
			valueFunction(valueIdentifiers.fail, [], [
				returns(valueLiteral([
					keyed(fields.kind, kinds.left),
					keyed(fields.message, GoAST.createStringLiteral({ value: "fail" })),
					keyed(fields.payload, kinds.undefined),
				])),
			]),
			valueFunction(valueIdentifiers.error, [argument(content, valueIdentifiers.type)], [
				returns(eitherOf(kinds.left, GoAST.createStringLiteral({ value: "error" }), content)),
			]),
			valueFunction(valueIdentifiers.left, [argument(message, GoAST.builtinTypeReferences.string), argument(content, valueIdentifiers.type)], [
				returns(eitherOf(kinds.left, message, content)),
			]),
			valueFunction(
				valueIdentifiers.isRight,
				[argument(input, valueIdentifiers.type)],
				[returns(equals(select(input, fields.kind), kinds.right))],
				GoAST.builtinTypeReferences.bool,
			),
			valueFunction(
				valueIdentifiers.isLeft,
				[argument(input, valueIdentifiers.type)],
				[returns(equals(select(input, fields.kind), kinds.left))],
				GoAST.builtinTypeReferences.bool,
			),

			// func (input Value) Content() Value : le contenu d'un Either, remis en Value.
			// Either dans un Either : la case object contient la Value intérieure, on la rend telle quelle.
			//   switch nested := input.object.(type) { case Value: return nested }
			GoAST.createMethodDeclaration({
				identifier: contentMethod,
				receiver: [input, valueIdentifiers.type],
				generic: [],
				arguments: [],
				returnTypes: [valueIdentifiers.type],
				body: block(
					GoAST.createTypeSwitchStatementWithoutDefault({
						expression: select(input, fields.object),
						identifier: nested,
						cases: [
							GoAST.createTypeSwitchCase({
								types: DCommon.cast([valueIdentifiers.type]),
								statements: [returns(nested)],
							}),
						],
					}),
					returns(valueLiteral([
						keyed(fields.kind, select(input, fields.payload)),
						keyed(fields.boolean, select(input, fields.boolean)),
						keyed(fields.number, select(input, fields.number)),
						keyed(fields.text, select(input, fields.text)),
						keyed(fields.object, select(input, fields.object)),
					])),
				),
			}),

			// --- Affichage (print) --------------------------------------------------
			// Un Either reproduit l'objet JS de DuploJS (ordre des clés compris).
			GoAST.createTypeDefinition({
				identifier: jsonViewType,
				type: GoAST.createStructType({
					fields: [
						jsonField("Left", nullPointer, "left", true),
						jsonField("Right", nullPointer, "right", true),
						// La clé JSON reste information, comme dans l'objet DuploJS.
						jsonField("Message", GoAST.builtinTypeReferences.string, "information", false),
						jsonField("Value", valueIdentifiers.type, "value", false),
						jsonField("Success", nullPointer, "success", true),
						jsonField("Fail", nullPointer, "fail", true),
						jsonField("Error", nullPointer, "error", true),
						jsonField("Ok", nullPointer, "ok", true),
					],
				}),
			}),
			GoAST.createFunctionDeclaration({
				identifier: markerFunction,
				generic: [],
				arguments: [argument(present, GoAST.builtinTypeReferences.bool)],
				returnTypes: [nullPointer],
				body: block(
					GoAST.createIfStatement({
						condition: present,
						body: block(returns(GoAST.createAddressExpression({
							operand: GoAST.createStructLiteral({ typeReference: nullType, elements: [] }),
						}))),
					}),
					returns(GoAST.createNilLiteral({})),
				),
			}),
			GoAST.createMethodDeclaration({
				identifier: identifier("MarshalJSON"),
				receiver: [input, valueIdentifiers.type],
				generic: [],
				arguments: [],
				returnTypes: [
					GoAST.createSliceType({ elementType: GoAST.builtinTypeReferences.byte }),
					GoAST.builtinTypeReferences.error,
				],
				body: block(
					GoAST.createIfStatement({
						condition: or(
							equals(select(input, fields.kind), kinds.left),
							equals(select(input, fields.kind), kinds.right),
						),
						body: block(returns(jsonMarshal(GoAST.createStructLiteral({
							typeReference: jsonViewType,
							elements: [
								keyed(identifier("Left"), call(markerFunction, [equals(select(input, fields.kind), kinds.left)])),
								keyed(identifier("Right"), call(markerFunction, [equals(select(input, fields.kind), kinds.right)])),
								keyed(identifier("Message"), select(input, fields.message)),
								keyed(identifier("Value"), call(select(input, contentMethod), [])),
								keyed(identifier("Success"), call(markerFunction, [hasMarkerKey(kinds.right, "success")])),
								keyed(identifier("Fail"), call(markerFunction, [hasMarkerKey(kinds.left, "fail")])),
								keyed(identifier("Error"), call(markerFunction, [hasMarkerKey(kinds.left, "error")])),
								keyed(identifier("Ok"), call(markerFunction, [hasMarkerKey(kinds.right, "ok")])),
							],
						})))),
					}),
					GoAST.createIfStatement({
						condition: equals(select(input, fields.kind), kinds.boolean),
						body: block(returns(jsonMarshal(select(input, fields.boolean)))),
					}),
					GoAST.createIfStatement({
						condition: equals(select(input, fields.kind), kinds.number),
						body: block(returns(jsonMarshal(select(input, fields.number)))),
					}),
					GoAST.createIfStatement({
						condition: equals(select(input, fields.kind), kinds.string),
						body: block(returns(jsonMarshal(select(input, fields.text)))),
					}),
					GoAST.createIfStatement({
						condition: equals(select(input, fields.kind), kinds.object),
						body: block(returns(jsonMarshal(select(input, fields.object)))),
					}),
					GoAST.createIfStatement({
						condition: equals(select(input, fields.kind), kinds.invalid),
						body: block(returns(
							GoAST.createNilLiteral({}),
							call(select(identifier("errors"), identifier("New")), [
								GoAST.createStringLiteral({ value: "shard_dependencies: uninitialized Value" }),
							]),
						)),
					}),
					// null et undefined : JSON ne connaît que null.
					returns(jsonMarshal(GoAST.createNilLiteral({}))),
				),
			}),
		],
	});
});
