import * as DArray from "@duplojs/lang/array";
import { GoAST } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { valueDependency, valueIdentifiers } from "../../sharedDependency/value";
import { typeTransformers } from ".";

type KeywordTypeKind = Parameters<typeof TsAST.factory.createKeywordTypeNode>[0];

/**
 * Toute union TS devient shard_dependencies.Value.
 *
 * Exception : si tous les membres ont le même type de base, ce n'est pas une union pour Go.
 * "admin" | "user" devient string, 1 | 2 | number devient float64.
 */
const baseKeywords: Partial<Record<TsAST.SyntaxKind, KeywordTypeKind>> = {
	[TsAST.SyntaxKind.NumberKeyword]: TsAST.SyntaxKind.NumberKeyword,
	[TsAST.SyntaxKind.StringKeyword]: TsAST.SyntaxKind.StringKeyword,
	[TsAST.SyntaxKind.BooleanKeyword]: TsAST.SyntaxKind.BooleanKeyword,
};

const literalBaseKeywords: Partial<Record<TsAST.SyntaxKind, KeywordTypeKind>> = {
	[TsAST.SyntaxKind.NumericLiteral]: TsAST.SyntaxKind.NumberKeyword,
	[TsAST.SyntaxKind.PrefixUnaryExpression]: TsAST.SyntaxKind.NumberKeyword,
	[TsAST.SyntaxKind.StringLiteral]: TsAST.SyntaxKind.StringKeyword,
	[TsAST.SyntaxKind.TrueKeyword]: TsAST.SyntaxKind.BooleanKeyword,
	[TsAST.SyntaxKind.FalseKeyword]: TsAST.SyntaxKind.BooleanKeyword,
};

function baseKeywordOf(member: TsAST.TypeNode): KeywordTypeKind | undefined {
	return TsAST.isLiteralTypeNode(member)
		? literalBaseKeywords[member.literal.kind]
		: baseKeywords[member.kind];
}

export const unionTypeTransformer: Transformer<GoAST.Type | GoAST.TypeReference> = createTransformer(
	(node, context) => {
		if (!TsAST.isUnionTypeNode(node)) {
			return context.notSupport();
		}

		const firstMember = DArray.first(node.types);
		const firstBase = firstMember && baseKeywordOf(firstMember);

		if (firstBase !== undefined && DArray.every(node.types, (member) => baseKeywordOf(member) === firstBase)) {
			return context.transform(
				TsAST.factory.createKeywordTypeNode(firstBase),
				typeTransformers.value,
			);
		}

		return context.success({
			result: GoAST.createPackageTypeReference({
				packageName: context.registerSharedDependency(valueDependency.value),
				identifier: valueIdentifiers.type,
			}),
		});
	},
);
