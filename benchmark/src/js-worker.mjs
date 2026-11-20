import { performance } from "node:perf_hooks";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [kernelPath, seedArg, samplesArg, itersArg, warmupArg] = process.argv.slice(2);

if (!kernelPath) {
	console.error("Usage: js-worker.mjs <kernel.ts> <seed> <samples> <itersPerSample> <warmup>");
	process.exit(1);
}

const baseSeed = Number(seedArg || 100000);
const samplesCount = Number(samplesArg || 25);
const itersPerSample = Number(itersArg || 40000);
const warmupIters = Number(warmupArg || 10000);

const mod = await import(pathToFileURL(path.resolve(kernelPath)).href);
const runScenario = mod.runScenario;

if (typeof runScenario !== "function") {
	throw new Error(`Missing exported function runScenario(seed: number): number in ${kernelPath}`);
}

let warm = 0;
for (let i = 0; i < warmupIters; i++) {
	warm += runScenario(baseSeed + i);
}

let checksum = 0;
const samplesNs = [];
for (let s = 0; s < samplesCount; s++) {
	const offset = baseSeed + s * itersPerSample;
	const t0 = performance.now();
	let local = 0;
	for (let i = 0; i < itersPerSample; i++) {
		local += runScenario(offset + i);
	}
	const dtNs = (performance.now() - t0) * 1e6;
	samplesNs.push(dtNs / itersPerSample);
	checksum += local;
}

samplesNs.sort((a, b) => a - b);
const p50 = samplesNs[Math.floor(samplesCount / 2)];
const p95 = samplesNs[Math.min(samplesCount - 1, Math.floor(samplesCount * 0.95))];
const p99 = samplesNs[samplesCount - 1];

const result = {
	checksum,
	warmChecksum: warm,
	p50NsPerOp: Number(p50.toFixed(2)),
	p95NsPerOp: Number(p95.toFixed(2)),
	p99NsPerOp: Number(p99.toFixed(2)),
	mopsPerSec: Number((1000 / p50).toFixed(2)),
};

console.log("===BENCH_JS_BEGIN===");
console.log(JSON.stringify(result));
console.log("===BENCH_JS_END===");
