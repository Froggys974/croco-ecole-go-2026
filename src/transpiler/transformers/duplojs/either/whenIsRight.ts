import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { GoAST } from "@go";
import { SignatureKind } from "typescript/async";
import {
	eitherIdentifiers,
	eitherInterfaceDependency,
} from "../../../sharedDependency/either";
import { resolveCallable } from "../../common/callable";
import {
	coerceGoExpression,
	isEitherGoType,
	transformTypeQuietly,
} from "../../common/coerce";
import { isIdentifierGoExpression } from "../../shared/expressionPurity";
import { type DuploFunction } from "../functions";

/**
 * DEither.whenIsRight(input, f) : si input est un Right, rend f appliquée à son contenu,
 * sinon rend input tel quel. Déplié à plat dans before (zéro closure / zéro IIFE).
 *
 *   var Generated_1 any // ou shard_dependencies.Either
 *   if Sourced_result.IsRight() {
 *       Generated_1 = []float64{Sourced_result.GetValue().(float64)}
 *   } else {
 *       Generated_1 = Sourced_result
 *   }
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

		const resultGoType = await transformTypeQuietly(typing.resultType, location, context)
			?? GoAST.builtinTypeReferences.any;

		// Si l'entrée Go n'est pas un Either (ex: type concret hors Either), rend telle quelle.
		if (!isEitherGoType(input.goType)) {
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

		const binding = isIdentifierGoExpression(input.expression)
			? undefined
			: GoAST.createShortVariableDeclarationStatement({
				identifier: context.generateIdentifier(),
				initializer: input.expression,
			});

		const eitherIdentifier = binding?.identifier ?? input.expression;

		const extractedValueExpression = contentGoType
			? GoAST.createTypeAssertionExpression({
				target: GoAST.createCallExpression({
					callee: GoAST.createSelectorExpression({
						target: eitherIdentifier,
						identifier: eitherIdentifiers.getValueMethod,
					}),
					arguments: [],
				}),
				typeReference: contentGoType,
			})
			: undefined;

		const applied = await callable.apply(
			contentGoType && extractedValueExpression
				? [
					{
						expression: extractedValueExpression,
						goType: contentGoType,
					},
				]
				: [],
			location,
			context,
		);

		if (DEither.isLeft(applied)) {
			return applied;
		}

		context.registerSharedDependency(eitherInterfaceDependency.value);

		const outputIdentifier = context.generateIdentifier();
		const outputDeclaration = GoAST.createVariableDeclarationZeroValue({
			identifier: outputIdentifier,
			typeReference: resultGoType,
		});

		const thenStatements = DArray.push(
			applied.before,
			GoAST.createAssignmentStatement({
				targets: DCommon.cast([outputIdentifier]),
				values: DCommon.cast([coerceGoExpression(applied.result, applied.goType, resultGoType, context)]),
			}),
		);

		const elseAssignment = GoAST.createAssignmentStatement({
			targets: DCommon.cast([outputIdentifier]),
			values: DCommon.cast([coerceGoExpression(eitherIdentifier, input.goType, resultGoType, context)]),
		});

		const ifStatement = GoAST.createIfStatement({
			condition: GoAST.createCallExpression({
				callee: GoAST.createSelectorExpression({
					target: eitherIdentifier,
					identifier: eitherIdentifiers.isRightMethod,
				}),
				arguments: [],
			}),
			body: GoAST.createBlockStatement({
				statements: thenStatements,
			}),
			elseBranch: GoAST.createBlockStatement({
				statements: [elseAssignment],
			}),
		});

		return {
			before: binding
				? [binding, outputDeclaration, ifStatement]
				: [outputDeclaration, ifStatement],
			result: outputIdentifier,
			goType: resultGoType,
		};
	},
};
