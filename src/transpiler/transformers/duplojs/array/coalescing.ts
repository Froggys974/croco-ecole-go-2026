import * as DModeling from "@duplojs/lang/modeling";
import { GoAST } from "@go";
import { isAnyType } from "../../common/coerce";
import { type DuploFunction } from "../functions";

/**
 * DArray.coalescing(value) : un tableau reste tel quel, une valeur seule devient []T{value}.
 *
 * Le type Go de l'entrée donne déjà la réponse à la compilation, donc zéro helper générique
 * et zéro test runtime :
 *   coalescing(3)     float64     -> []float64{3}
 *   coalescing(list)  []float64   -> list
 */
export const arrayCoalescing: DuploFunction = {
	parameterCount: 0,
	apply: ({ input, location, context }) => {
		if (DModeling.hasTagValue(input.goType, "[node][type]slice")) {
			return Promise.resolve({
				before: [],
				result: input.expression,
				goType: input.goType,
			});
		}

		// number | number[] (any) : tableau ou pas, seul un test à l'exécution le dirait.
		if (isAnyType(input.goType)) {
			return Promise.resolve(context.error(location, "un-support-coalescing-of-union"));
		}

		const sliceType = GoAST.createSliceType({ elementType: input.goType });

		return Promise.resolve({
			before: [],
			result: GoAST.createSliceLiteral({
				typeReference: sliceType,
				elements: [input.expression],
			}),
			goType: sliceType,
		});
	},
};
