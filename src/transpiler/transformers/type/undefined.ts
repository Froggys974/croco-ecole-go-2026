import { GoAST } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { undefinedShardDependency } from "../../sharedDependency/defaults";

const undefinedTypeIdentifier = GoAST.createIdentifier("JSUndefined");

/**
 * `undefined` → shard_dependencies.JSUndefined (struct vide, 0 octet).
 * Ex. la valeur d'un Fail : Success<number> | Fail → Either[JSUndefined, float64].
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
