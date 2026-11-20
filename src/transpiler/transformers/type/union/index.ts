import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { GoAST, GoPrinter } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { typeTransformers } from "..";
import {
	isEitherFamilyTypeNode,
	resolveEitherUnionGoType,
} from "./eitherSpecialization";

/**
 * Traduction des unions TS vers Go :
 * - Exactement Success<T> | Fail             -> shard_dependencies.EitherCompact[T]
 * - Autres unions Either homogènes (R, L)    -> shard_dependencies.EitherTagged[R, L]
 * - Autres unions Either hétérogènes         -> shard_dependencies.Either
 * - Union homogène (même type Go)            -> ce type Go
 * - Union mixte hétérogène (ex: T[] | Fail)  -> any
 */
export const unionTypeTransformer: Transformer<GoAST.Type | GoAST.TypeReference> = createTransformer(
	async(node, context) => {
		if (!TsAST.isUnionTypeNode(node)) {
			return context.notSupport();
		}

		if (DArray.lengthEqual(node.types, 0)) {
			return context.error(node, "un-support-empty-union-type");
		}

		const isAllEither = (
			await Promise.all(
				node.types.map((member) => isEitherFamilyTypeNode(member, context)),
			)
		).every(Boolean);

		if (isAllEither) {
			return context.success({
				result: await resolveEitherUnionGoType(node.types, context),
			});
		}

		const snapshotDependencies = new Set(context.transpilation.sharedDependencies);
		const snapshotImports = new Set(context.file.imports);

		const restoreSnapshots = () => {
			context.transpilation.sharedDependencies.clear();
			for (const dep of snapshotDependencies) {
				context.transpilation.sharedDependencies.add(dep);
			}
			context.file.imports.clear();
			for (const imp of snapshotImports) {
				context.file.imports.add(imp);
			}
		};

		const transformedMembers = await DCommon.asyncPipe(
			node.types,
			DArray.map((member) => DCommon.asyncPipe(
				context.transform(member, typeTransformers.value),
				DEither.unwrapRight,
			)),
			DCommon.promiseAll,
		);

		const allValid = DArray.every(
			transformedMembers,
			(member) => !DEither.isLeft(member) && DArray.lengthEqual(member.before, 0),
		);

		if (allValid) {
			const first = DArray.first(transformedMembers);
			if (first && !DEither.isLeft(first)) {
				const firstRendered = GoPrinter.renderNode(first.result);
				const isHomogeneous = DArray.every(
					transformedMembers,
					(member) => !DEither.isLeft(member) && GoPrinter.renderNode(member.result) === firstRendered,
				);

				if (isHomogeneous) {
					return context.success({ result: first.result });
				}
			}
		}

		restoreSnapshots();

		return context.success({
			result: GoAST.builtinTypeReferences.any,
		});
	},
);
