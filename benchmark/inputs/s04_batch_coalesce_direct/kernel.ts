import * as DArray from "@duplojs/lang/array";
import * as DEither from "@duplojs/lang/either";

export function parseOrderId(raw: number): DEither.Success<number> | DEither.Fail {
	if (raw <= 0) {
		return DEither.fail();
	}
	return DEither.success(raw + 100);
}

export function runScenario(seed: number): number {
	const idEither = parseOrderId(seed - 100000);
	const batch = DEither.whenIsRight(idEither, DArray.coalescing);
	if (DEither.isLeft(batch)) {
		return 0;
	}
	return 1;
}
