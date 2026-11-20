import { GoAST } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { undefinedShardDependency } from "../../sharedDependency/defaults";

const undefinedTypeIdentifier = GoAST.createIdentifier("JSUndefined");

/**
 * undefined devient shard_dependencies.JSUndefined, une struct vide de 0 octet.
 * Dans une union comme number | undefined, il est emballé par ValueUndefined(JSUndefined{}).
 */
export const undefinedTypeTransformer: Transformer<GoAST.PackageTypeReference> = createTransformer(
	(node, context) => {
		if (node.kind !== TsAST.SyntaxKind.UndefinedKeyword) {
			return context.notSupport();
		}

		return context.success({
			result: GoAST.createPackageTypeReference({
				packageName: context.registerSharedDependency(undefinedShardDependency.value),
				identifier: undefinedTypeIdentifier,
			}),
		});
	},
);
