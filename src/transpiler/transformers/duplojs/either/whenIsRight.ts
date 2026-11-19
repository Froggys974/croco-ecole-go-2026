import * as DArray from "@duplojs/lang/array";
import * as DEither from "@duplojs/lang/either";
import * as DModeling from "@duplojs/lang/modeling";
import { GoAST } from "@go";
import { SignatureKind } from "typescript/async";
import { valueDependency, valueIdentifiers } from "../../../sharedDependency/value";
import { resolveCallable } from "../../common/callable";
import { coerceGoExpression, isValueType, transformTypeQuietly, unpackEitherContent } from "../../common/coerce";
import { type DuploFunction } from "../functions";

/**
 * DEither.whenIsRight(input, f) : si input est un Right, rend f appliquée à son contenu,
 * sinon rend input tel quel. Le résultat de f n'est pas remis dans un Either.
 *
 *   const newResult = DEither.whenIsRight(result, DArray.coalescing);
 *
 *   Sourced_newResult := func() shard_dependencies.Value {
 *       if shard_dependencies.EitherIsRight(Sourced_result) {
 *           return shard_dependencies.ValueObject([]float64{Sourced_result.Number()})
 *       }
 *       return Sourced_result
 *   }()
 *
 * La fonction appelée tout de suite évite de modifier une variable dans un if/else.
 * L'entrée apparaît plusieurs fois : si ce n'est pas un simple nom, elle est d'abord
 * rangée dans une variable pour n'être calculée qu'une fois.
 * Le rappel est un appelable (voir common/callable.ts) : fonction DuploJS, du projet, ou paramètre.
 * Les types viennent du checker à cet endroit, donc aucun générique Go.
 */
export const eitherWhenIsRight: DuploFunction = {
	parameterCount: 1,
	apply: async({ input, parameters, typing, location, context }) => {
		const { typeChecker } = context.transpilation;
		const callbackNode = DArray.first(parameters);
		const callbackType = DArray.first(typing.parameterTypes);

		if (!callbackNode || !callbackType || !typing.resultType) {
			return context.error(location, "unresolvable-when-is-right-typing");
		}

		const resultGoType = await transformTypeQuietly(typing.resultType, location, context);

		if (!resultGoType) {
			return context.error(location, "unrepresentable-when-is-right-result");
		}

		// Pas une Value, donc pas un Either : DuploJS la rend telle quelle.
		if (!isValueType(input.goType)) {
			return {
				before: [],
				result: coerceGoExpression(input.expression, input.goType, resultGoType, context),
				goType: resultGoType,
			};
		}

		const callbackSignature = DArray.first(
			await typeChecker.getSignaturesOfType(callbackType, SignatureKind.Call),
		);

		if (!callbackSignature) {
			return context.error(callbackNode, "unresolvable-when-is-right-callback");
		}

		const takesContent = !DArray.lengthEqual(callbackSignature.parameters, 0);
		const contentGoType = takesContent
			? await transformTypeQuietly(
				await typeChecker.getParameterType(callbackSignature, 0),
				location,
				context,
			)
			: undefined;

		if (takesContent && !contentGoType) {
			return context.error(callbackNode, "unrepresentable-either-content");
		}

		const callable = await resolveCallable(callbackNode, context);

		if (DEither.isLeft(callable)) {
			return callable;
		}

		const binding = DModeling.hasTagValue(input.expression, "[node]identifier")
			? undefined
			: GoAST.createShortVariableDeclarationStatement({
				identifier: context.generateIdentifier(),
				initializer: input.expression,
			});

		const either = binding?.identifier ?? input.expression;

		const applied = await callable.apply(
			contentGoType
				? [{
					expression: unpackEitherContent(either, contentGoType),
					goType: contentGoType,
				}]
				: [],
			location,
			context,
		);

		if (DEither.isLeft(applied)) {
			return applied;
		}

		const isRight = GoAST.createCallExpression({
			callee: GoAST.createSelectorExpression({
				target: context.registerSharedDependency(valueDependency.value),
				identifier: valueIdentifiers.isRight,
			}),
			arguments: [either],
		});

		return {
			before: binding ? [binding] : [],
			result: GoAST.createCallExpression({
				callee: GoAST.createFunctionLiteral({
					arguments: [],
					returnTypes: [resultGoType],
					body: GoAST.createBlockStatement({
						statements: [
							GoAST.createIfStatement({
								condition: isRight,
								body: GoAST.createBlockStatement({
									statements: DArray.push(
										applied.before,
										GoAST.createReturnStatement({
											values: [coerceGoExpression(applied.result, applied.goType, resultGoType, context)],
										}),
									),
								}),
							}),
							GoAST.createReturnStatement({
								values: [coerceGoExpression(either, input.goType, resultGoType, context)],
							}),
						],
					}),
				}),
				arguments: [],
			}),
			goType: resultGoType,
		};
	},
};
