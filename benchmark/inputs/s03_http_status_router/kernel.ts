import * as DEither from "@duplojs/lang/either";

type RouteOutcome = DEither.Right<"ok", number> | DEither.Left<"bad-request"> | DEither.Left<"not-found", string>;

export function routeCode(code: number): RouteOutcome {
	if (code < 0) {
		return DEither.left("bad-request");
	}
	if (code > 400) {
		return DEither.left("not-found", "missing-resource");
	}
	return DEither.right("ok", code);
}

export function runScenario(seed: number): number {
	const code = seed - 100000;
	const outcome = routeCode(code);
	if (DEither.isRight(outcome)) {
		return 3;
	}
	return 1;
}
