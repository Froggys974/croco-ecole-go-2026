import * as DArray from "@duplojs/lang/array";
import * as DModeling from "@duplojs/lang/modeling";
import { type GoAST } from "@go";

export function isIdentifierGoExpression(
	expression: GoAST.Expression,
): expression is GoAST.Identifier {
	return DModeling.hasTagValue(expression, "[node]identifier");
}

// Vérifie si une expression Go est pure et sans effet de bord ni risque de panic.
export function isPureGoExpression(expression: GoAST.Expression): boolean {
	if (
		DModeling.hasTagValue(expression, "[node]identifier")
		|| DModeling.hasTagValue(expression, "[node][expression]literal-integer")
		|| DModeling.hasTagValue(expression, "[node][expression]literal-float")
		|| DModeling.hasTagValue(expression, "[node][expression]literal-imaginary")
		|| DModeling.hasTagValue(expression, "[node][expression]literal-rune")
		|| DModeling.hasTagValue(expression, "[node][expression]literal-string")
		|| DModeling.hasTagValue(expression, "[node][expression]literal-boolean")
		|| DModeling.hasTagValue(expression, "[node][expression]literal-nil")
	) {
		return true;
	}

	if (DModeling.hasTagValue(expression, "[node][expression]conversion")) {
		return isPureGoExpression(expression.operand);
	}

	if (DModeling.hasTagValue(expression, "[node][expression]unary")) {
		return isPureGoExpression(expression.operand);
	}

	if (DModeling.hasTagValue(expression, "[node][expression]binary")) {
		return isPureGoExpression(expression.left) && isPureGoExpression(expression.right);
	}

	if (DModeling.hasTagValue(expression, "[node][expression]selector")) {
		return isPureGoExpression(expression.target);
	}

	if (DModeling.hasTagValue(expression, "[node][expression]instantiation")) {
		return isPureGoExpression(expression.target);
	}

	if (DModeling.hasTagValue(expression, "[node][expression]literal-struct")) {
		return DArray.lengthEqual(expression.elements, 0);
	}

	return false;
}

// Vérifie si la cible d'un appel peut être invoquée directement sans variable intermédiaire.
export function isDirectCallCallee(expression: GoAST.Expression): boolean {
	if (DModeling.hasTagValue(expression, "[node]identifier")) {
		return true;
	}

	if (DModeling.hasTagValue(expression, "[node][expression]selector")) {
		return isPureGoExpression(expression.target);
	}

	if (DModeling.hasTagValue(expression, "[node][expression]instantiation")) {
		return isPureGoExpression(expression.target);
	}

	return false;
}

// Vérifie si une expression peut recevoir un appel de méthode direct (ex: expr.IsRight()).
export function canDirectMethodReceiver(expression: GoAST.Expression): boolean {
	return DModeling.hasTagValue(expression, "[node]identifier")
		|| DModeling.hasTagValue(expression, "[node][expression]selector")
		|| DModeling.hasTagValue(expression, "[node][expression][statement]call");
}
