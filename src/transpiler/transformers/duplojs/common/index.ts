import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { createTransformer, type Transformer } from "@transformer";
import type { GoAST } from "@go";
import { TsAST } from "@typescript";
import { printExpressionHandler } from "./print";

const commonFunctionHandlers: Partial<Record<string, typeof printExpressionHandler>> = {
	print: printExpressionHandler,
};

/**
 * Routeur des expressions DCommon : DCommon.print(...)…
 */
export const duploJSCommonExpressionTransformer: Transformer<GoAST.Expression> = createTransformer(
	async(node, context) => {
		const reference = TsAST.isCallExpression(node)
			? node.expression
			: node;

		if (
			!TsAST.isIdentifier(reference)
			&& !TsAST.isPropertyAccessExpression(reference)
		) {
			return context.notSupport();
		}

		const moduleReference = await DCommon.asyncPipe(
			context.resolveReferenceModule(reference, "@duplojs/lang", /^dist\/common\//),
			DEither.unwrapRight,
		);

		if (DEither.isLeft(moduleReference)) {
			return context.notSupport();
		}

		const handler = commonFunctionHandlers[moduleReference.symbol.name];

		if (!handler) {
			return context.error(node, "un-support-duplojs-common-function");
		}

		return handler(node, context);
	},
);
