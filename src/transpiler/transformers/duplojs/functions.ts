import * as DCommon from "@duplojs/lang/common";
import { type TsAST } from "@typescript";
import { type Type } from "typescript/async";
import { type BuildContext } from "../../context/build";
import { type ApplyResult, type CallArgument } from "../common/callable";
import { arrayCoalescing } from "./array/coalescing";
import { arrayMap } from "./array/map";
import { stringTo } from "./string/to";
import { eitherWhenIsLeft, eitherWhenIsLeftOtherwise, eitherWhenIsRight, eitherWhenIsRightOtherwise } from "./either/when";

/**
 * Registre des fonctions DuploJS traduites, clé "domaine.nom".
 * Une recette décrit la forme complète f(entrée, …) ; callable.ts en dérive
 * l'usage en rappel et la forme curryfiée dans un pipe.
 */

export interface DuploFunctionTyping {
	// Types TS des paramètres sans l'entrée, résolus à cet endroit par le checker.
	readonly parameterTypes: readonly Type[];
	// Type TS du résultat (undefined si la fonction est passée sans être appelée).
	readonly resultType: Type | undefined;
}

export interface DuploFunctionApplyParams {
	readonly input: CallArgument;
	readonly parameters: readonly TsAST.Expression[];
	readonly typing: DuploFunctionTyping;
	readonly location: TsAST.Node;
	readonly context: BuildContext;
}

export interface DuploFunction {
	// Nombre de paramètres en plus de l'entrée : 1 pour whenIsRight(input, f).
	readonly parameterCount: number;
	apply(params: DuploFunctionApplyParams): Promise<ApplyResult>;
}

export const duploFunctions = DCommon.memo(
	(): Partial<Record<string, DuploFunction>> => ({
		"array.coalescing": arrayCoalescing,
		"array.map": arrayMap,
		"string.to": stringTo,
		"either.whenIsRight": eitherWhenIsRight,
		"either.whenIsRightOtherwise": eitherWhenIsRightOtherwise,
		"either.whenIsLeft": eitherWhenIsLeft,
		"either.whenIsLeftOtherwise": eitherWhenIsLeftOtherwise,
	}),
);
