import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { GoAST } from "@go";
import { type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { type BuildContext } from "../../../context/build";
import { resolveValueType } from "../../common/valueType";
import { callExpressionTransformer } from "../../shared";
import { typeTransformers } from "../../type";
import { commonIdentifiers, commonPrintDependency } from "./sharedDependency";

/**
 * DCommon.print(value) devient shard_dependencies.CommonPrint[T](value),
 * avec T le type Go de l'argument.
 */
export async function printExpressionHandler(
	node: TsAST.Node,
	context: BuildContext,
): Promise<ReturnType<Transformer<GoAST.Expression>["transformer"]>> {
	if (TsAST.isCallExpression(node)) {
		return context.transform(node, [callExpressionTransformer]);
	}

	const call = node.parent;

	if (!call || !TsAST.isCallExpression(call) || call.expression !== node) {
		return context.error(node, "un-support-print-outside-call");
	}

	const argument = DArray.first(call.arguments);

	// print(value, "error") / print(value, { depth }) : options d'affichage console non traduites.
	if (!argument || !DArray.lengthEqual(call.arguments, 1)) {
		return context.error(call, "un-support-print-arguments");
	}

	// Type déclaré, pas le type rétréci par un if (cf. resolveValueType).
	const argumentTypeNode = await context.transpilation.typeChecker.typeToTypeNode(
		await resolveValueType(argument, context),
		call,
	);

	if (!argumentTypeNode) {
		return context.error(argument, "unrepresentable-print-argument-type");
	}

	const typeArgument = await DCommon.asyncPipe(
		context.transform(argumentTypeNode, typeTransformers.value),
		DEither.unwrapRight,
	);

	if (DEither.isLeft(typeArgument)) {
		return typeArgument;
	}

	return context.success({
		before: typeArgument.before,
		result: GoAST.createInstantiationExpression({
			target: GoAST.createSelectorExpression({
				target: context.registerSharedDependency(commonPrintDependency.value),
				identifier: commonIdentifiers.print,
			}),
			typeArguments: DCommon.cast([typeArgument.result]),
		}),
	});
}
