import { type GoAST } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { expressionTransformers } from ".";

export const parenthesizedExpressionTransformer: Transformer<GoAST.Expression> = createTransformer(
	(node, context) => {
		if (!TsAST.isParenthesizedExpression(node)) {
			return context.notSupport();
		}

		// GoPrinter gère automatiquement les parenthèses selon la priorité des opérateurs.
		return context.transform(node.expression, expressionTransformers.value);
	},
);
