import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { GoAST } from "@go";
import { TsAST } from "@typescript";
import { type BuildContext } from "../../../context/build";
import { undefinedShardDependency } from "../../../sharedDependency/defaults";
import {
	eitherErrorDependency,
	eitherFailDependency,
	eitherIdentifiers,
	eitherLeftDependency,
	eitherOkDependency,
	eitherRightDependency,
	eitherSuccessDependency,
} from "../../../sharedDependency/either";
import { typeTransformers } from "../../type";

/**
 * Types Either de DuploJS vers les structs Go typées :
 * - Fail / Ok            -> EitherFail / EitherOk (0 octet)
 * - Success<T> / Error<T> -> EitherSuccess[T] / EitherError[T] (sans champ Information)
 * - Left<I, V> / Right<I, V> -> EitherLeft[V] / EitherRight[V]
 */

function undefinedGoType(context: BuildContext) {
	return GoAST.createPackageTypeReference({
		packageName: context.registerSharedDependency(undefinedShardDependency.value),
		identifier: GoAST.createIdentifier("JSUndefined"),
	});
}

async function resolvePayloadGoType(
	node: TsAST.TypeReferenceNode | TsAST.ImportTypeNode,
	typeArgumentIndex: number,
	allowDefaultUndefined: boolean,
	context: BuildContext,
) {
	const typeArgumentNode = node.typeArguments && DArray.at(node.typeArguments, typeArgumentIndex);

	if (!typeArgumentNode) {
		return allowDefaultUndefined
			? DEither.right("resolved-payload", undefinedGoType(context) as GoAST.Type | GoAST.TypeReference)
			: context.error(node, "missing-either-type-argument");
	}

	const transformed = await DCommon.asyncPipe(
		context.transform(typeArgumentNode, typeTransformers.value),
		DEither.unwrapRight,
	);

	if (DEither.isLeft(transformed)) {
		return transformed;
	}

	if (!DArray.lengthEqual(transformed.before, 0)) {
		return context.error(typeArgumentNode, "un-support-before-on-either-type-argument");
	}

	return DEither.right("resolved-payload", transformed.result);
}

export async function eitherTypeHandler(
	node: TsAST.TypeReferenceNode | TsAST.ImportTypeNode,
	context: BuildContext,
) {
	const moduleReference = await DCommon.asyncPipe(
		context.resolveReferenceModule(
			TsAST.isTypeReferenceNode(node) ? node.typeName : node,
			"@duplojs/lang",
			/^dist\/either\//,
		),
		DEither.unwrapRight,
	);

	if (DEither.isLeft(moduleReference)) {
		return context.notSupport();
	}

	const name = moduleReference.symbol.name;

	if (name === "Fail") {
		return context.success({
			result: GoAST.createPackageTypeReference({
				packageName: context.registerSharedDependency(eitherFailDependency.value),
				identifier: eitherIdentifiers.failType,
			}),
		});
	}

	if (name === "Ok") {
		return context.success({
			result: GoAST.createPackageTypeReference({
				packageName: context.registerSharedDependency(eitherOkDependency.value),
				identifier: eitherIdentifiers.okType,
			}),
		});
	}

	const genericKinds = {
		Success: {
			dependency: eitherSuccessDependency,
			identifier: eitherIdentifiers.successType,
			payloadIndex: 0,
			allowUndefined: false,
		},
		Error: {
			dependency: eitherErrorDependency,
			identifier: eitherIdentifiers.errorType,
			payloadIndex: 0,
			allowUndefined: false,
		},
		Left: {
			dependency: eitherLeftDependency,
			identifier: eitherIdentifiers.leftType,
			payloadIndex: 1,
			allowUndefined: true,
		},
		Right: {
			dependency: eitherRightDependency,
			identifier: eitherIdentifiers.rightType,
			payloadIndex: 1,
			allowUndefined: true,
		},
	} as const;

	const kind = genericKinds[name as keyof typeof genericKinds];

	if (!kind) {
		return context.notSupport();
	}

	const payload = await resolvePayloadGoType(node, kind.payloadIndex, kind.allowUndefined, context);

	if (DEither.isLeft(payload)) {
		return payload;
	}

	return context.success({
		result: GoAST.createGenericTypeReference({
			typeReference: GoAST.createPackageTypeReference({
				packageName: context.registerSharedDependency(kind.dependency.value),
				identifier: kind.identifier,
			}),
			typeArguments: DCommon.cast([DEither.unwrapRight(payload)]),
		}),
	});
}
