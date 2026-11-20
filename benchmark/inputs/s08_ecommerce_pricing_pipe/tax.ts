import * as DEither from "@duplojs/lang/either";

export function applyTax(net: number): DEither.Success<number> | DEither.Fail {
	if (net > 100000) {
		return DEither.fail();
	}
	return DEither.success(net * 1.2 + 4.5);
}
