import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import * as DModeling from "@duplojs/lang/modeling";
import type { GoAST } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { expressionTransformers } from "../expression";

/**
 * Un appel seul sur sa ligne, comme f(x);
 * Il passe par les transformers d'expression, donc les routeurs DuploJS peuvent le traiter.
 * Go n'accepte qu'un appel comme instruction, le reste est refusé.
 */
export const expressionStatementTransformer: Transformer<GoAST.Statement> = createTransformer(
	async(node, context) => {
		if (!TsAST.isExpressionStatement(node) || !TsAST.isCallExpression(node.expression)) {
			return context.notSupport();
		}

		const expression = await DCommon.asyncPipe(
			context.transform(node.expression, expressionTransformers.value),
			DEither.unwrapRight,
		);

		if (DEither.isLeft(expression)) {
			return expression;
		}

		if (!DModeling.hasTagValue(expression.result, "[node][expression][statement]call")) {
			return context.error(node, "un-support-non-call-expression-statement");
		}

		return context.success({
			before: expression.before,
			result: expression.result,
		});
	},
);
