import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import * as DModeling from "@duplojs/lang/modeling";
import { GoAST, GoPrinter } from "@go";
import { sharedDependencyPackageName } from "@transformer";
import { TsAST } from "@typescript";
import { NodeBuilderFlags, type Type } from "typescript/async";
import { type BuildContext } from "../../context/build";
import {
	eitherCompactDependency,
	eitherIdentifiers,
	eitherOrFailDependency,
	eitherSuccessDependency,
	eitherTaggedDependency,
} from "../../sharedDependency/either";
import { typeTransformers } from "../type";

/**
 * Passages de types Go aux frontières (return, argument d'appel, variable typée, pipe)
 * pour les structs typées, EitherCompact[T], EitherTagged[R, L], Either et any.
 *
 * - T vers Either ou any          : assignation Go directe.
 * - EitherSuccess/Fail -> Compact : EitherCompactSuccess[T](...) / EitherCompactFail[T]().
 * - Either* -> EitherTagged[R, L] : constructeur EitherTagged*[R, L](...).
 * - any / Either vers T concret   : assertion de type x.(T) (après narrowing TS).
 */

export type GoType = GoAST.Type | GoAST.TypeReference;

type ReturningFunction = (
	| TsAST.FunctionDeclaration
	| TsAST.FunctionExpression
	| TsAST.ArrowFunction
	| TsAST.MethodDeclaration
);

export function findEnclosingFunction(node: TsAST.Node): ReturningFunction | undefined {
	const parent = node.parent;

	if (!parent) {
		return undefined;
	}

	return TsAST.isFunctionDeclaration(parent)
		|| TsAST.isFunctionExpression(parent)
		|| TsAST.isArrowFunction(parent)
		|| TsAST.isMethodDeclaration(parent)
		? parent
		: findEnclosingFunction(parent);
}

/**
 * Traduit un type TS en type Go sans échouer : rend undefined si non traduisible.
 * Restaure les dépendances partagées et imports si la tentative échoue.
 */
export async function transformTypeQuietly(
	type: Type,
	location: TsAST.Node,
	context: BuildContext,
): Promise<GoType | undefined> {
	const typeNode = await context.transpilation.typeChecker.typeToTypeNode(
		type,
		location,
		NodeBuilderFlags.NoTruncation,
	);

	if (!typeNode) {
		return undefined;
	}

	const snapshotDependencies = new Set(context.transpilation.sharedDependencies);
	const snapshotImports = new Set(context.file.imports);

	const goType = await DCommon.asyncPipe(
		context.transform(typeNode, typeTransformers.value),
		DEither.unwrapRight,
	);

	if (DEither.isLeft(goType)) {
		context.transpilation.sharedDependencies.clear();
		for (const dep of snapshotDependencies) {
			context.transpilation.sharedDependencies.add(dep);
		}
		context.file.imports.clear();
		for (const imp of snapshotImports) {
			context.file.imports.add(imp);
		}
		return undefined;
	}

	return goType.result;
}

const pkgPrefix = `${sharedDependencyPackageName.value}.`;
const renderedAnyType = GoPrinter.renderNode(GoAST.builtinTypeReferences.any);
const renderedEitherInterface = `${pkgPrefix}${eitherIdentifiers.interface.value}`;
const eitherCompactPrefix = `${pkgPrefix}${eitherIdentifiers.eitherCompactType.value}[`;
const eitherOrFailPrefix = `${pkgPrefix}${eitherIdentifiers.eitherOrFailType.value}[`;
const eitherTaggedPrefix = `${pkgPrefix}${eitherIdentifiers.eitherTaggedType.value}[`;
const concreteEitherPrefixes = [
	`${pkgPrefix}${eitherIdentifiers.successType.value}`,
	`${pkgPrefix}${eitherIdentifiers.errorType.value}`,
	`${pkgPrefix}${eitherIdentifiers.failType.value}`,
	`${pkgPrefix}${eitherIdentifiers.okType.value}`,
	`${pkgPrefix}${eitherIdentifiers.leftType.value}`,
	`${pkgPrefix}${eitherIdentifiers.rightType.value}`,
	`${pkgPrefix}${eitherIdentifiers.eitherCompactType.value}`,
	`${pkgPrefix}${eitherIdentifiers.eitherTaggedType.value}`,
];

export function isAnyType(goType: GoType | undefined) {
	return goType !== undefined && GoPrinter.renderNode(goType) === renderedAnyType;
}

export function isEitherInterfaceType(goType: GoType | undefined) {
	return goType !== undefined && GoPrinter.renderNode(goType) === renderedEitherInterface;
}

export function isEitherCompactType(goType: GoType | undefined) {
	return goType !== undefined && GoPrinter.renderNode(goType).startsWith(eitherCompactPrefix);
}

export function isEitherOrFailType(goType: GoType | undefined) {
	return goType !== undefined && GoPrinter.renderNode(goType).startsWith(eitherOrFailPrefix);
}

export function isEitherTaggedType(goType: GoType | undefined) {
	return goType !== undefined && GoPrinter.renderNode(goType).startsWith(eitherTaggedPrefix);
}

export function isConcreteEitherType(goType: GoType | undefined) {
	if (!goType) {
		return false;
	}
	const rendered = GoPrinter.renderNode(goType);

	return concreteEitherPrefixes.some((prefix) => rendered === prefix || rendered.startsWith(`${prefix}[`));
}

export function isEitherGoType(goType: GoType | undefined) {
	return isEitherInterfaceType(goType) || isConcreteEitherType(goType);
}

function getGenericTypeArguments(goType: GoType): readonly (GoAST.Type | GoAST.TypeReference)[] | undefined {
	if (DModeling.hasTagValue(goType, "[node]type-reference-generic")) {
		return goType.typeArguments;
	}

	return undefined;
}

function extractFactoryCallArguments(
	expression: GoAST.Expression,
	expectedFactoryName: string,
): readonly GoAST.Expression[] | undefined {
	if (!DModeling.hasTagValue(expression, "[node][expression][statement]call")) {
		return undefined;
	}

	const callee = expression.callee;

	if (
		DModeling.hasTagValue(callee, "[node][expression]instantiation")
		&& DModeling.hasTagValue(callee.target, "[node][expression]selector")
		&& callee.target.identifier.value === expectedFactoryName
	) {
		return expression.arguments;
	}

	if (
		DModeling.hasTagValue(callee, "[node][expression]selector")
		&& callee.identifier.value === expectedFactoryName
	) {
		return expression.arguments;
	}

	return undefined;
}

type RuntimeEitherDependency =
	| typeof eitherCompactDependency
	| typeof eitherOrFailDependency
	| typeof eitherTaggedDependency
	| typeof eitherSuccessDependency;

interface GenericRuntimeCallParams {
	readonly dependency: RuntimeEitherDependency;
	readonly fnIdentifier: GoAST.Identifier;
	readonly typeArguments: readonly [GoType, ...GoType[]];
	readonly args: readonly GoAST.Expression[];
	readonly context: BuildContext;
}

function callGenericRuntime(params: GenericRuntimeCallParams): GoAST.Expression {
	return GoAST.createCallExpression({
		callee: GoAST.createInstantiationExpression({
			target: GoAST.createSelectorExpression({
				target: params.context.registerSharedDependency(params.dependency.value),
				identifier: params.fnIdentifier,
			}),
			typeArguments: DCommon.cast(params.typeArguments),
		}),
		arguments: params.args,
	});
}

function selectField(expression: GoAST.Expression, fieldName: string): GoAST.Expression {
	return GoAST.createSelectorExpression({
		target: expression,
		identifier: GoAST.createIdentifier(fieldName),
	});
}

function coerceToEitherCompact(
	expression: GoAST.Expression,
	renderedSource: string,
	targetGoType: GoType,
	context: BuildContext,
): GoAST.Expression | undefined {
	const typeArgs = getGenericTypeArguments(targetGoType);
	const payloadType = typeArgs && DArray.first(typeArgs);

	if (!payloadType) {
		return undefined;
	}

	if (renderedSource === `${pkgPrefix}${eitherIdentifiers.failType.value}`) {
		return callGenericRuntime({
			dependency: eitherCompactDependency,
			fnIdentifier: eitherIdentifiers.eitherCompactFail,
			typeArguments: [payloadType],
			args: [],
			context,
		});
	}

	if (renderedSource.startsWith(`${pkgPrefix}${eitherIdentifiers.successType.value}[`)) {
		const directArgs = extractFactoryCallArguments(expression, eitherIdentifiers.successOf.value);
		const innerValue = (directArgs && DArray.first(directArgs)) ?? selectField(expression, "Value");

		return callGenericRuntime({
			dependency: eitherCompactDependency,
			fnIdentifier: eitherIdentifiers.eitherCompactSuccess,
			typeArguments: [payloadType],
			args: [innerValue],
			context,
		});
	}

	return undefined;
}

function coerceToEitherOrFail(
	expression: GoAST.Expression,
	renderedSource: string,
	targetGoType: GoType,
	context: BuildContext,
): GoAST.Expression | undefined {
	const typeArgs = getGenericTypeArguments(targetGoType);
	const payloadType = typeArgs && DArray.first(typeArgs);

	if (!payloadType) {
		return undefined;
	}

	// Fail explicite ou branche else d'un EitherCompact / Either (garanti Left/Fail par le narrowing).
	if (
		renderedSource === `${pkgPrefix}${eitherIdentifiers.failType.value}`
		|| renderedSource.startsWith(eitherCompactPrefix)
		|| renderedSource === renderedEitherInterface
	) {
		return callGenericRuntime({
			dependency: eitherOrFailDependency,
			fnIdentifier: eitherIdentifiers.eitherOrFailLeft,
			typeArguments: [payloadType],
			args: [],
			context,
		});
	}

	if (renderedSource === GoPrinter.renderNode(payloadType)) {
		return callGenericRuntime({
			dependency: eitherOrFailDependency,
			fnIdentifier: eitherIdentifiers.eitherOrFailValue,
			typeArguments: [payloadType],
			args: [expression],
			context,
		});
	}

	return undefined;
}

function coerceToEitherTagged(
	expression: GoAST.Expression,
	renderedSource: string,
	targetGoType: GoType,
	context: BuildContext,
): GoAST.Expression | undefined {
	const typeArgs = getGenericTypeArguments(targetGoType);
	const rightType = typeArgs && DArray.at(typeArgs, 0);
	const leftType = typeArgs && DArray.at(typeArgs, 1);

	if (!rightType || !leftType) {
		return undefined;
	}

	const pairArgs: readonly [GoType, GoType] = [rightType, leftType];
	const taggedCall = (fnIdentifier: GoAST.Identifier, args: readonly GoAST.Expression[]) => callGenericRuntime({
		dependency: eitherTaggedDependency,
		fnIdentifier,
		typeArguments: pairArgs,
		args,
		context,
	});

	if (renderedSource === `${pkgPrefix}${eitherIdentifiers.failType.value}`) {
		return taggedCall(eitherIdentifiers.eitherTaggedFail, []);
	}

	if (renderedSource === `${pkgPrefix}${eitherIdentifiers.okType.value}`) {
		return taggedCall(eitherIdentifiers.eitherTaggedOk, []);
	}

	if (renderedSource.startsWith(`${pkgPrefix}${eitherIdentifiers.successType.value}[`)) {
		const directArgs = extractFactoryCallArguments(expression, eitherIdentifiers.successOf.value);
		const innerValue = directArgs?.[0] ?? selectField(expression, "Value");
		return taggedCall(eitherIdentifiers.eitherTaggedSuccess, [innerValue]);
	}

	if (renderedSource.startsWith(`${pkgPrefix}${eitherIdentifiers.errorType.value}[`)) {
		const directArgs = extractFactoryCallArguments(expression, eitherIdentifiers.errorOf.value);
		const innerValue = directArgs?.[0] ?? selectField(expression, "Value");
		return taggedCall(eitherIdentifiers.eitherTaggedError, [innerValue]);
	}

	if (renderedSource.startsWith(`${pkgPrefix}${eitherIdentifiers.rightType.value}[`)) {
		const directArgs = extractFactoryCallArguments(expression, eitherIdentifiers.rightOf.value);
		const infoArg = directArgs?.[0] ?? selectField(expression, "Information");
		const valArg = directArgs?.[1] ?? selectField(expression, "Value");
		return taggedCall(eitherIdentifiers.eitherTaggedRight, [infoArg, valArg]);
	}

	if (renderedSource.startsWith(`${pkgPrefix}${eitherIdentifiers.leftType.value}[`)) {
		const directArgs = extractFactoryCallArguments(expression, eitherIdentifiers.leftOf.value);
		const infoArg = directArgs?.[0] ?? selectField(expression, "Information");
		const leftRendered = GoPrinter.renderNode(leftType);
		const sourceIsUndefinedPayload = renderedSource.endsWith(".JSUndefined]");

		if (sourceIsUndefinedPayload && !leftRendered.endsWith(".JSUndefined")) {
			return taggedCall(eitherIdentifiers.eitherTaggedLeftEmpty, [infoArg]);
		}

		const valArg = directArgs?.[1] ?? selectField(expression, "Value");
		return taggedCall(eitherIdentifiers.eitherTaggedLeft, [infoArg, valArg]);
	}

	return undefined;
}

/**
 * Convertit une expression d'un type Go vers un autre si nécessaire.
 */
export function coerceGoExpression(
	expression: GoAST.Expression,
	sourceGoType: GoType,
	targetGoType: GoType,
	context: BuildContext,
): GoAST.Expression {
	const renderedSource = GoPrinter.renderNode(sourceGoType);
	const renderedTarget = GoPrinter.renderNode(targetGoType);

	if (
		renderedSource === renderedTarget
		|| renderedTarget === renderedAnyType
		|| (renderedTarget === renderedEitherInterface && isConcreteEitherType(sourceGoType))
	) {
		return expression;
	}

	if (renderedTarget.startsWith(eitherCompactPrefix)) {
		const wrapped = coerceToEitherCompact(expression, renderedSource, targetGoType, context);
		if (wrapped) {
			return wrapped;
		}
	}

	if (renderedTarget.startsWith(eitherOrFailPrefix)) {
		const wrapped = coerceToEitherOrFail(expression, renderedSource, targetGoType, context);
		if (wrapped) {
			return wrapped;
		}
	}

	if (renderedTarget.startsWith(eitherTaggedPrefix)) {
		const wrapped = coerceToEitherTagged(expression, renderedSource, targetGoType, context);
		if (wrapped) {
			return wrapped;
		}
	}

	// Narrowing EitherOrFail[T] -> T (après garde !DEither.isLeft).
	if (renderedSource.startsWith(eitherOrFailPrefix)) {
		const sourceArgs = getGenericTypeArguments(sourceGoType);
		const payloadType = sourceArgs && DArray.first(sourceArgs);
		if (payloadType && GoPrinter.renderNode(payloadType) === renderedTarget) {
			return selectField(expression, "Value");
		}
	}

	// Narrowing EitherCompact[T] -> EitherSuccess[T]
	if (
		renderedSource.startsWith(eitherCompactPrefix)
		&& renderedTarget.startsWith(`${pkgPrefix}${eitherIdentifiers.successType.value}[`)
	) {
		const targetArgs = getGenericTypeArguments(targetGoType);
		const payloadType = targetArgs && DArray.first(targetArgs);
		if (payloadType) {
			return callGenericRuntime({
				dependency: eitherSuccessDependency,
				fnIdentifier: eitherIdentifiers.successOf,
				typeArguments: [payloadType],
				args: [selectField(expression, "Value")],
				context,
			});
		}
	}

	if (renderedSource === renderedAnyType || renderedSource === renderedEitherInterface) {
		return GoAST.createTypeAssertionExpression({
			target: expression,
			typeReference: targetGoType,
		});
	}

	return expression;
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
