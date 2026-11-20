import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { GoAST, GoPrinter } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { type Type } from "typescript/async";
import { type BuildContext } from "../../context/build";
import {
	eitherIdentifiers,
	eitherInterfaceDependency,
} from "../../sharedDependency/either";
import { typeTransformers } from ".";

/**
 * Traduction des unions TS vers Go :
 * - Union de types Either uniquement -> shard_dependencies.Either
 * - Union homogène (tous les membres convergent vers le même type Go) -> ce type Go
 * - Union mixte hétérogène (ex: number[] | Fail) -> any
 */

const eitherFamilyTypeNames = new Set([
	"Success",
	"Fail",
	"Right",
	"Left",
	"Ok",
	"Error",
	"Some",
	"None",
	"Result",
	"Maybe",
	"SafeCallbackSuccess",
	"SafeCallbackError",
]);

function unwrapParenthesizedTypeNode(typeNode: TsAST.TypeNode): TsAST.TypeNode {
	let current = typeNode;

	while (TsAST.isParenthesizedTypeNode(current)) {
		current = current.type;
	}

	return current;
}

async function isEitherFamilyResolvedType(
	resolvedType: Type,
	context: BuildContext,
): Promise<boolean> {
	if (resolvedType.isUnionType()) {
		const members = await resolvedType.getTypes();

		return !DArray.lengthEqual(members, 0)
			&& (await Promise.all(
				members.map((member) => isEitherFamilyResolvedType(member, context)),
			)).every(Boolean);
	}

	const symbol = (await resolvedType.getAliasSymbol()) ?? (await resolvedType.getSymbol());

	if (!symbol) {
		return false;
	}

	const moduleReference = await context.resolveReferenceModule(
		symbol,
		"@duplojs/lang",
		/^dist\/either\//,
	);

	return DEither.hasInformation(moduleReference, "some")
		&& eitherFamilyTypeNames.has(DEither.unwrapRight(moduleReference).symbol.name);
}

async function isEitherFamilyTypeNode(
	typeNode: TsAST.TypeNode,
	context: BuildContext,
): Promise<boolean> {
	const unwrapped = unwrapParenthesizedTypeNode(typeNode);

	if (TsAST.isUnionTypeNode(unwrapped)) {
		return !DArray.lengthEqual(unwrapped.types, 0)
			&& (await Promise.all(
				unwrapped.types.map((member) => isEitherFamilyTypeNode(member, context)),
			)).every(Boolean);
	}

	if (TsAST.isTypeReferenceNode(unwrapped) || TsAST.isImportTypeNode(unwrapped)) {
		const reference = TsAST.isTypeReferenceNode(unwrapped)
			? unwrapped.typeName
			: unwrapped;
		const moduleReference = await context.resolveReferenceModule(
			reference,
			"@duplojs/lang",
			/^dist\/either\//,
		);

		if (DEither.hasInformation(moduleReference, "some")) {
			return eitherFamilyTypeNames.has(DEither.unwrapRight(moduleReference).symbol.name);
		}
	}

	if (unwrapped.pos < 0) {
		return false;
	}

	const resolvedType = await context.transpilation.typeChecker.getTypeFromTypeNode(unwrapped);

	return isEitherFamilyResolvedType(resolvedType, context);
}

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
				result: GoAST.createPackageTypeReference({
					packageName: context.registerSharedDependency(eitherInterfaceDependency.value),
					identifier: eitherIdentifiers.interface,
				}),
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
