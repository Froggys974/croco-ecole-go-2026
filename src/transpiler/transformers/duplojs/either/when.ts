import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import * as DModeling from "@duplojs/lang/modeling";
import { GoAST } from "@go";
import { type TsAST } from "@typescript";
import { type Type } from "typescript/async";
import { type BuildContext } from "../../../context/build";
import { valueDependency, valueIdentifiers } from "../../../sharedDependency/value";
import { applyCallback, type AppliedCall, type ApplyResult, type CallArgument } from "../../common/callable";
import { coerceGoExpression, isValueType, transformTypeQuietly, unpackEitherContent, type GoType } from "../../common/coerce";
import { type DuploFunction } from "../functions";

/**
 * whenIsRight(input, f)             Right ? f(contenu) : input
 * whenIsRightOtherwise(input, f, g) Right ? f(contenu) : g(input)
 * Idem pour Left. Go : func() Value { if EitherIsRight(e) { … }; … }()
 */

type EitherSide = "right" | "left";

function returnApplied(
	applied: AppliedCall,
	resultGoType: GoType,
	context: BuildContext,
): readonly GoAST.Statement[] {
	return DArray.push(
		applied.before,
		GoAST.createReturnStatement({
			values: [coerceGoExpression(applied.result, applied.goType, resultGoType, context)],
		}),
	);
}

interface WhenParams {
	readonly side: EitherSide;
	readonly input: CallArgument;
	readonly resultType: Type;
	// undefined : branche morte.
	readonly onSide: (either: GoAST.Expression) => Promise<ApplyResult | undefined>;
	readonly otherwise: (either: GoAST.Expression) => Promise<ApplyResult | undefined>;
	readonly location: TsAST.Node;
	readonly context: BuildContext;
}

// _ = e : l'entrée reste calculée, et Go ne refuse pas une variable devenue inutilisée.
function singleBranch(
	branch: AppliedCall,
	before: readonly GoAST.Statement[],
	either: GoAST.Expression,
	resultGoType: GoType,
	context: BuildContext,
): AppliedCall {
	return {
		before: DArray.concat(
			before,
			[
				GoAST.createAssignmentStatement({
					targets: DCommon.cast([GoAST.createIdentifier("_")]),
					values: DCommon.cast([either]),
				}),
			],
			branch.before,
		),
		result: coerceGoExpression(branch.result, branch.goType, resultGoType, context),
		goType: resultGoType,
	};
}

async function buildWhen(params: WhenParams): Promise<ApplyResult> {
	const { input, location, context } = params;

	const resultGoType = await transformTypeQuietly(params.resultType, location, context);

	if (!resultGoType) {
		return context.error(location, "unrepresentable-when-either-result");
	}

	// Pas une Value, donc jamais un Either : seule la branche sinon existe.
	if (!isValueType(input.goType)) {
		const otherwise = await params.otherwise(input.expression);

		if (!otherwise || DEither.isLeft(otherwise)) {
			return otherwise ?? context.error(location, "unresolvable-when-either-branch");
		}

		return {
			before: otherwise.before,
			result: coerceGoExpression(otherwise.result, otherwise.goType, resultGoType, context),
			goType: resultGoType,
		};
	}

	// L'entrée sert deux fois : un appel est rangé dans une variable pour n'être calculé qu'une fois.
	const binding = DModeling.hasTagValue(input.expression, "[node]identifier")
		? undefined
		: GoAST.createShortVariableDeclarationStatement({
			identifier: context.generateIdentifier(),
			initializer: input.expression,
		});

	const before = binding ? [binding] : [];
	const either = binding?.identifier ?? input.expression;

	const onSide = await params.onSide(either);

	if (onSide && DEither.isLeft(onSide)) {
		return onSide;
	}

	const otherwise = await params.otherwise(either);

	if (otherwise && DEither.isLeft(otherwise)) {
		return otherwise;
	}

	if (!onSide || !otherwise) {
		const branch = onSide ?? otherwise;

		return branch
			? singleBranch(branch, before, either, resultGoType, context)
			: context.error(location, "unresolvable-when-either-branch");
	}

	const isSide = GoAST.createCallExpression({
		callee: GoAST.createSelectorExpression({
			target: context.registerSharedDependency(valueDependency.value),
			identifier: params.side === "right"
				? valueIdentifiers.isRight
				: valueIdentifiers.isLeft,
		}),
		arguments: [either],
	});

	return {
		before,
		result: GoAST.createCallExpression({
			callee: GoAST.createFunctionLiteral({
				arguments: [],
				returnTypes: [resultGoType],
				body: GoAST.createBlockStatement({
					statements: DArray.concat(
						[
							GoAST.createIfStatement({
								condition: isSide,
								body: GoAST.createBlockStatement({
									statements: returnApplied(onSide, resultGoType, context),
								}),
							}),
						],
						returnApplied(otherwise, resultGoType, context),
					),
				}),
			}),
			arguments: [],
		}),
		goType: resultGoType,
	};
}

// f reçoit le contenu, sorti de la Value : e.Number().
function applyOnContent(
	callbackNode: TsAST.Expression,
	callbackType: Type,
	location: TsAST.Node,
	context: BuildContext,
) {
	return (either: GoAST.Expression) => applyCallback(
		callbackNode,
		callbackType,
		(contentGoType) => ({
			expression: unpackEitherContent(either, contentGoType),
			goType: contentGoType,
		}),
		location,
		context,
	);
}

function createWhen(side: EitherSide): DuploFunction {
	return {
		parameterCount: 1,
		apply: async({ input, parameters, typing, location, context }) => {
			const callbackNode = DArray.first(parameters);
			const callbackType = DArray.first(typing.parameterTypes);

			if (!callbackNode || !callbackType || !typing.resultType) {
				return context.error(location, "unresolvable-when-either-typing");
			}

			return buildWhen({
				side,
				input,
				resultType: typing.resultType,
				onSide: applyOnContent(callbackNode, callbackType, location, context),
				otherwise: (either) => Promise.resolve({
					before: [],
					result: either,
					goType: input.goType,
				}),
				location,
				context,
			});
		},
	};
}

// g reçoit l'entrée entière, pas son contenu (comme DuploJS).
function createWhenOtherwise(side: EitherSide): DuploFunction {
	return {
		parameterCount: 2,
		apply: async({ input, parameters, typing, location, context }) => {
			const callbackNode = DArray.first(parameters);
			const callbackType = DArray.first(typing.parameterTypes);
			const otherwiseNode = DArray.at(parameters, 1);
			const otherwiseType = DArray.at(typing.parameterTypes, 1);

			if (!callbackNode || !callbackType || !otherwiseNode || !otherwiseType || !typing.resultType) {
				return context.error(location, "unresolvable-when-either-typing");
			}

			return buildWhen({
				side,
				input,
				resultType: typing.resultType,
				onSide: applyOnContent(callbackNode, callbackType, location, context),
				otherwise: (either) => applyCallback(
					otherwiseNode,
					otherwiseType,
					() => ({
						expression: either,
						goType: input.goType,
					}),
					location,
					context,
				),
				location,
				context,
			});
		},
	};
}

export const eitherWhenIsRight = createWhen("right");
export const eitherWhenIsRightOtherwise = createWhenOtherwise("right");
export const eitherWhenIsLeft = createWhen("left");
export const eitherWhenIsLeftOtherwise = createWhenOtherwise("left");
