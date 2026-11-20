import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { GoAST } from "@go";
import { type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { type BuildContext } from "../../../context/build";
import { valueDependency, valueIdentifiers } from "../../../sharedDependency/value";
import { packValue } from "../../common/coerce";
import { resolveValueType } from "../../common/valueType";
import { expressionTransformers } from "../../expression";

/**
 * Les fonctions DEither deviennent des fonctions du runtime Value, sans générique.
 *
 *   DEither.success(3)        donne EitherSuccess(ValueNumber(3))
 *   DEither.left("zero", x)   donne EitherLeft("zero", ValueNumber(x))
 *   DEither.isRight(result)   donne EitherIsRight(result)
 *
 * Chaque argument a un rôle :
 *   - message : le message de l'Either (information en DuploJS), passé tel quel ;
 *   - content : le contenu de l'Either, emballé en Value selon son type ;
 *   - either : l'Either testé, emballé en Value s'il ne l'est pas déjà.
 * Un contenu optionnel absent vaut undefined, comme dans DEither.left("zero").
 */

type ArgumentRole = "message" | "content" | "optional-content" | "either";

interface EitherFunction {
	readonly goFunction: GoAST.Identifier;
	readonly roles: readonly ArgumentRole[];
}

type EitherFunctionHandler = (
	node: TsAST.Node,
	context: BuildContext,
) => Promise<ReturnType<Transformer<GoAST.Expression>["transformer"]>>;

function runtime(member: GoAST.Identifier, context: BuildContext) {
	return GoAST.createSelectorExpression({
		target: context.registerSharedDependency(valueDependency.value),
		identifier: member,
	});
}

async function transformArgument(
	call: TsAST.CallExpression,
	role: ArgumentRole,
	index: number,
	context: BuildContext,
) {
	const tsArgument = DArray.at(call.arguments, index);

	if (!tsArgument) {
		if (role !== "optional-content") {
			return context.error(call, "missing-either-function-argument");
		}

		// DEither.left("zero") : le contenu est undefined.
		return context.success({
			result: GoAST.createCallExpression({
				callee: runtime(valueIdentifiers.fromUndefined, context),
				arguments: [
					GoAST.createStructLiteral({
						typeReference: GoAST.createPackageTypeReference({
							packageName: context.registerSharedDependency(valueDependency.value),
							identifier: GoAST.createIdentifier("JSUndefined"),
						}),
						elements: [],
					}),
				],
			}),
		});
	}

	const argument = await DCommon.asyncPipe(
		context.transform(tsArgument, expressionTransformers.value),
		DEither.unwrapRight,
	);

	if (DEither.isLeft(argument) || role === "message") {
		return argument;
	}

	return context.success({
		before: argument.before,
		result: await packValue(
			argument.result,
			await resolveValueType(tsArgument, context),
			tsArgument,
			context,
		),
	});
}

function createEitherFunctionHandler(eitherFunction: EitherFunction): EitherFunctionHandler {
	return async(node, context) => {
		// Une fonction DEither de cette table doit être appelée, pas passée en valeur.
		if (!TsAST.isCallExpression(node)) {
			return context.error(node, "un-support-either-function-outside-call");
		}

		if (DArray.length(node.arguments) > DArray.length(eitherFunction.roles)) {
			return context.error(node, "un-support-either-function-arguments");
		}

		const transformedArguments = await DCommon.asyncPipe(
			eitherFunction.roles,
			DArray.map((role, { index }) => transformArgument(node, role, index, context)),
			DCommon.promiseAll,
			DArray.reduce(
				DArray.reduceFrom<{
					before: readonly GoAST.Statement[];
					arguments: readonly GoAST.Expression[];
				}>({
					before: [],
					arguments: [],
				}),
				({ element, lastValue, next, exit }) => {
					const unwrapped = DEither.unwrapRight(element);

					if (DEither.isLeft(unwrapped)) {
						return exit(unwrapped);
					}

					return next({
						before: DArray.concat(lastValue.before, unwrapped.before),
						arguments: DArray.push(lastValue.arguments, unwrapped.result),
					});
				},
			),
		);

		if (DEither.isLeft(transformedArguments)) {
			return transformedArguments;
		}

		return context.success({
			before: transformedArguments.before,
			result: GoAST.createCallExpression({
				callee: runtime(eitherFunction.goFunction, context),
				arguments: transformedArguments.arguments,
			}),
		});
	};
}

/**
 * La traduction de chaque fonction DEither, par son nom.
 * Ajouter une fonction ici demande aussi sa fonction dans le runtime.
 */
export const eitherFunctionHandlers = DCommon.memo(
	(): Partial<Record<string, EitherFunctionHandler>> => ({
		success: createEitherFunctionHandler({ goFunction: valueIdentifiers.success, roles: ["content"] }),
		error: createEitherFunctionHandler({ goFunction: valueIdentifiers.error, roles: ["content"] }),
		fail: createEitherFunctionHandler({ goFunction: valueIdentifiers.fail, roles: [] }),
		ok: createEitherFunctionHandler({ goFunction: valueIdentifiers.ok, roles: [] }),
		left: createEitherFunctionHandler({ goFunction: valueIdentifiers.left, roles: ["message", "optional-content"] }),
		right: createEitherFunctionHandler({ goFunction: valueIdentifiers.right, roles: ["message", "optional-content"] }),
		isRight: createEitherFunctionHandler({ goFunction: valueIdentifiers.isRight, roles: ["either"] }),
		isLeft: createEitherFunctionHandler({ goFunction: valueIdentifiers.isLeft, roles: ["either"] }),
	}),
);
