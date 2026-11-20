import * as DEither from "@duplojs/lang/either";

type TransferResult = DEither.Success<number> | DEither.Error<string> | DEither.Fail;

export function validateTransfer(balance: number, amount: number): TransferResult {
	if (amount <= 0) {
		return DEither.fail();
	}
	if (amount > balance) {
		return DEither.error("insufficient-funds");
	}
	if (amount > 10000) {
		return DEither.error("limit-exceeded");
	}
	return DEither.success(balance - amount);
}

export function runScenario(seed: number): number {
	const amount = seed - 50000;
	const res = validateTransfer(8000, amount);
	if (DEither.isRight(res)) {
		return 2;
	}
	if (DEither.isLeft(res)) {
		return 1;
	}
	return 0;
}
