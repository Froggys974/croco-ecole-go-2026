import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { GoAST, GoPrinter } from "@go";
import { sharedDependencyPackageName } from "@transformer";
import { TsAST } from "@typescript";
import { NodeBuilderFlags, type Type } from "typescript/async";
import { type BuildContext } from "../../context/build";
import { eitherIdentifiers } from "../../sharedDependency/either";
import { typeTransformers } from "../type";

/**
 * Passages de types Go aux frontières (return, argument d'appel, variable typée, pipe)
 * pour les structs typées, l'interface Either et any sur unions mixtes.
 *
 * - T vers Either ou any  : rien à faire, Go assigne directement.
 * - any vers T concret    : assertion de type x.(T) (sûre après narrowing TS).
 * - Either vers Either*   : assertion de type x.(Either*) (après narrowing TS).
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

const renderedAnyType = GoPrinter.renderNode(GoAST.builtinTypeReferences.any);
const renderedEitherInterface = GoPrinter.renderNode(
	GoAST.createPackageTypeReference({
		packageName: sharedDependencyPackageName,
		identifier: eitherIdentifiers.interface,
	}),
);
const concreteEitherPrefixes = [
	`${sharedDependencyPackageName.value}.${eitherIdentifiers.successType.value}`,
	`${sharedDependencyPackageName.value}.${eitherIdentifiers.errorType.value}`,
	`${sharedDependencyPackageName.value}.${eitherIdentifiers.failType.value}`,
	`${sharedDependencyPackageName.value}.${eitherIdentifiers.okType.value}`,
	`${sharedDependencyPackageName.value}.${eitherIdentifiers.leftType.value}`,
	`${sharedDependencyPackageName.value}.${eitherIdentifiers.rightType.value}`,
];

export function isAnyType(goType: GoType | undefined) {
	return goType !== undefined && GoPrinter.renderNode(goType) === renderedAnyType;
}

export function isEitherInterfaceType(goType: GoType | undefined) {
	return goType !== undefined && GoPrinter.renderNode(goType) === renderedEitherInterface;
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

/**
 * Convertit une expression d'un type Go vers un autre si une assertion est nécessaire.
 */
export function coerceGoExpression(
	expression: GoAST.Expression,
	sourceGoType: GoType,
	targetGoType: GoType,
	_context: BuildContext,
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
