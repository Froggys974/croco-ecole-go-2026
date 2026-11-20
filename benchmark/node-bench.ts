import * as DEither from "@duplojs/lang/either";
import * as DArray from "@duplojs/lang/array";
import * as DCommon from "@duplojs/lang/common";

// ── Réplique exacte des add.ts de chaque exercice ──────────────────────────

// projects/01/add.ts — projects/02/add.ts — projects/03/add.ts (identiques)
function add(one: number, two: number) {
	return DEither.success(one + two);
}

// projects/04/add.ts — branche fail sur one === -1
function addWithFail(one: number, two: number) {
	if (one === -1) {
		return DEither.fail();
	}
	return DEither.success(one + two);
}

function bench(label: string, fn: () => unknown, N = 2_000_000) {
	const warmup = N >> 3;
	for (let i = 0; i < warmup; i++) fn();
	const start = performance.now();
	for (let i = 0; i < N; i++) fn();
	const ms = performance.now() - start;
	const nsPerOp = (ms / N) * 1e6;
	process.stdout.write(
		`  ${label.padEnd(42)}${nsPerOp.toFixed(1).padStart(8)} ns/op\n`,
	);
}

const runtime = typeof Bun !== "undefined"
	? `Bun ${Bun.version}`
	: `Node.js ${process.version}`;

console.log(`\n=== ${runtime} ===`);

// Exo 01 — add(1, 2) → EitherSuccess → isRight
// TS: const result = add(1, 2); if (DEither.isRight(result)) { print(result) }
bench("[exo01] add(1,2) → EitherSuccess → isRight", () => {
	const result = add(1, 2);
	DEither.isRight(result);
});

// Exo 02 — exo01 + whenIsRight(result, DArray.coalescing) direct
// TS: const newResult = DEither.whenIsRight(result, DArray.coalescing)
bench("[exo02] +whenIsRight(result, coalescing)", () => {
	const result = add(1, 2);
	DEither.isRight(result);
	DEither.whenIsRight(result, DArray.coalescing);
});

// Exo 03 — exo01 + DCommon.pipe(result, DEither.whenIsRight(coalescing)) curried
// TS: const newResult = DCommon.pipe(result, DEither.whenIsRight(DArray.coalescing))
// Go généré identique à exo02 (pipe inliné → même IIFE)
bench("[exo03] +pipe(result, whenIsRight(coalescing))", () => {
	const result = add(1, 2);
	DEither.isRight(result);
	DCommon.pipe(result, DEither.whenIsRight(DArray.coalescing));
});

// Exo 04 — add(-1, 2) → EitherFail → isRight faux → whenIsRight passthrough
// TS: add(-1, 2) → fail → pipe(result, whenIsRight(coalescing)) → retourne fail tel quel
bench("[exo04] add(-1,2) → EitherFail → isRight → whenIsRight passthrough", () => {
	const result = addWithFail(-1, 2);
	DEither.isRight(result);
	DCommon.pipe(result, DEither.whenIsRight(DArray.coalescing));
});
