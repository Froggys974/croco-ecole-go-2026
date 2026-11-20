import { GoAST, GoPrinter } from "@go";
import { type DuploFunction } from "../functions";
import { stringDependency, stringIdentifiers } from "./sharedDependency";

/**
 * DString.to(value) : `${value}` en JS. Le type Go de l'entrée choisit la conversion :
 *   string → telle quelle, float64 → StringFromNumber, bool → StringFromBoolean.
 */
export const stringTo: DuploFunction = {
	parameterCount: 0,
	apply: ({ input, location, context }) => {
		const inputType = GoPrinter.renderNode(input.goType);
		const string = GoAST.builtinTypeReferences.string;

		if (inputType === GoPrinter.renderNode(string)) {
			return Promise.resolve({ before: [], result: input.expression, goType: string });
		}

		const converter = inputType === GoPrinter.renderNode(GoAST.builtinTypeReferences.float64)
			? stringIdentifiers.fromNumber
			: inputType === GoPrinter.renderNode(GoAST.builtinTypeReferences.bool)
				? stringIdentifiers.fromBoolean
				: undefined;

		// Union (Value), objet, tableau : pas encore traduit.
		if (!converter) {
			return Promise.resolve(context.error(location, "un-support-string-to-input"));
		}

		return Promise.resolve({
			before: [],
			result: GoAST.createCallExpression({
				callee: GoAST.createSelectorExpression({
					target: context.registerSharedDependency(stringDependency.value),
					identifier: converter,
				}),
				arguments: [input.expression],
			}),
			goType: string,
		});
	},
};
