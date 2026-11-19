import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { createTransformer, type Transformer } from "@transformer";
import type { GoAST } from "@go";
import { TsAST } from "@typescript";
import { eitherFunctionHandlers } from "./function";
import { eitherTypeHandler } from "./type";

export const duploJSEitherDeclarationTransformer: Transformer<GoAST.Declaration> = createTransformer(
	(_node, context) => context.notSupport(),
);

/**
 * Routeur des expressions : DEither.success(...), DEither.isRight(...)…
 */
export const duploJSEitherExpressionTransformer: Transformer<GoAST.Expression> = createTransformer(
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
			context.resolveReferenceModule(reference, "@duplojs/lang", /^dist\/either\//),
			DEither.unwrapRight,
		);

		if (DEither.isLeft(moduleReference)) {
			return context.notSupport();
		}

		const handler = eitherFunctionHandlers.value[moduleReference.symbol.name];

		if (!handler) {
			return context.error(node, "un-support-duplojs-either-function");
		}

		return handler(node, context);
	},
);

/**
 * Routeur des types : Success<T>, Fail, Left<I, V>… → Value.
 * (Les unions de ces types sont traitées par type/union.ts.)
 */
export const duploJSEitherTypeTransformer: Transformer<GoAST.PackageTypeReference> = createTransformer(
	(node, context) => {
		if (!TsAST.isTypeReferenceNode(node) && !TsAST.isImportTypeNode(node)) {
			return context.notSupport();
		}

		return eitherTypeHandler(node, context);
	},
);
