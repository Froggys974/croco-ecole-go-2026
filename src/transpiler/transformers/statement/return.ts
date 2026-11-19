import { TsAST } from "@typescript";
import { GoAST } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { expressionTransformers } from "../expression";
import { coerceExpression, findEnclosingFunction } from "../common/coerce";
import { resolveValueType } from "../common/valueType";

export const returnStatementTransformer: Transformer<GoAST.ReturnStatement> = createTransformer(
	async(node, context) => {
		if (!TsAST.isReturnStatement(node) || !node.expression) {
			return context.notSupport();
		}

		const expression = await DCommon.asyncPipe(
			context.transform(node.expression, expressionTransformers.value),
			DEither.unwrapRight,
		);

		if (DEither.isLeft(expression)) {
			return expression;
		}

		const enclosingFunction = findEnclosingFunction(node);

		if (!enclosingFunction) {
			return context.error(node, "un-support-return-outside-function");
		}

		// Frontière : la valeur rendue doit avoir le type de retour de la fonction.
		const { typeChecker } = context.transpilation;
		const signature = await typeChecker.getSignatureFromDeclaration(enclosingFunction);

		const value = await DCommon.asyncPipe(
			coerceExpression(
				expression.result,
				await resolveValueType(node.expression, context),
				await typeChecker.getReturnTypeOfSignature(signature),
				node.expression,
				context,
			),
			DEither.unwrapRight,
		);

		if (DEither.isLeft(value)) {
			return value;
		}

		return context.success({
			before: expression.before,
			result: GoAST.createReturnStatement({
				values: [value.result],
			}),
		});
	},
);
