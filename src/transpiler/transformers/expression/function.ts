import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { GoAST } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { type Signature, type Type } from "typescript/async";
import { type BuildContext } from "../../context/build";
import { coerceExpression, transformTypeQuietly } from "../common/coerce";
import { resolveValueType } from "../common/valueType";
import { blockStatementTransformer } from "../statement/block";
import { expressionTransformers } from ".";

/**
 * (n: number) => n * 2  devient  func(Sourced_n float64) float64 { return Sourced_n * 2 }
 * Types pris au checker : un paramètre non annoté a le type de son contexte.
 */

async function transformParameter(
	parameter: TsAST.ParameterDeclaration,
	index: number,
	signature: Signature,
	context: BuildContext,
) {
	if (
		!TsAST.isIdentifier(parameter.name)
		|| parameter.name.text === "this"
		|| parameter.dotDotDotToken
		|| parameter.questionToken
		|| parameter.initializer
	) {
		return context.error(parameter, "un-support-function-expression-parameter");
	}

	const goType = await transformTypeQuietly(
		await context.transpilation.typeChecker.getParameterType(signature, index),
		parameter,
		context,
	);

	if (!goType) {
		return context.error(parameter, "unrepresentable-function-expression-parameter");
	}

	return GoAST.createFunctionArgument({
		identifier: context.createSourceIdentifier(parameter.name.text),
		type: goType,
	});
}

// Les return du bloc sont convertis au type de retour par statement/return.ts.
async function transformBlockBody(body: TsAST.Block, context: BuildContext) {
	const block = await DCommon.asyncPipe(
		context.transform(body, [blockStatementTransformer]),
		DEither.unwrapRight,
	);

	if (DEither.isLeft(block)) {
		return block;
	}

	if (!DArray.lengthEqual(block.before, 0)) {
		return context.error(body, "un-support-before-on-block-statement");
	}

	return block.result;
}

// x => x * 2 devient { return x * 2 }.
async function transformExpressionBody(
	body: TsAST.Expression,
	returnType: Type,
	context: BuildContext,
) {
	const expression = await DCommon.asyncPipe(
		context.transform(body, expressionTransformers.value),
		DEither.unwrapRight,
	);

	if (DEither.isLeft(expression)) {
		return expression;
	}

	const value = await DCommon.asyncPipe(
		coerceExpression(
			expression.result,
			await resolveValueType(body, context),
			returnType,
			body,
			context,
		),
		DEither.unwrapRight,
	);

	if (DEither.isLeft(value)) {
		return value;
	}

	return GoAST.createBlockStatement({
		statements: DArray.push(
			expression.before,
			GoAST.createReturnStatement({ values: [value.result] }),
		),
	});
}

export const functionExpressionTransformer: Transformer<GoAST.FunctionLiteral> = createTransformer(
	async(node, context) => {
		if (!TsAST.isArrowFunction(node) && !TsAST.isFunctionExpression(node)) {
			return context.notSupport();
		}

		// Nommée, elle pourrait s'appeler elle-même : pas encore traduit.
		if (node.typeParameters || (TsAST.isFunctionExpression(node) && (node.name || node.asteriskToken))) {
			return context.error(node, "un-support-function-expression");
		}

		const { typeChecker } = context.transpilation;
		const signature = await typeChecker.getSignatureFromDeclaration(node);

		const parameters = await DCommon.asyncPipe(
			node.parameters,
			DArray.map((parameter, { index }) => transformParameter(parameter, index, signature, context)),
			DCommon.promiseAll,
			DArray.reduce(
				DArray.reduceFrom<readonly GoAST.FunctionArgument[]>([]),
				({ element, lastValue, next, exit }) => DEither.isLeft(element)
					? exit(element)
					: next(DArray.push(lastValue, element)),
			),
		);

		if (DEither.isLeft(parameters)) {
			return parameters;
		}

		const returnType = await typeChecker.getReturnTypeOfSignature(signature);
		const returnGoType = await transformTypeQuietly(returnType, node, context);

		if (!returnGoType) {
			return context.error(node, "unrepresentable-function-expression-return");
		}

		const body = TsAST.isBlock(node.body)
			? await transformBlockBody(node.body, context)
			: await transformExpressionBody(node.body, returnType, context);

		if (DEither.isLeft(body)) {
			return body;
		}

		return context.success({
			result: GoAST.createFunctionLiteral({
				arguments: parameters,
				returnTypes: [returnGoType],
				body,
			}),
		});
	},
);
