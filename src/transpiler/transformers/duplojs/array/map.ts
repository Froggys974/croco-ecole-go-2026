import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import * as DModeling from "@duplojs/lang/modeling";
import { GoAST } from "@go";
import { applyCallback } from "../../common/callable";
import { coerceGoExpression, transformTypeQuietly } from "../../common/coerce";
import { type DuploFunction } from "../functions";

/**
 * DArray.map(xs, f) :
 *   func() []U { out := make([]U, len(xs)); for i, element := range xs { out[i] = f(element) }; return out }()
 * make + for range : choisi sur mesures (sandbox/perf/map_test.go), la récursion est 5 à 500× plus lente.
 * L'index et self passés par DuploJS ne sont pas fournis : un rappel qui les lit est refusé.
 */
export const arrayMap: DuploFunction = {
	parameterCount: 1,
	apply: async({ input, parameters, typing, location, context }) => {
		const callbackNode = DArray.first(parameters);
		const callbackType = DArray.first(typing.parameterTypes);

		if (!callbackNode || !callbackType || !typing.resultType) {
			return context.error(location, "unresolvable-map-typing");
		}

		const inputType = input.goType;
		const resultType = await transformTypeQuietly(typing.resultType, location, context);

		if (
			!DModeling.hasTagValue(inputType, "[node][type]slice")
			|| !resultType
			|| !DModeling.hasTagValue(resultType, "[node][type]slice")
		) {
			return context.error(location, "un-support-map-input");
		}

		const element = context.generateIdentifier();

		const applied = await applyCallback(
			callbackNode,
			callbackType,
			() => ({
				expression: element,
				goType: inputType.elementType,
			}),
			location,
			context,
		);

		// never[] : le tableau est toujours vide.
		if (!applied) {
			return {
				before: [],
				result: GoAST.createSliceLiteral({ typeReference: resultType, elements: [] }),
				goType: resultType,
			};
		}

		if (DEither.isLeft(applied)) {
			return applied;
		}

		// xs sert deux fois (len et range) : un appel est d'abord rangé dans une variable.
		const binding = DModeling.hasTagValue(input.expression, "[node]identifier")
			? undefined
			: GoAST.createShortVariableDeclarationStatement({
				identifier: context.generateIdentifier(),
				initializer: input.expression,
			});

		const array = binding?.identifier ?? input.expression;
		const index = context.generateIdentifier();
		const out = context.generateIdentifier();

		return {
			before: binding ? [binding] : [],
			result: GoAST.createCallExpression({
				callee: GoAST.createFunctionLiteral({
					arguments: [],
					returnTypes: [resultType],
					body: GoAST.createBlockStatement({
						statements: [
							GoAST.createShortVariableDeclarationStatement({
								identifier: out,
								initializer: GoAST.createCallExpression({
									callee: GoAST.createIdentifier("make"),
									typeArgument: resultType,
									arguments: [
										GoAST.createCallExpression({
											callee: GoAST.createIdentifier("len"),
											arguments: [array],
										}),
									],
								}),
							}),
							GoAST.createRangeStatement({
								binding: GoAST.createRangeDeclaration({ key: index, value: element }),
								expression: array,
								body: GoAST.createBlockStatement({
									statements: DArray.push(
										applied.before,
										GoAST.createAssignmentStatement({
											targets: DCommon.cast([GoAST.createIndexExpression({ target: out, index })]),
											values: DCommon.cast([
												coerceGoExpression(applied.result, applied.goType, resultType.elementType, context),
											]),
										}),
									),
								}),
							}),
							GoAST.createReturnStatement({ values: [out] }),
						],
					}),
				}),
				arguments: [],
			}),
			goType: resultType,
		};
	},
};
