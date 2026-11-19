import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { GoAST } from "@go";
import { TsAST } from "@typescript";
import { type BuildContext } from "../../../context/build";
import { valueDependency, valueIdentifiers } from "../../../sharedDependency/value";

/**
 * Types Either de DuploJS (Success<T>, Fail, Left<I, V>, Right<I, V>, Error<V>, Ok)
 * → shard_dependencies.Value (la valeur plate universelle).
 *
 * Le type du contenu (T, V) n'a pas besoin d'être traduit ici : c'est la VALEUR
 * qui dit où elle est rangée (étiquette), au moment où on la construit.
 * Les unions de ces types sont traitées par type/union.ts (→ Value aussi).
 */

const eitherTypeNames = ["Success", "Fail", "Left", "Right", "Error", "Ok"];

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

	if (DEither.isLeft(moduleReference) || !DArray.includes(eitherTypeNames, moduleReference.symbol.name)) {
		return context.notSupport();
	}

	return context.success({
		result: GoAST.createPackageTypeReference({
			packageName: context.registerSharedDependency(valueDependency.value),
			identifier: valueIdentifiers.type,
		}),
	});
}
