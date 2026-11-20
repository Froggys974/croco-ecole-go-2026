import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";

export function parseScore(val: number): DEither.Success<number> | DEither.Fail {
	if (val <= 0) {
		return DEither.fail();
	}
	return DEither.success(val);
}

export function scaleScore(val: number): DEither.Success<number> | DEither.Fail {
	if (val > 2000000) {
		return DEither.fail();
	}
	return DEither.success(val * 2 + 13);
}

export function clampBand(val: number): DEither.Success<number> | DEither.Fail {
	if (val > 500000 && val < 600000) {
		return DEither.fail();
	}
	return DEither.success(val * 0.5 + 1);
}

export function runScenario(seed: number): number {
	const res = DCommon.pipe(
		seed - 15000,
		parseScore,
		DEither.whenIsRight(scaleScore),
		DEither.whenIsRight(clampBand),
		DEither.whenIsRight(scaleScore),
	);
	if (DEither.isRight(res)) {
		return 1;
	}
	return 0;
}
