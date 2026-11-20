import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";

export function computeMetric(value: number): DEither.Success<number> | DEither.Fail {
	if (value < 0) {
		return DEither.fail();
	}
	return DEither.success(value * 2 + 1);
}

export function runScenario(seed: number): number {
	const metric = computeMetric(seed - 120000);
	const piped = DCommon.pipe(
		metric,
		DEither.whenIsRight(DArray.coalescing),
	);
	if (DEither.isLeft(piped)) {
		return 0;
	}
	return 1;
}
