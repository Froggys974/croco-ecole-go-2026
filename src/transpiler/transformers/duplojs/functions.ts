import * as DCommon from "@duplojs/lang/common";
import { type TsAST } from "@typescript";
import { type Type } from "typescript/async";
import { type BuildContext } from "../../context/build";
import { type ApplyResult, type CallArgument } from "../common/callable";
import { arrayCoalescing } from "./array/coalescing";
import { eitherWhenIsRight } from "./either/whenIsRight";

/**
 * Le registre des fonctions DuploJS que le transpileur sait traduire.
 *
 * Chaque fonction est décrite une seule fois, dans sa forme classique :
 * une entrée déjà traduite en Go plus ses paramètres donnent du Go.
 * Les autres formes en découlent toutes seules (voir common/callable.ts) :
 *
 *   DArray.coalescing(x)                     appel complet (duplojs/call.ts)
 *   whenIsRight(result, f)                   appel complet (duplojs/call.ts)
 *   whenIsRight(result, DArray.coalescing)   coalescing donnée en rappel
 *   pipe(result, whenIsRight(f))             forme curryfiée, l'entrée vient du pipe
 *
 * Ajouter une fonction DuploJS revient à ajouter une ligne ici.
 * La clé est domaine.nom, le domaine étant le dossier DuploJS (array, either, string).
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
		"either.whenIsRight": eitherWhenIsRight,
	}),
);
