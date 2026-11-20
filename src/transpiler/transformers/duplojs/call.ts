import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import type { GoAST } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { getDuploCallTyping, resolveDuploFunction } from "../common/callable";
import { transformTypeQuietly } from "../common/coerce";
import { resolveValueType } from "../common/valueType";
import { expressionTransformers } from "../expression";

/**
 * Appel complet d'une fonction DuploJS du registre (voir duplojs/functions.ts) :
 *
 *   DArray.coalescing(x)
 *   DEither.whenIsRight(result, DArray.coalescing)
 *
 * Le premier argument est l'entrée. Il est traduit en Go avec son type déclaré.
 * Les autres arguments sont donnés tels quels à la recette, qui en fait des rappels si besoin.
 *
 * La forme curryfiée gardée dans une variable (const f = whenIsRight(g)) demanderait
 * une closure Go, elle est refusée pour l'instant. Dans un pipe, elle est appliquée directement.
 */
export const duploJSFunctionCallTransformer: Transformer<GoAST.Expression> = createTransformer(
	async(node, context) => {
		if (!TsAST.isCallExpression(node)) {
			return context.notSupport();
		}

		const duplo = await resolveDuploFunction(node.expression, context);

		// Pas dans le registre : les autres routeurs DuploJS s'en chargent (DEither.success par exemple).
		if (duplo.kind !== "known") {
			return context.notSupport();
		}

		const { definition } = duplo;

		if (DArray.lengthEqual(node.arguments, definition.parameterCount)) {
			return context.error(node, "un-support-curried-duplojs-function-as-value");
		}

		const inputNode = DArray.first(node.arguments);

		if (!inputNode || !DArray.lengthEqual(node.arguments, definition.parameterCount + 1)) {
			return context.error(node, "un-support-duplojs-function-arity");
		}

		const input = await DCommon.asyncPipe(
			context.transform(inputNode, expressionTransformers.value),
			DEither.unwrapRight,
		);

		if (DEither.isLeft(input)) {
			return input;
		}

		const inputGoType = await transformTypeQuietly(
			await resolveValueType(inputNode, context),
			inputNode,
			context,
		);

		if (!inputGoType) {
			return context.error(inputNode, "unrepresentable-duplojs-input-type");
		}

		const applied = await definition.apply({
			input: {
				expression: input.result,
				goType: inputGoType,
			},
			parameters: DArray.slice(node.arguments, 1),
			typing: await getDuploCallTyping(node, "full", context),
			location: node,
			context,
		});

		if (DEither.isLeft(applied)) {
			return applied;
		}

		return context.success({
			before: DArray.concat(input.before, applied.before),
			result: applied.result,
		});
	},
);
