import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { GoAST } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { typeTransformers } from ".";

/**
 * Les types fonction TS deviennent des types fonction Go :
 *
 *   (n: number) => number   devient   func(Sourced_n float64) float64
 *
 * C'est ce qui permet à une fonction d'en recevoir une autre en paramètre (un rappel).
 * Les paramètres sans nom simple ou variadiques (...rest) sont refusés pour l'instant.
 */
export const functionTypeTransformer: Transformer<GoAST.FunctionType> = createTransformer(
	async(node, context) => {
		if (!TsAST.isFunctionTypeNode(node)) {
			return context.notSupport();
		}

		const functionArguments = await DCommon.asyncPipe(
			node.parameters,
			DArray.map(async(parameter) => {
				if (!TsAST.isIdentifier(parameter.name) || parameter.dotDotDotToken || !parameter.type) {
					return context.error(parameter, "un-support-function-type-parameter");
				}

				const parameterType = await DCommon.asyncPipe(
					context.transform(parameter.type, typeTransformers.value),
					DEither.unwrapRight,
				);

				if (DEither.isLeft(parameterType)) {
					return parameterType;
				}

				return GoAST.createFunctionArgument({
					identifier: context.createSourceIdentifier(parameter.name.text),
					type: parameterType.result,
				});
			}),
			DCommon.promiseAll,
			DArray.reduce(
				DArray.reduceFrom<readonly GoAST.FunctionArgument[]>([]),
				({ element, lastValue, next, exit }) => DEither.isLeft(element)
					? exit(element)
					: next(DArray.push(lastValue, element)),
			),
		);

		if (DEither.isLeft(functionArguments)) {
			return functionArguments;
		}

		if (!node.type) {
			return context.error(node, "un-support-function-type-without-return");
		}

		const returnType = await DCommon.asyncPipe(
			context.transform(node.type, typeTransformers.value),
			DEither.unwrapRight,
		);

		if (DEither.isLeft(returnType)) {
			return returnType;
		}

		return context.success({
			result: GoAST.createFunctionType({
				arguments: functionArguments,
				returnTypes: [returnType.result],
			}),
		});
	},
);
