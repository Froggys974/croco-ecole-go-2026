import { GoAST } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { nullShardDependency } from "../../sharedDependency/defaults";

/**
 * Primitifs hors union : string → string, boolean → bool, null → JSNull.
 * (number → float64 est dans float.ts, undefined → JSUndefined dans undefined.ts.)
 */
export const stringTypeTransformer: Transformer<GoAST.BuiltinTypeReference<"string">> = createTransformer(
	(node, context) => node.kind === TsAST.SyntaxKind.StringKeyword
		? context.success({ result: GoAST.builtinTypeReferences.string })
		: context.notSupport(),
);

export const booleanTypeTransformer: Transformer<GoAST.BuiltinTypeReference<"bool">> = createTransformer(
	(node, context) => node.kind === TsAST.SyntaxKind.BooleanKeyword
		? context.success({ result: GoAST.builtinTypeReferences.bool })
		: context.notSupport(),
);

const nullTypeIdentifier = GoAST.createIdentifier("JSNull");

export const nullTypeTransformer: Transformer<GoAST.PackageTypeReference> = createTransformer(
	(node, context) => {
		if (!TsAST.isLiteralTypeNode(node) || node.literal.kind !== TsAST.SyntaxKind.NullKeyword) {
			return context.notSupport();
		}

		return context.success({
			result: GoAST.createPackageTypeReference({
				packageName: context.registerSharedDependency(nullShardDependency.value),
				identifier: nullTypeIdentifier,
			}),
		});
	},
);
