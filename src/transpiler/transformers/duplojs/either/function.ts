import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { GoAST } from "@go";
import { type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { type BuildContext } from "../../../context/build";
import { undefinedShardDependency } from "../../../sharedDependency/defaults";
import {
	eitherErrorDependency,
	eitherFailDependency,
	eitherIdentifiers,
	eitherInterfaceDependency,
	eitherIsLeftAnyDependency,
	eitherIsRightAnyDependency,
	eitherLeftDependency,
	eitherOkDependency,
	eitherRightDependency,
	eitherSuccessDependency,
} from "../../../sharedDependency/either";
import { isAnyType, isEitherOrFailType, transformTypeQuietly } from "../../common/coerce";
import { resolveValueType } from "../../common/valueType";
import { expressionTransformers } from "../../expression";
import { canDirectMethodReceiver } from "../../shared/expressionPurity";

/**
 * Fonctions DEither vers le runtime Go typé :
 * - DEither.success(x)       -> shard_dependencies.EitherSuccessOf[T](x)
 * - DEither.fail()           -> shard_dependencies.EitherFailOf()
 * - DEither.left("msg", x?)  -> shard_dependencies.EitherLeftOf[T]("msg", x)
 * - DEither.isRight(e)       -> e.IsRight() (ou EitherIsRightAny(e) si e est any)
 * - DEither.isLeft(e)        -> !(e.IsRight()) (ou EitherIsLeftAny(e) si e est any)
 */

type EitherFunctionHandler = (
	node: TsAST.Node,
	context: BuildContext,
) => Promise<ReturnType<Transformer<GoAST.Expression>["transformer"]>>;

function undefinedStructLiteral(context: BuildContext) {
	return GoAST.createStructLiteral({
		typeReference: GoAST.createPackageTypeReference({
			packageName: context.registerSharedDependency(undefinedShardDependency.value),
			identifier: GoAST.createIdentifier("JSUndefined"),
		}),
		elements: [],
	});
}

function undefinedPackageType(context: BuildContext) {
	return GoAST.createPackageTypeReference({
		packageName: context.registerSharedDependency(undefinedShardDependency.value),
		identifier: GoAST.createIdentifier("JSUndefined"),
	});
}

function createZeroArgHandler(
	dependency: typeof eitherFailDependency,
	factoryIdentifier: GoAST.Identifier,
): EitherFunctionHandler {
	return (node, context) => {
		if (!TsAST.isCallExpression(node)) {
			return Promise.resolve(context.error(node, "un-support-either-function-outside-call"));
		}

		if (!DArray.lengthEqual(node.arguments, 0)) {
			return Promise.resolve(context.error(node, "un-support-either-function-arguments"));
		}

		return Promise.resolve(context.success({
			result: GoAST.createCallExpression({
				callee: GoAST.createSelectorExpression({
					target: context.registerSharedDependency(dependency.value),
					identifier: factoryIdentifier,
				}),
				arguments: [],
			}),
		}));
	};
}

function createSinglePayloadHandler(
	dependency: typeof eitherSuccessDependency,
	factoryIdentifier: GoAST.Identifier,
): EitherFunctionHandler {
	return async(node, context) => {
		if (!TsAST.isCallExpression(node)) {
			return context.error(node, "un-support-either-function-outside-call");
		}

		const argNode = DArray.first(node.arguments);

		if (!argNode || !DArray.lengthEqual(node.arguments, 1)) {
			return context.error(node, "un-support-either-function-arguments");
		}

		const transformedArg = await DCommon.asyncPipe(
			context.transform(argNode, expressionTransformers.value),
			DEither.unwrapRight,
		);

		if (DEither.isLeft(transformedArg)) {
			return transformedArg;
		}

		const payloadGoType = await transformTypeQuietly(
			await resolveValueType(argNode, context),
			argNode,
			context,
		);

		if (!payloadGoType) {
			return context.error(argNode, "unrepresentable-either-payload-type");
		}

		return context.success({
			before: transformedArg.before,
			result: GoAST.createCallExpression({
				callee: GoAST.createInstantiationExpression({
					target: GoAST.createSelectorExpression({
						target: context.registerSharedDependency(dependency.value),
						identifier: factoryIdentifier,
					}),
					typeArguments: DCommon.cast([payloadGoType]),
				}),
				arguments: [transformedArg.result],
			}),
		});
	};
}

function createMessageAndOptionalPayloadHandler(
	dependency: typeof eitherLeftDependency,
	factoryIdentifier: GoAST.Identifier,
): EitherFunctionHandler {
	return async(node, context) => {
		if (!TsAST.isCallExpression(node)) {
			return context.error(node, "un-support-either-function-outside-call");
		}

		const messageNode = DArray.at(node.arguments, 0);
		const payloadNode = DArray.at(node.arguments, 1);

		if (!messageNode || DArray.length(node.arguments) > 2) {
			return context.error(node, "un-support-either-function-arguments");
		}

		const transformedMessage = await DCommon.asyncPipe(
			context.transform(messageNode, expressionTransformers.value),
			DEither.unwrapRight,
		);

		if (DEither.isLeft(transformedMessage)) {
			return transformedMessage;
		}

		if (!payloadNode) {
			return context.success({
				before: transformedMessage.before,
				result: GoAST.createCallExpression({
					callee: GoAST.createInstantiationExpression({
						target: GoAST.createSelectorExpression({
							target: context.registerSharedDependency(dependency.value),
							identifier: factoryIdentifier,
						}),
						typeArguments: DCommon.cast([undefinedPackageType(context)]),
					}),
					arguments: [transformedMessage.result, undefinedStructLiteral(context)],
				}),
			});
		}

		const transformedPayload = await DCommon.asyncPipe(
			context.transform(payloadNode, expressionTransformers.value),
			DEither.unwrapRight,
		);

		if (DEither.isLeft(transformedPayload)) {
			return transformedPayload;
		}

		const payloadGoType = await transformTypeQuietly(
			await resolveValueType(payloadNode, context),
			payloadNode,
			context,
		);

		if (!payloadGoType) {
			return context.error(payloadNode, "unrepresentable-either-payload-type");
		}

		return context.success({
			before: DArray.concat(transformedMessage.before, transformedPayload.before),
			result: GoAST.createCallExpression({
				callee: GoAST.createInstantiationExpression({
					target: GoAST.createSelectorExpression({
						target: context.registerSharedDependency(dependency.value),
						identifier: factoryIdentifier,
					}),
					typeArguments: DCommon.cast([payloadGoType]),
				}),
				arguments: [transformedMessage.result, transformedPayload.result],
			}),
		});
	};
}

function createSideCheckHandler(expectRight: boolean): EitherFunctionHandler {
	return async(node, context) => {
		if (!TsAST.isCallExpression(node)) {
			return context.error(node, "un-support-either-function-outside-call");
		}

		const argNode = DArray.first(node.arguments);

		if (!argNode || !DArray.lengthEqual(node.arguments, 1)) {
			return context.error(node, "un-support-either-function-arguments");
		}

		const transformedArg = await DCommon.asyncPipe(
			context.transform(argNode, expressionTransformers.value),
			DEither.unwrapRight,
		);

		if (DEither.isLeft(transformedArg)) {
			return transformedArg;
		}

		const argGoType = await transformTypeQuietly(
			await resolveValueType(argNode, context),
			argNode,
			context,
		);

		// Union mixte typée any en Go (ex: []float64 | EitherFail).
		if (isAnyType(argGoType)) {
			context.registerSharedDependency(eitherInterfaceDependency.value);
			const helperDependency = expectRight
				? eitherIsRightAnyDependency
				: eitherIsLeftAnyDependency;
			const helperIdentifier = expectRight
				? eitherIdentifiers.isRightAny
				: eitherIdentifiers.isLeftAny;

			return context.success({
				before: transformedArg.before,
				result: GoAST.createCallExpression({
					callee: GoAST.createSelectorExpression({
						target: context.registerSharedDependency(helperDependency.value),
						identifier: helperIdentifier,
					}),
					arguments: [transformedArg.result],
				}),
			});
		}

		const binding = canDirectMethodReceiver(transformedArg.result)
			? undefined
			: GoAST.createShortVariableDeclarationStatement({
				identifier: context.generateIdentifier(),
				initializer: transformedArg.result,
			});

		const receiver = binding?.identifier ?? transformedArg.result;

		// Sur EitherOrFail[T], isLeft teste Failed directement et isRight renvoie false.
		if (isEitherOrFailType(argGoType)) {
			const method = expectRight ? eitherIdentifiers.isRightMethod : eitherIdentifiers.isLeftMethod;
			return context.success({
				before: binding ? DArray.push(transformedArg.before, binding) : transformedArg.before,
				result: GoAST.createCallExpression({
					callee: GoAST.createSelectorExpression({
						target: receiver,
						identifier: method,
					}),
					arguments: [],
				}),
			});
		}

		const isRightCall = GoAST.createCallExpression({
			callee: GoAST.createSelectorExpression({
				target: receiver,
				identifier: eitherIdentifiers.isRightMethod,
			}),
			arguments: [],
		});

		return context.success({
			before: binding ? DArray.push(transformedArg.before, binding) : transformedArg.before,
			result: expectRight
				? isRightCall
				: GoAST.createUnaryExpression({
					operator: "!",
					operand: isRightCall,
				}),
		});
	};
}

export const eitherFunctionHandlers = DCommon.memo(
	(): Partial<Record<string, EitherFunctionHandler>> => ({
		success: createSinglePayloadHandler(eitherSuccessDependency, eitherIdentifiers.successOf),
		error: createSinglePayloadHandler(eitherErrorDependency, eitherIdentifiers.errorOf),
		fail: createZeroArgHandler(eitherFailDependency, eitherIdentifiers.failOf),
		ok: createZeroArgHandler(eitherOkDependency, eitherIdentifiers.okOf),
		left: createMessageAndOptionalPayloadHandler(eitherLeftDependency, eitherIdentifiers.leftOf),
		right: createMessageAndOptionalPayloadHandler(eitherRightDependency, eitherIdentifiers.rightOf),
		isRight: createSideCheckHandler(true),
		isLeft: createSideCheckHandler(false),
	}),
);
