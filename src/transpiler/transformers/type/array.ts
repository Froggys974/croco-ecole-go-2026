import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { GoAST, GoPrinter } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { valueDependency, valueIdentifiers } from "../../sharedDependency/value";
import { typeTransformers } from ".";

/**
 * Les tableaux TS deviennent des slices Go :
 *
 *   number[]            []float64
 *   readonly number[]   []float64   (readonly n'existe que pour TS)
 *   [number, number]    []float64   (tuple dont tous les éléments ont le même type Go)
 *   [number, string]    []Value     (types différents, chaque case est une union)
 *
 * Une slice Go pointe déjà vers ses éléments, comme un tableau JS.
 * Pas besoin de boîte, et Go accepte un type récursif (Tree[] dans Tree).
 */

function tupleElementType(element: TsAST.TypeNode) {
	return TsAST.isNamedTupleMember(element)
		? element.type
		: element;
}

function sliceOf(elementType: GoAST.Type | GoAST.TypeReference) {
	return GoAST.createSliceType({ elementType });
}

export const arrayTypeTransformer: Transformer<GoAST.Type | GoAST.TypeReference> = createTransformer(
	async(node, context) => {
		// readonly T[] / readonly [A, B] : le mot-clé disparaît, il reste le tableau.
		if (TsAST.isTypeOperatorNode(node) && node.operator === TsAST.SyntaxKind.ReadonlyKeyword) {
			return context.transform(node.type, typeTransformers.value);
		}

		if (TsAST.isArrayTypeNode(node)) {
			const elementType = await DCommon.asyncPipe(
				context.transform(node.elementType, typeTransformers.value),
				DEither.unwrapRight,
			);

			if (DEither.isLeft(elementType)) {
				return elementType;
			}

			return context.success({
				before: elementType.before,
				result: sliceOf(elementType.result),
			});
		}

		if (!TsAST.isTupleTypeNode(node)) {
			return context.notSupport();
		}

		// [...A] et [A?] changent la longueur selon les cas : pas encore traduits.
		if (
			DArray.lengthEqual(node.elements, 0)
			|| DArray.some(
				node.elements,
				(element) => TsAST.isRestTypeNode(tupleElementType(element))
					|| TsAST.isOptionalTypeNode(tupleElementType(element)),
			)
		) {
			return context.error(node, "un-support-tuple-shape");
		}

		const elementTypes = await DCommon.asyncPipe(
			node.elements,
			DArray.map((element) => DCommon.asyncPipe(
				context.transform(tupleElementType(element), typeTransformers.value),
				DEither.unwrapRight,
			)),
			DCommon.promiseAll,
			DArray.reduce(
				DArray.reduceFrom<readonly (GoAST.Type | GoAST.TypeReference)[]>([]),
				({ element, lastValue, next, exit }) => DEither.isLeft(element)
					? exit(element)
					: next(DArray.push(lastValue, element.result)),
			),
		);

		if (DEither.isLeft(elementTypes)) {
			return elementTypes;
		}

		const first = DArray.first(elementTypes);

		if (!first) {
			return context.error(node, "un-support-tuple-shape");
		}

		const firstRendered = GoPrinter.renderNode(first);
		const sameElementType = DArray.every(
			elementTypes,
			(elementType) => GoPrinter.renderNode(elementType) === firstRendered,
		);

		return context.success({
			result: sliceOf(
				sameElementType
					? first
					: GoAST.createPackageTypeReference({
						packageName: context.registerSharedDependency(valueDependency.value),
						identifier: valueIdentifiers.type,
					}),
			),
		});
	},
);
