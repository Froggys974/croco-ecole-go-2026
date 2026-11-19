import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { GoAST } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { TypeFlags } from "typescript/async";
import { type BuildContext } from "../../context/build";
import { expressionTransformers } from "../expression";
import { blockStatementTransformer } from "./block";

/**
 * `if (condition) { … } else { … }` → `if condition { … } else { … }`
 *
 * - Les `before` de la condition passent AVANT le if : la condition est
 *   toujours évaluée, donc ils s'exécutent toujours (règle des before respectée).
 * - `else if` : les `before` de sa condition ne doivent s'exécuter QUE si la
 *   première condition est fausse → on les met dans le bloc else :
 *       else { before…; if condition2 { … } }
 * - Go exige un bool : une condition non booléenne (truthiness JS) est refusée.
 */

async function transformBranch(
	statement: TsAST.Statement,
	context: BuildContext,
) {
	if (!TsAST.isBlock(statement)) {
		return context.error(statement, "un-support-if-branch-without-braces");
	}

	return DCommon.asyncPipe(
		context.transform(statement, [blockStatementTransformer]),
		DEither.unwrapRight,
	);
}

async function transformElseBranch(
	statement: TsAST.Statement,
	context: BuildContext,
) {
	if (!TsAST.isIfStatement(statement)) {
		return transformBranch(statement, context);
	}

	const elseIf = await DCommon.asyncPipe(
		context.transform(statement, [ifStatementTransformer]),
		DEither.unwrapRight,
	);

	if (DEither.isLeft(elseIf)) {
		return elseIf;
	}

	if (DArray.lengthEqual(elseIf.before, 0)) {
		return {
			before: elseIf.before,
			result: elseIf.result,
		};
	}

	return {
		before: [],
		result: GoAST.createBlockStatement({
			statements: DArray.push(elseIf.before, elseIf.result),
		}),
	};
}

export const ifStatementTransformer: Transformer<GoAST.IfStatement> = createTransformer(
	async(node, context) => {
		if (!TsAST.isIfStatement(node)) {
			return context.notSupport();
		}

		const conditionType = await context.transpilation.typeChecker.getTypeAtLocation(node.expression);

		if (!(conditionType.flags & TypeFlags.BooleanLike)) {
			return context.error(node.expression, "un-support-non-boolean-if-condition");
		}

		const condition = await DCommon.asyncPipe(
			context.transform(node.expression, expressionTransformers.value),
			DEither.unwrapRight,
		);

		if (DEither.isLeft(condition)) {
			return condition;
		}

		const body = await transformBranch(node.thenStatement, context);

		if (DEither.isLeft(body)) {
			return body;
		}

		const elseBranch = node.elseStatement
			? await transformElseBranch(node.elseStatement, context)
			: undefined;

		if (elseBranch && DEither.isLeft(elseBranch)) {
			return elseBranch;
		}

		return context.success({
			before: condition.before,
			result: GoAST.createIfStatement({
				condition: condition.result,
				body: body.result,
				elseBranch: elseBranch?.result,
			}),
		});
	},
);
