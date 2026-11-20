import * as DEither from "@duplojs/lang/either";

type Packet = number | string | boolean | DEither.Success<number> | DEither.Fail;

export function decodePacket(seed: number): Packet {
	if (seed < 50000) {
		return seed + 1;
	}
	if (seed < 100000) {
		return "telemetry";
	}
	if (seed < 150000) {
		return true;
	}
	if (seed < 200000) {
		return DEither.success(seed);
	}
	return DEither.fail();
}

export function runScenario(seed: number): number {
	const pkt = decodePacket(seed);
	if (DEither.isRight(pkt)) {
		return 3;
	}
	if (DEither.isLeft(pkt)) {
		return 2;
	}
	return 1;
}
