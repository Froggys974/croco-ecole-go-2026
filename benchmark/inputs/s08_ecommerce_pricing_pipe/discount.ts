import * as DEither from "@duplojs/lang/either";

export function applyDiscount(amount: number): DEither.Success<number> | DEither.Fail {
	if (amount <= 0) {
		return DEither.fail();
	}
	if (amount > 500) {
		return DEither.success(amount * 0.85);
	}
	return DEither.success(amount * 0.95);
}
