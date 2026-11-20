import * as DEither from "@duplojs/lang/either";

export function checkCredentials(age: number, active: boolean, level: number): DEither.Ok | DEither.Fail {
	if (age < 18 || !active) {
		return DEither.fail();
	}
	if (level >= 3 && age <= 90) {
		return DEither.ok();
	}
	return DEither.fail();
}

export function runScenario(seed: number): number {
	const age = seed - 100000;
	const active = seed > 50000;
	const level = seed - 200000;
	const res = checkCredentials(age, active, level);
	if (DEither.isRight(res)) {
		return 1;
	}
	return 0;
}
