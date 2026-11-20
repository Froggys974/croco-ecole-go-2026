import { GoAST } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { nullShardDependency } from "../../sharedDependency/defaults";

/**
 * Les littéraux "abc", true, false et null. null devient shard_dependencies.JSNull{}.
 */
export const literalExpressionTransformer: Transformer<GoAST.Expression> = createTransformer(
	(node, context) => {
		if (TsAST.isStringLiteral(node) || TsAST.isNoSubstitutionTemplateLiteral(node)) {
			return context.success({ result: GoAST.createStringLiteral({ value: node.text }) });
		}

		if (node.kind === TsAST.SyntaxKind.TrueKeyword || node.kind === TsAST.SyntaxKind.FalseKeyword) {
			return context.success({
				result: GoAST.createBooleanLiteral({ value: node.kind === TsAST.SyntaxKind.TrueKeyword }),
			});
		}

		if (node.kind === TsAST.SyntaxKind.NullKeyword) {
			return context.success({
				result: GoAST.createStructLiteral({
					typeReference: GoAST.createPackageTypeReference({
						packageName: context.registerSharedDependency(nullShardDependency.value),
						identifier: GoAST.createIdentifier("JSNull"),
					}),
					elements: [],
				}),
			});
		}

		return context.notSupport();
	},
);
