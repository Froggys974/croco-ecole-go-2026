import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { GoAST } from "@go";
import { type Transformer } from "@transformer";
import { TsAST } from "@typescript";
import { SignatureKind } from "typescript/async";
import { type BuildContext } from "../../../context/build";
import { resolveCallable, type CallableFailure } from "../../common/callable";
import { coerceGoExpression, transformTypeQuietly, type GoType } from "../../common/coerce";
import { resolveValueType } from "../../common/valueType";
import { expressionTransformers } from "../../expression";

/**
 * DCommon.pipe(x, f, g, h) n'existe pas en Go. On le déroule : chaque étape
 * devient un appel rangé dans une nouvelle variable, l'une après l'autre.
 *
 *   const out = DCommon.pipe(x, f, g, h);
 *
 *   Generated_1 := Sourced_f(Sourced_x)
 *   Generated_2 := Sourced_g(Generated_1)
 *   Sourced_out := Sourced_h(Generated_2)
 *
 * Pas de liste de fonctions, pas de boucle, pas de any : Go peut optimiser chaque appel.
 * Aucune mutation : le JS de DuploJS modifie acc à chaque tour, ici chaque étape a sa variable.
 * Le checker donne l'entrée et la sortie de chaque étape, on emballe ou déballe entre deux si besoin.
 * Chaque étape est un appelable (voir common/callable.ts), même une fonction DuploJS curryfiée.
 *
 * Limites : pipe(x, ...fonctions) est refusé car les étapes ne sont connues qu'à l'exécution.
 * En JS les étapes sont évaluées avant le premier appel, ici chacune à son tour.
 * C'est pareil pour un nom de fonction ou une fonction DuploJS.
 */

interface PipeValue {
	readonly expression: GoAST.Expression;
	readonly goType: GoType;
}

interface PipeState {
	readonly before: readonly GoAST.Statement[];
	readonly value: PipeValue;
}

interface PipeStep {
	readonly node: TsAST.Expression;
	// Type Go que l'étape attend en entrée (undefined : on garde celui de la valeur courante).
	readonly inputGoType: GoType | undefined;
}

/**
 * Le type d'entrée de chaque étape, d'après la surcharge de pipe choisie par le checker :
 * paramètre i (à partir de 1) = (input: Ti) => Ti+1.
 */
async function getPipeSteps(
	call: TsAST.CallExpression,
	stepNodes: readonly TsAST.Expression[],
	context: BuildContext,
): Promise<readonly PipeStep[]> {
	const { typeChecker } = context.transpilation;
	const signature = await typeChecker.getResolvedSignature(call);

	return DCommon.asyncPipe(
		stepNodes,
		DArray.map(async(node, { index }) => {
			const stepType = await typeChecker.getParameterType(signature, index + 1);
			const stepSignature = DArray.first(await typeChecker.getSignaturesOfType(stepType, SignatureKind.Call));

			const inputGoType = stepSignature && !DArray.lengthEqual(stepSignature.parameters, 0)
				? await transformTypeQuietly(await typeChecker.getParameterType(stepSignature, 0), node, context)
				: undefined;

			return {
				node,
				inputGoType,
			};
		}),
		DCommon.promiseAll,
	);
}

/**
 * Applique les étapes une par une (récursion : pas de boucle dans le transpileur).
 * Chaque résultat intermédiaire est rangé dans une variable ; le dernier est rendu tel quel.
 */
async function applySteps(
	steps: readonly PipeStep[],
	state: PipeState,
	context: BuildContext,
): Promise<PipeState | CallableFailure> {
	const step = DArray.first(steps);

	if (!step) {
		return state;
	}

	const callable = await resolveCallable(step.node, context);

	if (DEither.isLeft(callable)) {
		return callable;
	}

	const inputGoType = step.inputGoType ?? state.value.goType;

	const applied = await callable.apply(
		[{
			expression: coerceGoExpression(state.value.expression, state.value.goType, inputGoType, context),
			goType: inputGoType,
		}],
		step.node,
		context,
	);

	if (DEither.isLeft(applied)) {
		return applied;
	}

	const rest = DArray.slice(steps, 1);

	// Dernière étape : son résultat est celui du pipe, pas besoin de variable.
	if (DArray.lengthEqual(rest, 0)) {
		return {
			before: DArray.concat(state.before, applied.before),
			value: {
				expression: applied.result,
				goType: applied.goType,
			},
		};
	}

	const binding = GoAST.createShortVariableDeclarationStatement({
		identifier: context.generateIdentifier(),
		initializer: applied.result,
	});

	return applySteps(
		rest,
		{
			before: DArray.concat(state.before, applied.before, [binding]),
			value: {
				expression: binding.identifier,
				goType: applied.goType,
			},
		},
		context,
	);
}

export async function pipeExpressionHandler(
	node: TsAST.Node,
	context: BuildContext,
): Promise<ReturnType<Transformer<GoAST.Expression>["transformer"]>> {
	if (!TsAST.isCallExpression(node)) {
		return context.error(node, "un-support-pipe-outside-call");
	}

	const inputNode = DArray.first(node.arguments);
	const stepNodes = DArray.slice(node.arguments, 1);

	if (!inputNode || DArray.lengthEqual(stepNodes, 0)) {
		return context.error(node, "un-support-pipe-arguments");
	}

	// pipe(x, ...fonctions) : impossible à dérouler à la traduction.
	if (DArray.some(node.arguments, (argument) => TsAST.isSpreadElement(argument))) {
		return context.error(node, "un-support-pipe-spread");
	}

	const input = await DCommon.asyncPipe(
		context.transform(inputNode, expressionTransformers.value),
		DEither.unwrapRight,
	);

	if (DEither.isLeft(input)) {
		return input;
	}

	const inputGoType = await transformTypeQuietly(
		await resolveValueType(inputNode, context),
		inputNode,
		context,
	);

	if (!inputGoType) {
		return context.error(inputNode, "unrepresentable-pipe-input-type");
	}

	const state = await applySteps(
		await getPipeSteps(node, stepNodes, context),
		{
			before: input.before,
			value: {
				expression: input.result,
				goType: inputGoType,
			},
		},
		context,
	);

	if (DEither.isLeft(state)) {
		return state;
	}

	return context.success({
		before: state.before,
		result: state.value.expression,
	});
}
