import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import * as DModeling from "@duplojs/lang/modeling";
import { GoAST } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { type BuildContext } from "../../context/build";
import { coerceGoExpression, transformTypeQuietly } from "../common/coerce";
import { resolveValueType } from "../common/valueType";
import { expressionTransformers } from ".";

// [1, "a"] devient []Value{ValueNumber(1), ValueString("a")} : type pris au checker, chaque case convertie.

async function resolveSliceType(node: TsAST.ArrayLiteralExpression, context: BuildContext) {
	const { typeChecker } = context.transpilation;
	const ownType = await transformTypeQuietly(await typeChecker.getTypeAtLocation(node), node, context);

	if (ownType) {
		return ownType;
	}

	// [] seul est typé never[] : on prend le type attendu à cet endroit.
	const contextualType = await typeChecker.getContextualType(node);

	return contextualType && await transformTypeQuietly(contextualType, node, context);
}

export const arrayLiteralTransformer: Transformer<GoAST.Expression> = createTransformer(
	async(node, context) => {
		if (!TsAST.isArrayLiteralExpression(node)) {
			return context.notSupport();
		}

		const sliceType = await resolveSliceType(node, context);

		if (!sliceType || !DModeling.hasTagValue(sliceType, "[node][type]slice")) {
			return context.error(node, "unrepresentable-array-literal-type");
		}

		const elements = await DCommon.asyncPipe(
			node.elements,
			DArray.map(async(element) => {
				if (TsAST.isSpreadElement(element) || TsAST.isOmittedExpression(element)) {
					return context.error(element, "un-support-array-literal-element");
				}

				const goElement = await DCommon.asyncPipe(
					context.transform(element, expressionTransformers.value),
					DEither.unwrapRight,
				);

				if (DEither.isLeft(goElement)) {
					return goElement;
				}

				const elementGoType = await transformTypeQuietly(
					await resolveValueType(element, context),
					element,
					context,
				);

				return {
					before: goElement.before,
					result: elementGoType
						? coerceGoExpression(goElement.result, elementGoType, sliceType.elementType, context)
						: goElement.result,
				};
			}),
			DCommon.promiseAll,
			DArray.reduce(
				DArray.reduceFrom<{
					readonly before: readonly GoAST.Statement[];
					readonly elements: readonly GoAST.Expression[];
				}>({
					before: [],
					elements: [],
				}),
				({ element, lastValue, next, exit }) => DEither.isLeft(element)
					? exit(element)
					: next({
						before: DArray.concat(lastValue.before, element.before),
						elements: DArray.push(lastValue.elements, element.result),
					}),
			),
		);

		if (DEither.isLeft(elements)) {
			return elements;
		}

		return context.success({
			before: elements.before,
			result: GoAST.createSliceLiteral({
				typeReference: sliceType,
				elements: elements.elements,
			}),
		});
	},
);
