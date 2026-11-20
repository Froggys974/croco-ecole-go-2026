import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { GoAST, GoPrinter } from "@go";
import { createTransformer, sharedDependencyPackageName, type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import {
	eitherIdentifiers,
	eitherOrFailDependency,
} from "../../../sharedDependency/either";
import { isAnyType, isEitherGoType } from "../../common/coerce";
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

				// Union binaire T | Fail (non-Either + Fail) -> EitherOrFail[T] sur la pile.
				if (DArray.lengthEqual(transformedMembers, 2)) {
					const second = DArray.at(transformedMembers, 1);
					if (second && !DEither.isLeft(second)) {
						const failRendered = `${sharedDependencyPackageName.value}.${eitherIdentifiers.failType.value}`;
						const secondRendered = GoPrinter.renderNode(second.result);
						const valueType = firstRendered === failRendered
							? second.result
							: secondRendered === failRendered
								? first.result
								: undefined;

						if (valueType && !isAnyType(valueType) && !isEitherGoType(valueType)) {
							return context.success({
								result: GoAST.createGenericTypeReference({
									typeReference: GoAST.createPackageTypeReference({
										packageName: context.registerSharedDependency(eitherOrFailDependency.value),
										identifier: eitherIdentifiers.eitherOrFailType,
									}),
									typeArguments: DCommon.cast([valueType]),
								}),
							});
						}
					}
				}
			}
		}

		restoreSnapshots();

		return context.success({
			result: GoAST.builtinTypeReferences.any,
		});
	},
);
