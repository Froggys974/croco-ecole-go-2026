import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { GoAST, GoPrinter } from "@go";
import { sharedDependencyPackageName } from "@transformer";
import { TsAST } from "@typescript";
import { TypeFlags, type Type } from "typescript/async";
import { type BuildContext } from "../../context/build";
import { valueDependency, valueIdentifiers } from "../../sharedDependency/value";
import { typeTransformers } from "../type";

/**
 * Passages entre une valeur ordinaire et une Value (la valeur plate des unions),
 * aux FRONTIÈRES : return, argument d'appel, variable avec type annoté,
 * argument d'une fonction DEither.
 *
 *   number  → number | null        : emballer  → ValueNumber(x)
 *   number | null → number         : déballer  → x.Number()  (après un test, TS le garantit)
 *   union → autre union            : RIEN, c'est le même type Go (Value)
 */

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
 * Type TS → type Go, sans échouer : undefined si le type n'est pas (encore) traduisible.
 * (Un import du runtime enregistré pour rien est retiré à la fin, cf. transformSourceFile.)
 */
export async function transformTypeQuietly(
	type: Type,
	location: TsAST.Node,
	context: BuildContext,
) {
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

const renderedValueType = GoPrinter.renderNode(
	GoAST.createPackageTypeReference({
		packageName: sharedDependencyPackageName,
		identifier: valueIdentifiers.type,
	}),
);

export function isValueType(goType: GoAST.Type | GoAST.TypeReference | undefined) {
	return goType !== undefined && GoPrinter.renderNode(goType) === renderedValueType;
}

function runtime(member: GoAST.Identifier, context: BuildContext) {
	return GoAST.createSelectorExpression({
		target: context.registerSharedDependency(valueDependency.value),
		identifier: member,
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
	if (isValueType(await transformTypeQuietly(sourceType, location, context))) {
		return expression;
	}

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
						: valueIdentifiers.fromObject; // objet, tableau… → case object

	return GoAST.createCallExpression({
		callee: runtime(constructor, context),
		arguments: [expression],
	});
}

/**
 * Déballe une Value vers un type ordinaire. Sûr uniquement là où TS a déjà
 * rétréci le type (après un test) : c'est le cas aux frontières qui l'exigent.
 */
function unpackValue(
	expression: GoAST.Expression,
	targetType: Type,
	targetGoType: GoAST.Type | GoAST.TypeReference,
) {
	const flags = targetType.flags;

	const getter = flags & TypeFlags.NumberLike
		? valueIdentifiers.toNumber
		: flags & TypeFlags.StringLike
			? valueIdentifiers.toString
			: flags & TypeFlags.BooleanLike
				? valueIdentifiers.toBoolean
				: flags & TypeFlags.Null
					? valueIdentifiers.toNull
					: flags & TypeFlags.Undefined
						? valueIdentifiers.toUndefined
						: undefined;

	const unpacked = GoAST.createCallExpression({
		callee: GoAST.createSelectorExpression({
			target: expression,
			identifier: getter ?? valueIdentifiers.toObject,
		}),
		arguments: [],
	});

	// Objet : la case object est un any → assertion vers le type que TS a donné.
	return getter
		? unpacked
		: GoAST.createTypeAssertionExpression({
			target: unpacked,
			typeReference: targetGoType,
		});
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

	if (!target || !source || isValueType(source) === isValueType(target)) {
		return context.success({ result: expression });
	}

	if (isValueType(target)) {
		return context.success({
			result: await packValue(expression, sourceType, location, context),
		});
	}

	return context.success({
		result: unpackValue(expression, targetType, target),
	});
}
