import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";

export function mixEntropy(val: number): number {
	const raw = (val * 7919 + 12345) % 1048573;
	if (raw < 0) {
		return raw + 1048573;
	}
	return raw;
}

export function evaluateGate(val: number): DEither.Success<number> | DEither.Fail {
	const state = mixEntropy(val);
	if (state % 100 < 45) {
		return DEither.fail();
	}
	return DEither.success((state % 97) + 1);
}

export function boostValue(val: number): DEither.Success<number> | DEither.Fail {
	if (val % 11 === 0) {
		return DEither.fail();
	}
	return DEither.success(val * 2 + 3);
}

export function runScenario(seed: number): number {
	const res = DCommon.pipe(
		evaluateGate(seed),
		DEither.whenIsRight(boostValue),
	);
	if (DEither.isRight(res)) {
		return 1;
	}
	return 0;
}
