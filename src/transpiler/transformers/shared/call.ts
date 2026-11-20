import { TsAST } from "@typescript";
import { GoAST } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import * as DCommon from "@duplojs/lang/common";
import { expressionTransformers } from "../expression";
import * as DEither from "@duplojs/lang/either";
import * as DArray from "@duplojs/lang/array";
import { type BuildContext } from "../../context/build";
import { coerceExpression } from "../common/coerce";
import { resolveValueType } from "../common/valueType";
import { isDirectCallCallee, isPureGoExpression } from "./expressionPurity";

async function isDuploJSCall(call: TsAST.CallExpression, context: BuildContext) {
	const callee = call.expression;

	if (!TsAST.isIdentifier(callee) && !TsAST.isPropertyAccessExpression(callee)) {
		return false;
	}

	const moduleReference = await DCommon.asyncPipe(
		context.resolveReferenceModule(callee, "@duplojs/lang"),
		DEither.unwrapRight,
	);

	return !DEither.isLeft(moduleReference);
}

export const callExpressionTransformer: Transformer<GoAST.CallExpression> = createTransformer(
	async(rawNode, context) => {
		const node = TsAST.isExpressionStatement(rawNode)
			? rawNode.expression
			: rawNode;
		if (!TsAST.isCallExpression(node)) {
			return context.notSupport();
		}

		const callee = await DCommon.asyncPipe(
			context.transform(node.expression, expressionTransformers.value),
			DEither.unwrapRight,
		);

		if (DEither.isLeft(callee)) {
			return callee;
		}

		const functionVariableStatement = isDirectCallCallee(callee.result)
			? undefined
			: GoAST.createShortVariableDeclarationStatement({
				identifier: context.generateIdentifier(),
				initializer: callee.result,
			});

		const { typeChecker } = context.transpilation;

		// Frontière : chaque argument doit avoir le type du paramètre (cf. coerceExpression).
		// Pas pour les fonctions DuploJS : leur runtime Go est déjà instancié avec
		// les types des arguments eux-mêmes.
		const signature = await isDuploJSCall(node, context)
			? undefined
			: await typeChecker.getResolvedSignature(node);

		const argumentsResult = await DCommon.asyncPipe(
			node.arguments,
			DArray.map(
				async(tsArgument, { index }) => {
					const argument = await DCommon.asyncPipe(
						context.transform(tsArgument, expressionTransformers.value),
						DEither.unwrapRight,
					);

					if (DEither.isLeft(argument) || !signature) {
						return argument;
					}

					const coerced = await DCommon.asyncPipe(
						coerceExpression(
							argument.result,
							await resolveValueType(tsArgument, context),
							await typeChecker.getParameterType(signature, index),
							tsArgument,
							context,
						),
						DEither.unwrapRight,
					);

					if (DEither.isLeft(coerced)) {
						return coerced;
					}

					return {
						before: argument.before,
						result: coerced.result,
					};
				},
			),
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
					if (DEither.isLeft(element)) {
						return exit(element);
					}

					if (isPureGoExpression(element.result)) {
						return next({
							before: DArray.concat(
								lastValue.before,
								element.before,
							),
							arguments: DArray.push(
								lastValue.arguments,
								element.result,
							),
						});
					}

					const argumentVariableStatement = GoAST.createShortVariableDeclarationStatement({
						identifier: context.generateIdentifier(),
						initializer: element.result,
					});

					return next({
						before: DArray.concat(
							lastValue.before,
							element.before,
							[argumentVariableStatement],
						),
						arguments: DArray.push(
							lastValue.arguments,
							argumentVariableStatement.identifier,
						),
					});
				},
			),
		);

		if (DEither.isLeft(argumentsResult)) {
			return argumentsResult;
		}

		return context.success({
			before: DArray.concat(
				callee.before,
				functionVariableStatement ? [functionVariableStatement] : [],
				argumentsResult.before,
			),
			result: GoAST.createCallExpression({
				callee: functionVariableStatement?.identifier ?? callee.result,
				arguments: argumentsResult.arguments,
			}),
		});
	},
);
