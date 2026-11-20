import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { type GoAST, GoPrinter } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { typeTransformers } from ".";

/**
 * A & B : les membres qu'on ne sait pas traduire (Number, LengthEqual<1>, Positive…) sont des
 * marques que seul TS voit ; un texte ou un nombre ne peut pas porter de propriété en JS.
 * On les retire : string & Number → string, readonly string[] & LengthEqual<1> → []string.
 * Plusieurs vrais types différents : refusé.
 */
export const intersectionTypeTransformer: Transformer<GoAST.Type | GoAST.TypeReference> = createTransformer(
	async(node, context) => {
		if (!TsAST.isIntersectionTypeNode(node)) {
			return context.notSupport();
		}

		const memberTypes = await DCommon.asyncPipe(
			node.types,
			DArray.map((member) => DCommon.asyncPipe(
				context.transform(member, typeTransformers.value),
				DEither.unwrapRight,
			)),
			DCommon.promiseAll,
		);

		const realTypes = DArray.filter(
			memberTypes,
			(member): member is Exclude<typeof member, DEither.Left> => !DEither.isLeft(member),
		);

		const firstType = DArray.first(realTypes);

		if (
			!firstType
			|| !DArray.every(
				realTypes,
				(member) => GoPrinter.renderNode(member.result) === GoPrinter.renderNode(firstType.result),
			)
		) {
			return context.error(node, "un-support-intersection-type");
		}

		return context.success({ result: firstType.result });
	},
);
