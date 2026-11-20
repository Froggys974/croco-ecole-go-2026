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
 * Routeur des fonctions DEither : success, fail, error, ok, left, right, isRight, isLeft.
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
 * Routeur des types Either : Success<T>, Fail, Ok, Error<T>, Left<I, V>, Right<I, V>.
 * Les unions d'Either passent par type/union.ts et deviennent shard_dependencies.Either.
 */
export const duploJSEitherTypeTransformer: Transformer<GoAST.Type | GoAST.TypeReference> = createTransformer(
	(node, context) => {
		if (!TsAST.isTypeReferenceNode(node) && !TsAST.isImportTypeNode(node)) {
			return context.notSupport();
		}

		return eitherTypeHandler(node, context);
	},
);
