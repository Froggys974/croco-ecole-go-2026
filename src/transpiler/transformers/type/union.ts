import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { GoAST, GoPrinter } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { valueDependency, valueIdentifiers } from "../../sharedDependency/value";
import { typeTransformers } from ".";

/**
 * Une union TS devient shard_dependencies.Value, sauf si tous ses membres ont le même
 * type Go : ce n'est alors pas une union pour Go.
 *   "admin" | "user" → string, readonly [number] | number[] → []float64
 */
export const unionTypeTransformer: Transformer<GoAST.Type | GoAST.TypeReference> = createTransformer(
	async(node, context) => {
		if (!TsAST.isUnionTypeNode(node)) {
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

		const firstMember = DArray.first(memberTypes);

		if (
			firstMember
			&& !DEither.isLeft(firstMember)
			&& DArray.every(
				memberTypes,
				(member) => !DEither.isLeft(member)
					&& GoPrinter.renderNode(member.result) === GoPrinter.renderNode(firstMember.result),
			)
		) {
			return context.success({ result: firstMember.result });
		}

		return context.success({
			result: GoAST.createPackageTypeReference({
				packageName: context.registerSharedDependency(valueDependency.value),
				identifier: valueIdentifiers.type,
			}),
		});
	},
);
