import { TsAST } from "@typescript";
import { GoAST } from "@go";
import { createTransformer, type Transformer } from "@transformer";
import { expressionTransformers } from ".";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import * as DArray from "@duplojs/lang/array";
import { TypeFlags } from "typescript/async";
import { type BuildContext } from "../../context/build";

const binaryOperators: Partial<
	Record<TsAST.SyntaxKind, GoAST.BinaryOperator>
> = {
	[TsAST.SyntaxKind.PlusToken]: "+",
	[TsAST.SyntaxKind.MinusToken]: "-",
	[TsAST.SyntaxKind.AsteriskToken]: "*",
	[TsAST.SyntaxKind.SlashToken]: "/",
	[TsAST.SyntaxKind.PercentToken]: "%",

	[TsAST.SyntaxKind.AmpersandToken]: "&",
	[TsAST.SyntaxKind.BarToken]: "|",
	[TsAST.SyntaxKind.CaretToken]: "^",
	[TsAST.SyntaxKind.LessThanLessThanToken]: "<<",
	[TsAST.SyntaxKind.GreaterThanGreaterThanToken]: ">>",

	[TsAST.SyntaxKind.AmpersandAmpersandToken]: "&&",
	[TsAST.SyntaxKind.BarBarToken]: "||",

	[TsAST.SyntaxKind.EqualsEqualsEqualsToken]: "==",
	[TsAST.SyntaxKind.ExclamationEqualsEqualsToken]: "!=",
	[TsAST.SyntaxKind.LessThanToken]: "<",
	[TsAST.SyntaxKind.LessThanEqualsToken]: "<=",
	[TsAST.SyntaxKind.GreaterThanToken]: ">",
	[TsAST.SyntaxKind.GreaterThanEqualsToken]: ">=",
};

/**
 * Pour a && b et a || b, le côté droit ne doit être évalué que si nécessaire.
 *
 * Or ses before (par exemple Generated_2 := probe(2)) s'exécutent toujours :
 * les placer avant l'expression casserait le court-circuit. Si le côté droit
 * a des before, on les enferme donc dans une fonction appelée tout de suite :
 *
 *     func() bool {
 *         if !Generated_1 { return false }   // pour || : if Generated_1 { return true }
 *         <before du côté droit>
 *         return <côté droit>
 *     }()
 *
 * Aucune mutation. Sans before, le && de Go suffit car il court-circuite déjà.
 * Go exige des bool : un opérande non booléen est refusé.
 */
async function transformLogicalExpression(
	node: TsAST.BinaryExpression,
	operator: "&&" | "||",
	context: BuildContext,
) {
	const { typeChecker } = context.transpilation;
	const leftType = await typeChecker.getTypeAtLocation(node.left);
	const rightType = await typeChecker.getTypeAtLocation(node.right);

	if (!(leftType.flags & TypeFlags.BooleanLike) || !(rightType.flags & TypeFlags.BooleanLike)) {
		return context.error(node, "un-support-non-boolean-logical-operand");
	}

	const left = await DCommon.asyncPipe(
		context.transform(node.left, expressionTransformers.value),
		DEither.unwrapRight,
	);

	if (DEither.isLeft(left)) {
		return left;
	}

	const leftAssignment = GoAST.createShortVariableDeclarationStatement({
		identifier: context.generateIdentifier(),
		initializer: left.result,
	});

	const right = await DCommon.asyncPipe(
		context.transform(node.right, expressionTransformers.value),
		DEither.unwrapRight,
	);

	if (DEither.isLeft(right)) {
		return right;
	}

	const before = DArray.concat(left.before, [leftAssignment]);

	if (DArray.lengthEqual(right.before, 0)) {
		return context.success<GoAST.Expression>({
			before,
			result: GoAST.createBinaryExpression({
				operator,
				left: leftAssignment.identifier,
				right: right.result,
			}),
		});
	}

	const shortCircuit = GoAST.createIfStatement({
		condition: operator === "&&"
			? GoAST.createUnaryExpression({
				operator: "!",
				operand: leftAssignment.identifier,
			})
			: leftAssignment.identifier,
		body: GoAST.createBlockStatement({
			statements: [
				GoAST.createReturnStatement({
					values: [GoAST.createBooleanLiteral({ value: operator === "||" })],
				}),
			],
		}),
	});

	return context.success<GoAST.Expression>({
		before,
		result: GoAST.createCallExpression({
			callee: GoAST.createFunctionLiteral({
				arguments: [],
				returnTypes: [GoAST.builtinTypeReferences.bool],
				body: GoAST.createBlockStatement({
					statements: DArray.concat(
						[shortCircuit],
						right.before,
						[GoAST.createReturnStatement({ values: [right.result] })],
					),
				}),
			}),
			arguments: [],
		}),
	});
}

export const binaryExpressionTransformer: Transformer<GoAST.Expression> = createTransformer(
	async(node, context) => {
		if (!TsAST.isBinaryExpression(node)) {
			return context.notSupport();
		}

		const operator = binaryOperators[node.operatorToken.kind];

		if (!operator) {
			return context.notSupport();
		}

		if (operator === "&&" || operator === "||") {
			return transformLogicalExpression(node, operator, context);
		}

		const left = await DCommon.asyncPipe(
			context.transform(node.left, expressionTransformers.value),
			DEither.unwrapRight,
		);

		if (DEither.isLeft(left)) {
			return left;
		}

		const leftAssignment = GoAST.createShortVariableDeclarationStatement({
			identifier: context.generateIdentifier(),
			initializer: left.result,
		});

		const right = await DCommon.asyncPipe(
			context.transform(node.right, expressionTransformers.value),
			DEither.unwrapRight,
		);

		if (DEither.isLeft(right)) {
			return right;
		}

		const rightAssignment = GoAST.createShortVariableDeclarationStatement({
			identifier: context.generateIdentifier(),
			initializer: right.result,
		});

		return context.success({
			before: DArray.concat(
				left.before,
				[leftAssignment],
				right.before,
				[rightAssignment],
			),
			result: GoAST.createBinaryExpression({
				operator,
				right: rightAssignment.identifier,
				left: leftAssignment.identifier,
			}),
		});
	},
);
