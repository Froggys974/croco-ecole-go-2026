import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { GoAST } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { TypeFlags } from "typescript/async";
import { expressionTransformers } from ".";

/**
 * Les opérations avec un seul côté, placées devant une valeur :
 *
 *   -x   devient   -x   (x doit être un nombre)
 *   !x   devient   !x   (x doit être un booléen)
 *
 * Pour TypeScript, -1 n'est pas un nombre mais l'opération moins appliquée à 1.
 * Sans ce transformer, un simple nombre négatif ne pouvait pas être traduit.
 *
 * Go est plus strict que JS : !0 ou -"3" n'ont pas de sens en Go, ils sont refusés.
 */

const unaryOperators: Partial<Record<TsAST.SyntaxKind, {
	readonly goOperator: GoAST.UnaryOperator;
	readonly operandFlags: TypeFlags;
}>> = {
	[TsAST.SyntaxKind.MinusToken]: {
		goOperator: "-",
		operandFlags: TypeFlags.NumberLike,
	},
	[TsAST.SyntaxKind.ExclamationToken]: {
		goOperator: "!",
		operandFlags: TypeFlags.BooleanLike,
	},
};

export const unaryExpressionTransformer: Transformer<GoAST.Expression> = createTransformer(
	async(node, context) => {
		if (!TsAST.isPrefixUnaryExpression(node)) {
			return context.notSupport();
		}

		const operator = unaryOperators[node.operator];

		if (!operator) {
			return context.notSupport();
		}

		const operandType = await context.transpilation.typeChecker.getTypeAtLocation(node.operand);

		if (!(operandType.flags & operator.operandFlags)) {
			return context.error(node, "un-support-unary-operand-type");
		}

		const operand = await DCommon.asyncPipe(
			context.transform(node.operand, expressionTransformers.value),
			DEither.unwrapRight,
		);

		if (DEither.isLeft(operand)) {
			return operand;
		}

		return context.success({
			before: operand.before,
			result: GoAST.createUnaryExpression({
				operator: operator.goOperator,
				operand: operand.result,
			}),
		});
	},
);
