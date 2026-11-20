import type { GoAST } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { typeTransformers } from ".";

type KeywordTypeKind = Parameters<typeof TsAST.factory.createKeywordTypeNode>[0];

/**
 * Go n'a pas de types littéraux : 1 devient number, "a" devient string, true devient boolean.
 * La valeur exacte reste une donnée, seul son type de base compte.
 * null n'est pas élargi, c'est un type à part entière.
 */
const literalBaseKeywords: Partial<Record<TsAST.SyntaxKind, KeywordTypeKind>> = {
	[TsAST.SyntaxKind.NumericLiteral]: TsAST.SyntaxKind.NumberKeyword,
	[TsAST.SyntaxKind.PrefixUnaryExpression]: TsAST.SyntaxKind.NumberKeyword,
	[TsAST.SyntaxKind.StringLiteral]: TsAST.SyntaxKind.StringKeyword,
	[TsAST.SyntaxKind.TrueKeyword]: TsAST.SyntaxKind.BooleanKeyword,
	[TsAST.SyntaxKind.FalseKeyword]: TsAST.SyntaxKind.BooleanKeyword,
};

export const literalTypeTransformer: Transformer<GoAST.Type | GoAST.TypeReference> = createTransformer(
	(node, context) => {
		if (!TsAST.isLiteralTypeNode(node)) {
			return context.notSupport();
		}

		const baseKeyword = literalBaseKeywords[node.literal.kind];

		if (baseKeyword === undefined) {
			return context.notSupport();
		}

		return context.transform(
			TsAST.factory.createKeywordTypeNode(baseKeyword),
			typeTransformers.value,
		);
	},
);
