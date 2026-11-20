import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import * as DString from "@duplojs/lang/string";
import { GoAST } from "@go";
import { type NotfoundTransformer, type TransformationError } from "@transformer";
import { TsAST } from "@typescript";
import { SignatureKind, TypeFlags, type Type } from "typescript/async";
import { type BuildContext } from "../../context/build";
import { duploFunctions, type DuploFunction, type DuploFunctionTyping } from "../duplojs/functions";
import { expressionTransformers } from "../expression";
import { coerceGoExpression, transformTypeQuietly, undefinedFor, type GoType } from "./coerce";

/**
 * Une fonction utilisée comme valeur : rappel, forme curryfiée, étape de pipe.
 * Fonction DuploJS : son Go est construit sur place par sa recette. Sinon : appel Go normal.
 */

export interface CallArgument {
	readonly expression: GoAST.Expression;
	readonly goType: GoType;
}

export interface AppliedCall {
	readonly before: readonly GoAST.Statement[];
	readonly result: GoAST.Expression;
	readonly goType: GoType;
}

export type CallableFailure = TransformationError | NotfoundTransformer;

export type ApplyResult = AppliedCall | CallableFailure;

// Arguments comme en JS : en trop, ignorés ; absents, undefined (refusé si le type ne le permet pas).
export interface Callable {
	readonly parameterCount: number;
	apply(
		callArguments: readonly CallArgument[],
		location: TsAST.Node,
		context: BuildContext,
	): Promise<ApplyResult>;
}

type DuploReference = (
	| { readonly kind: "not-duplojs" }
	| { readonly kind: "unknown"; readonly name: string }
	| { readonly kind: "known"; readonly definition: DuploFunction }
);

// DArray.coalescing → "array.coalescing" : le domaine est le dossier DuploJS qui la déclare.
export async function resolveDuploFunction(
	reference: TsAST.Expression,
	context: BuildContext,
): Promise<DuploReference> {
	if (!TsAST.isIdentifier(reference) && !TsAST.isPropertyAccessExpression(reference)) {
		return { kind: "not-duplojs" };
	}

	const moduleReference = await DCommon.asyncPipe(
		context.resolveReferenceModule(reference, "@duplojs/lang"),
		DEither.unwrapRight,
	);

	if (DEither.isLeft(moduleReference)) {
		return { kind: "not-duplojs" };
	}

	const domain = DString.extract(moduleReference.entry, /^dist\/(?<domain>[^/]+)\//)?.namedGroups?.domain;
	const name = `${domain ?? "unknown"}.${moduleReference.exportName}`;
	const definition = duploFunctions.value[name];

	return definition
		? { kind: "known", definition }
		: { kind: "unknown", name };
}

// Types résolus par le checker à cet endroit : les génériques DuploJS sont déjà remplacés.
// curried : whenIsRight(f), le résultat est celui de la fonction rendue.
export async function getDuploCallTyping(
	call: TsAST.CallExpression,
	form: "full" | "curried",
	context: BuildContext,
): Promise<DuploFunctionTyping> {
	const { typeChecker } = context.transpilation;
	const signature = await typeChecker.getResolvedSignature(call);
	const offset = form === "full" ? 1 : 0;

	const parameterTypes = await DCommon.asyncPipe(
		DArray.slice(call.arguments, offset),
		DArray.map((_argument, { index }) => typeChecker.getParameterType(signature, index + offset)),
		DCommon.promiseAll,
	);

	const returnType = await typeChecker.getReturnTypeOfSignature(signature);

	if (form === "full") {
		return {
			parameterTypes,
			resultType: returnType,
		};
	}

	const returnedSignature = DArray.first(await typeChecker.getSignaturesOfType(returnType, SignatureKind.Call));

	return {
		parameterTypes,
		resultType: returnedSignature && await typeChecker.getReturnTypeOfSignature(returnedSignature),
	};
}

function createDuploCallable(
	definition: DuploFunction,
	parameters: readonly TsAST.Expression[],
	typing: DuploFunctionTyping,
): Callable {
	return {
		parameterCount: 1,
		apply: (callArguments, location, context) => {
			// Les arguments après l'entrée (l'index de DArray.map…) sont ignorés.
			const input = DArray.first(callArguments);

			if (!input) {
				return Promise.resolve(context.error(location, "un-support-duplojs-callable-arguments"));
			}

			return definition.apply({
				input,
				parameters,
				typing,
				location,
				context,
			});
		},
	};
}

// Fonction du projet, flèche, paramètre ou variable : déjà une fonction Go.
async function createGoFunctionCallable(
	expression: TsAST.Expression,
	context: BuildContext,
): Promise<Callable | CallableFailure> {
	const { typeChecker } = context.transpilation;

	const callee = await DCommon.asyncPipe(
		context.transform(expression, expressionTransformers.value),
		DEither.unwrapRight,
	);

	if (DEither.isLeft(callee)) {
		return callee;
	}

	const signatures = await typeChecker.getSignaturesOfType(
		await typeChecker.getTypeAtLocation(expression),
		SignatureKind.Call,
	);
	const signature = DArray.first(signatures);

	// Surcharges et génériques : pas encore traduits. (typeParameters vaut [] si non générique en TS 7.)
	if (!signature || !DArray.lengthEqual(signatures, 1) || !DArray.lengthEqual(signature.typeParameters ?? [], 0)) {
		return context.error(expression, "un-support-callback-signature");
	}

	if (signature.hasRestParameter) {
		return context.error(expression, "un-support-callback-rest-parameter");
	}

	const parameterGoTypes = await DCommon.asyncPipe(
		signature.parameters,
		DArray.map(async(_parameter, { index }) => transformTypeQuietly(
			await typeChecker.getParameterType(signature, index),
			expression,
			context,
		)),
		DCommon.promiseAll,
	);

	const returnGoType = await transformTypeQuietly(
		await typeChecker.getReturnTypeOfSignature(signature),
		expression,
		context,
	);

	const representable = DArray.filter(
		parameterGoTypes,
		(goType): goType is GoType => goType !== undefined,
	);

	if (!returnGoType || DArray.length(representable) !== DArray.length(parameterGoTypes)) {
		return context.error(expression, "unrepresentable-callback-type");
	}

	return {
		parameterCount: DArray.length(representable),
		apply: (callArguments, location, applyContext) => {
			const goArguments = DArray.map(
				representable,
				(parameterGoType, { index }) => {
					const callArgument = DArray.at(callArguments, index);

					return callArgument
						? coerceGoExpression(callArgument.expression, callArgument.goType, parameterGoType, applyContext)
						: undefinedFor(parameterGoType, applyContext);
				},
			);

			const givenArguments = DArray.filter(
				goArguments,
				(goArgument): goArgument is GoAST.Expression => goArgument !== undefined,
			);

			if (DArray.length(givenArguments) !== DArray.length(goArguments)) {
				return Promise.resolve(applyContext.error(location, "un-support-callback-arity"));
			}

			return Promise.resolve({
				before: callee.before,
				result: GoAST.createCallExpression({
					callee: callee.result,
					arguments: givenArguments,
				}),
				goType: returnGoType,
			});
		},
	};
}

// DArray.coalescing, DEither.whenIsRight(f) (curryfiée : f gardée, l'entrée viendra après), ou fonction Go.
export async function resolveCallable(
	expression: TsAST.Expression,
	context: BuildContext,
): Promise<Callable | CallableFailure> {
	const isCall = TsAST.isCallExpression(expression);
	const duplo = await resolveDuploFunction(isCall ? expression.expression : expression, context);

	if (duplo.kind === "unknown") {
		return context.error(expression, `un-support-duplojs-function:${duplo.name}`);
	}

	if (duplo.kind === "not-duplojs") {
		return createGoFunctionCallable(expression, context);
	}

	const { definition } = duplo;

	if (!isCall) {
		// Passée sans l'appeler : seulement si elle n'attend que l'entrée.
		return definition.parameterCount === 0
			? createDuploCallable(definition, [], {
				parameterTypes: [],
				resultType: undefined,
			})
			: context.error(expression, "un-support-duplojs-function-reference-with-parameters");
	}

	if (!DArray.lengthEqual(expression.arguments, definition.parameterCount)) {
		return context.error(expression, "un-support-duplojs-function-arity");
	}

	return createDuploCallable(
		definition,
		expression.arguments,
		await getDuploCallTyping(expression, "curried", context),
	);
}

/**
 * Applique un rappel d'une recette (f de whenIsRight, de map…) à un seul argument.
 * callbackType : le type du rappel tel que DuploJS le déclare, résolu à cet endroit.
 * Rend undefined si le rappel ne peut jamais être appelé (paramètre de type never).
 */
export async function applyCallback(
	callbackNode: TsAST.Expression,
	callbackType: Type,
	argumentFor: (parameterGoType: GoType) => CallArgument,
	location: TsAST.Node,
	context: BuildContext,
): Promise<ApplyResult | undefined> {
	const { typeChecker } = context.transpilation;

	const signature = DArray.first(
		await typeChecker.getSignaturesOfType(callbackType, SignatureKind.Call),
	);

	if (!signature) {
		return context.error(callbackNode, "unresolvable-callback");
	}

	const callable = await resolveCallable(callbackNode, context);

	if (DEither.isLeft(callable)) {
		return callable;
	}

	if (DArray.lengthEqual(signature.parameters, 0)) {
		return callable.apply([], location, context);
	}

	const parameterType = await typeChecker.getParameterType(signature, 0);

	if (parameterType.flags & TypeFlags.Never) {
		return undefined;
	}

	// () => [-12] ignore l'argument : pas besoin de traduire son type.
	if (callable.parameterCount === 0) {
		return callable.apply([], location, context);
	}

	const parameterGoType = await transformTypeQuietly(parameterType, location, context);

	if (!parameterGoType) {
		return context.error(callbackNode, "unrepresentable-callback-parameter");
	}

	return callable.apply([argumentFor(parameterGoType)], location, context);
}
