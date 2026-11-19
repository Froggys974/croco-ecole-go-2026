import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import * as DString from "@duplojs/lang/string";
import { GoAST } from "@go";
import { type NotfoundTransformer, type TransformationError } from "@transformer";
import { TsAST } from "@typescript";
import { SignatureKind } from "typescript/async";
import { type BuildContext } from "../../context/build";
import { duploFunctions, type DuploFunction, type DuploFunctionTyping } from "../duplojs/functions";
import { expressionTransformers } from "../expression";
import { coerceGoExpression, transformTypeQuietly, type GoType } from "./coerce";

/**
 * Une fonction utilisée comme une valeur : donnée en argument (rappel),
 * appliquée à moitié (forme curryfiée), ou étape d'un pipe.
 *
 * Un appelable sait faire une seule chose : s'appliquer à des arguments.
 *
 *   - Fonction DuploJS (DArray.coalescing, DEither.whenIsRight(f)) : elle n'existe pas
 *     en Go, son code est donc construit sur place avec les types de cet endroit.
 *   - Tout le reste (fonction du projet, paramètre, variable) : c'est déjà une fonction Go,
 *     on l'appelle normalement. Le compilateur Go l'optimise lui-même.
 *
 * Les types circulent en types Go : ce sont eux qui décident d'emballer ou de déballer.
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

export interface Callable {
	apply(
		callArguments: readonly CallArgument[],
		location: TsAST.Node,
		context: BuildContext,
	): Promise<ApplyResult>;
}

// --- Fonctions DuploJS ---------------------------------------------------------

type DuploReference = (
	| { readonly kind: "not-duplojs" }
	| { readonly kind: "unknown"; readonly name: string }
	| { readonly kind: "known"; readonly definition: DuploFunction }
);

/**
 * Retrouve la recette d'une fonction DuploJS. DArray.coalescing donne la clé array.coalescing,
 * le domaine (array, either, string) venant du fichier DuploJS qui déclare la fonction.
 */
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

/**
 * Les types TS d'un appel DuploJS, donnés par le checker à cet endroit.
 * Les génériques DuploJS y sont déjà résolus, donc aucun générique côté Go.
 *
 *   forme complète  whenIsRight(input, f) : les paramètres après l'entrée, et le type de retour
 *   forme curryfiée whenIsRight(f)        : tous les paramètres, et le retour de la fonction rendue
 */
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
		apply: (callArguments, location, context) => {
			const input = DArray.first(callArguments);

			if (!input || !DArray.lengthEqual(callArguments, 1)) {
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

// --- Valeurs func Go (fonction du projet, paramètre, variable) -----------------

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

	// Surcharges et fonctions génériques : pas encore traduites (cf. duplication par type).
	if (!signature || !DArray.lengthEqual(signatures, 1) || signature.typeParameters) {
		return context.error(expression, "un-support-callback-signature");
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
		apply: (callArguments, location, applyContext) => {
			// Un rappel DuploJS peut recevoir moins d'arguments que prévu, jamais plus.
			if (DArray.length(callArguments) !== DArray.length(representable)) {
				return Promise.resolve(applyContext.error(location, "un-support-callback-arity"));
			}

			return Promise.resolve({
				// La fonction est évaluée là où elle est appelée : pour un nom de
				// fonction ou de variable, c'est sans effet de bord.
				before: callee.before,
				result: GoAST.createCallExpression({
					callee: callee.result,
					arguments: DArray.map(
						callArguments,
						(callArgument, { index }) => {
							const parameterGoType = DArray.at(representable, index);

							return parameterGoType
								? coerceGoExpression(callArgument.expression, callArgument.goType, parameterGoType, applyContext)
								: callArgument.expression;
						},
					),
				}),
				goType: returnGoType,
			});
		},
	};
}

// --- Le point d'entrée ---------------------------------------------------------

/**
 * Transforme une expression TS utilisée comme fonction en appelable.
 *
 *   DArray.coalescing        fonction DuploJS qui n'attend que l'entrée
 *   DEither.whenIsRight(f)   fonction DuploJS curryfiée : f est gardée, l'entrée viendra plus tard
 *   double, f                fonction Go ordinaire
 */
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
