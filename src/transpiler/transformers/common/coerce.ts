import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { GoAST, GoPrinter } from "@go";
import { sharedDependencyPackageName } from "@transformer";
import { TsAST } from "@typescript";
import { TypeFlags, type Type } from "typescript/async";
import { type BuildContext } from "../../context/build";
import { undefinedShardDependency } from "../../sharedDependency/defaults";
import { valueDependency, valueIdentifiers } from "../../sharedDependency/value";
import { typeTransformers } from "../type";

/**
 * Passer d'une valeur ordinaire à une Value, et inversement, aux frontières :
 * return, argument d'appel, variable typée, rappel d'une fonction DuploJS.
 *
 *   float64 vers Value : on emballe, ValueNumber(x)
 *   Value vers float64 : on déballe, x.Number() (sûr après un test, TS le garantit)
 *   Value vers Value   : rien à faire, c'est le même type Go
 *
 * La case est choisie d'après le type Go et pas d'après les drapeaux TS.
 * Exemple : "a" | "b" est une string en Go, donc elle va dans la case texte.
 * Les drapeaux TS ne servent qu'en secours, si le type Go est inconnu.
 */

export type GoType = GoAST.Type | GoAST.TypeReference;

type ReturningFunction = (
	| TsAST.FunctionDeclaration
	| TsAST.FunctionExpression
	| TsAST.ArrowFunction
	| TsAST.MethodDeclaration
);

export function findEnclosingFunction(node: TsAST.Node): ReturningFunction | undefined {
	if (
		TsAST.isFunctionDeclaration(node)
		|| TsAST.isFunctionExpression(node)
		|| TsAST.isArrowFunction(node)
		|| TsAST.isMethodDeclaration(node)
	) {
		return node;
	}

	return node.parent
		? findEnclosingFunction(node.parent)
		: undefined;
}

/**
 * Traduit un type TS en type Go sans échouer : rend undefined si ce n'est pas traduisible.
 * Un import du runtime enregistré pour rien est retiré à la fin (voir transformSourceFile).
 */
export async function transformTypeQuietly(
	type: Type,
	location: TsAST.Node,
	context: BuildContext,
): Promise<GoType | undefined> {
	const typeNode = await context.transpilation.typeChecker.typeToTypeNode(type, location);

	if (!typeNode) {
		return undefined;
	}

	const goType = await DCommon.asyncPipe(
		context.transform(typeNode, typeTransformers.value),
		DEither.unwrapRight,
	);

	return DEither.isLeft(goType)
		? undefined
		: goType.result;
}

function runtimeTypeReference(identifier: GoAST.Identifier) {
	return GoAST.createPackageTypeReference({
		packageName: sharedDependencyPackageName,
		identifier,
	});
}

const renderedValueType = GoPrinter.renderNode(runtimeTypeReference(valueIdentifiers.type));

export function isValueType(goType: GoType | undefined) {
	return goType !== undefined && GoPrinter.renderNode(goType) === renderedValueType;
}

interface Box {
	readonly pack: GoAST.Identifier;
	readonly unpack: GoAST.Identifier;
}

/**
 * Pour chaque type Go, la case de la Value qui le range.
 * Les autres types (slice, struct) vont dans la case object.
 */
const boxes = DCommon.memo((): Partial<Record<string, Box>> => ({
	[GoPrinter.renderNode(GoAST.builtinTypeReferences.float64)]: {
		pack: valueIdentifiers.fromNumber,
		unpack: valueIdentifiers.toNumber,
	},
	[GoPrinter.renderNode(GoAST.builtinTypeReferences.string)]: {
		pack: valueIdentifiers.fromString,
		unpack: valueIdentifiers.toString,
	},
	[GoPrinter.renderNode(GoAST.builtinTypeReferences.bool)]: {
		pack: valueIdentifiers.fromBoolean,
		unpack: valueIdentifiers.toBoolean,
	},
	[GoPrinter.renderNode(runtimeTypeReference(GoAST.createIdentifier("JSNull")))]: {
		pack: valueIdentifiers.fromNull,
		unpack: valueIdentifiers.toNull,
	},
	[GoPrinter.renderNode(runtimeTypeReference(GoAST.createIdentifier("JSUndefined")))]: {
		pack: valueIdentifiers.fromUndefined,
		unpack: valueIdentifiers.toUndefined,
	},
}));

function runtime(member: GoAST.Identifier, context: BuildContext) {
	return GoAST.createSelectorExpression({
		target: context.registerSharedDependency(valueDependency.value),
		identifier: member,
	});
}

function method(target: GoAST.Expression, member: GoAST.Identifier) {
	return GoAST.createCallExpression({
		callee: GoAST.createSelectorExpression({
			target,
			identifier: member,
		}),
		arguments: [],
	});
}

/**
 * Emballe une expression Go dont on connaît le type. Si c'est déjà une Value, elle passe telle quelle.
 */
export function packGoValue(
	expression: GoAST.Expression,
	sourceGoType: GoType,
	context: BuildContext,
): GoAST.Expression {
	if (isValueType(sourceGoType)) {
		return expression;
	}

	const box = boxes.value[GoPrinter.renderNode(sourceGoType)];

	return GoAST.createCallExpression({
		callee: runtime(box?.pack ?? valueIdentifiers.fromObject, context),
		arguments: [expression],
	});
}

/**
 * Déballe une Value vers un type Go ordinaire. Sûr uniquement là où TS a déjà
 * rétréci le type (après un test) : c'est le cas aux frontières qui l'exigent.
 * Case object : c'est un any, on écrit l'assertion vers le type demandé.
 */
export function unpackGoValue(
	expression: GoAST.Expression,
	targetGoType: GoType,
): GoAST.Expression {
	const box = boxes.value[GoPrinter.renderNode(targetGoType)];

	if (box) {
		return method(expression, box.unpack);
	}

	return GoAST.createTypeAssertionExpression({
		target: method(expression, valueIdentifiers.toObject),
		typeReference: targetGoType,
	});
}

/**
 * Lit le contenu d'un Either (Success<number> contient 3) dans le type Go attendu.
 * Le contenu est rangé à plat, on le relit donc comme une union.
 * Si le contenu attendu est lui-même une Value (union, Either imbriqué), on utilise .Content().
 */
export function unpackEitherContent(
	either: GoAST.Expression,
	contentGoType: GoType,
): GoAST.Expression {
	return isValueType(contentGoType)
		? method(either, valueIdentifiers.content)
		: unpackGoValue(either, contentGoType);
}

// undefined dans le type demandé (argument absent). Rend undefined si ce type ne peut pas le valoir.
export function undefinedFor(
	targetGoType: GoType,
	context: BuildContext,
): GoAST.Expression | undefined {
	const undefinedType = runtimeTypeReference(GoAST.createIdentifier("JSUndefined"));
	const isValue = isValueType(targetGoType);

	if (!isValue && GoPrinter.renderNode(targetGoType) !== GoPrinter.renderNode(undefinedType)) {
		return undefined;
	}

	const literal = GoAST.createStructLiteral({
		typeReference: GoAST.createPackageTypeReference({
			packageName: context.registerSharedDependency(undefinedShardDependency.value),
			identifier: GoAST.createIdentifier("JSUndefined"),
		}),
		elements: [],
	});

	return isValue
		? packGoValue(literal, undefinedType, context)
		: literal;
}

/**
 * Convertit une expression d'un type Go vers un autre, si l'un des deux est une Value.
 */
export function coerceGoExpression(
	expression: GoAST.Expression,
	sourceGoType: GoType,
	targetGoType: GoType,
	context: BuildContext,
): GoAST.Expression {
	if (isValueType(sourceGoType) === isValueType(targetGoType)) {
		return expression;
	}

	return isValueType(targetGoType)
		? packGoValue(expression, sourceGoType, context)
		: unpackGoValue(expression, targetGoType);
}

/**
 * Secours quand le type Go de la source est inconnu : la case d'après les drapeaux TS.
 */
function packByTypeFlags(
	expression: GoAST.Expression,
	sourceType: Type,
	context: BuildContext,
) {
	const flags = sourceType.flags;

	const constructor = flags & TypeFlags.NumberLike
		? valueIdentifiers.fromNumber
		: flags & TypeFlags.StringLike
			? valueIdentifiers.fromString
			: flags & TypeFlags.BooleanLike
				? valueIdentifiers.fromBoolean
				: flags & TypeFlags.Null
					? valueIdentifiers.fromNull
					: flags & TypeFlags.Undefined
						? valueIdentifiers.fromUndefined
						: valueIdentifiers.fromObject;

	return GoAST.createCallExpression({
		callee: runtime(constructor, context),
		arguments: [expression],
	});
}

/**
 * Emballe une expression dans une Value, selon son type TS.
 * Si c'est déjà une Value (une union, un Either), elle passe telle quelle.
 */
export async function packValue(
	expression: GoAST.Expression,
	sourceType: Type,
	location: TsAST.Node,
	context: BuildContext,
): Promise<GoAST.Expression> {
	const sourceGoType = await transformTypeQuietly(sourceType, location, context);

	return sourceGoType
		? packGoValue(expression, sourceGoType, context)
		: packByTypeFlags(expression, sourceType, context);
}

export async function coerceExpression(
	expression: GoAST.Expression,
	sourceType: Type,
	targetType: Type,
	location: TsAST.Node,
	context: BuildContext,
) {
	const target = await transformTypeQuietly(targetType, location, context);
	const source = await transformTypeQuietly(sourceType, location, context);

	if (!target || !source) {
		return context.success({ result: expression });
	}

	return context.success({
		result: coerceGoExpression(expression, source, target, context),
	});
}
