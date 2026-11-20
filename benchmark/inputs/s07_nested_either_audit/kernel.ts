import * as DEither from "@duplojs/lang/either";

export function innerCheck(val: number): DEither.Success<number> | DEither.Fail {
	if (val <= 0) {
		return DEither.fail();
	}
	return DEither.success(val + 10);
}

export function outerAudit(val: number): DEither.Success<DEither.Success<number> | DEither.Fail> | DEither.Fail {
	if (val > 200000) {
		return DEither.fail();
	}
	return DEither.success(innerCheck(val - 80000));
}

export function runScenario(seed: number): number {
	const audited = outerAudit(seed);
	if (DEither.isRight(audited)) {
		return 1;
	}
	return 0;
}
