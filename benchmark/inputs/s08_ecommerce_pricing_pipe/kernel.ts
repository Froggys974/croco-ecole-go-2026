import * as DCommon from "@duplojs/lang/common";
import * as DEither from "@duplojs/lang/either";
import { applyDiscount } from "./discount";
import { applyTax } from "./tax";

export function priceOrder(raw: number): DEither.Success<number> | DEither.Fail {
	return DCommon.pipe(
		raw,
		applyDiscount,
		DEither.whenIsRight(applyTax),
	);
}

export function runScenario(seed: number): number {
	const amount = seed * 0.01 - 200;
	const first = priceOrder(amount);
	if (DEither.isRight(first)) {
		return 2;
	}
	const retry = priceOrder(amount + 400);
	if (DEither.isRight(retry)) {
		return 1;
	}
	return 0;
}
