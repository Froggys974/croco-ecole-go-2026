import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCH_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(BENCH_ROOT, "..");
const INPUTS_DIR = path.join(BENCH_ROOT, "inputs");
const OUTPUTS_DIR = path.join(BENCH_ROOT, "outputs");
const HARNESS_GO = path.join(__dirname, "harness.go");
const JS_WORKER = path.join(__dirname, "js-worker.mjs");
const TSX_CLI = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");

const SCENARIO_TITLES = {
	s01_auth_guard: "Garde d'accès & court-circuit logique (ok / fail / && / ||)",
	s02_banking_transfer: "Virement bancaire (Success<number> | Error<string> | Fail)",
	s03_http_status_router: "Routeur HTTP métier (DEither.left / right avec messages custom)",
	s04_batch_coalesce_direct: "Normalisation de lots (whenIsRight direct + DArray.coalescing)",
	s05_pipe_coalesce_curried: "Pipeline currié (DCommon.pipe + whenIsRight(DArray.coalescing))",
	s06_mixed_union_dispatch: "Union hétérogène 5 types (number | string | bool | Success | Fail)",
	s07_nested_either_audit: "Double validation imbriquée (Success<Success<number>> | Fail)",
	s08_ecommerce_pricing_pipe: "Moteur tarification multi-modules (discount + tax + pipe utilisateur)",
	s09_risk_pipeline_4stages: "Scoring risque 4 étapes (pipe + 3 whenIsRight enchaînés)",
	s10_dynamic_clock_entropy: "Simulation dynamique horloge (anti-constant-folding + % + pipe)",
};

function parseCliArgs(argv) {
	const options = {
		only: null,
		seed: Math.floor((Date.now() % 200000) + 50000),
		samples: 25,
		iters: 40000,
		warmup: 10000,
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--only" && argv[i + 1]) {
			options.only = new Set(argv[++i].split(",").map((s) => s.trim()).filter(Boolean));
		} else if (arg === "--seed" && argv[i + 1]) {
			options.seed = Number(argv[++i]);
		} else if (arg === "--samples" && argv[i + 1]) {
			options.samples = Number(argv[++i]);
		} else if (arg === "--iters" && argv[i + 1]) {
			options.iters = Number(argv[++i]);
		} else if (arg === "--warmup" && argv[i + 1]) {
			options.warmup = Number(argv[++i]);
		}
	}

	return options;
}

function getVersion(cmd, args) {
	try {
		return execFileSync(cmd, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	} catch {
		return "unknown";
	}
}

function extractBetween(text, startMarker, endMarker) {
	const start = text.indexOf(startMarker);
	const end = text.indexOf(endMarker);
	if (start === -1 || end === -1 || end <= start) {
		throw new Error(`Markers ${startMarker}..${endMarker} not found`);
	}
	return text.slice(start + startMarker.length, end).trim();
}

function runJsRuntime(runtime, kernelPath, options) {
	const args = runtime === "node"
		? [TSX_CLI, JS_WORKER, kernelPath, String(options.seed), String(options.samples), String(options.iters), String(options.warmup)]
		: [JS_WORKER, kernelPath, String(options.seed), String(options.samples), String(options.iters), String(options.warmup)];
	const bin = runtime === "node" ? "node" : "bun";

	const proc = spawnSync(bin, args, {
		cwd: REPO_ROOT,
		encoding: "utf-8",
		maxBuffer: 16 * 1024 * 1024,
	});

	if (proc.status !== 0) {
		const msg = (proc.stderr || proc.stdout || `exit=${proc.status}`).trim().split("\n").slice(-1)[0];
		return { status: "error", reason: msg };
	}

	const parsed = JSON.parse(extractBetween(proc.stdout, "===BENCH_JS_BEGIN===", "===BENCH_JS_END==="));
	return { status: "ok", ...parsed };
}

function runGoBenchmark(scenarioId, sourceDir, goOutDir, options) {
	fs.rmSync(goOutDir, { recursive: true, force: true });
	fs.mkdirSync(goOutDir, { recursive: true });

	const transpile = spawnSync(
		"bun",
		[
			"--tsconfig-override=tsconfig.app.json",
			path.join(REPO_ROOT, "bin", "index.ts"),
			`--tsconfig=${path.join(sourceDir, "tsconfig.json")}`,
			`--input=${path.join(sourceDir, "index.ts")}`,
			`--output=${goOutDir}`,
		],
		{
			cwd: REPO_ROOT,
			encoding: "utf-8",
			maxBuffer: 16 * 1024 * 1024,
		},
	);

	if (transpile.status !== 0) {
		const msg = (transpile.stderr || transpile.stdout || `transpile exit=${transpile.status}`)
			.trim()
			.split("\n")
			.slice(-1)[0];
		return { status: "unsupported", reason: msg.slice(0, 180) };
	}

	// Copie dans un dossier temporaire pour injecter harness.go sans polluer results/<id>/go/.
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `duplo-bench-${scenarioId}-`));
	try {
		fs.cpSync(goOutDir, tmpDir, { recursive: true });
		fs.copyFileSync(HARNESS_GO, path.join(tmpDir, "main.go"));

		const binPath = path.join(tmpDir, "bench_bin");
		const build = spawnSync("go", ["build", "-o", binPath, "."], {
			cwd: tmpDir,
			encoding: "utf-8",
			maxBuffer: 16 * 1024 * 1024,
		});

		if (build.status !== 0) {
			const msg = (build.stderr || build.stdout || `go build exit=${build.status}`)
				.trim()
				.split("\n")
				.slice(-1)[0];
			return { status: "build-error", reason: msg.slice(0, 180) };
		}

		const run = spawnSync(
			binPath,
			[String(options.seed), String(options.samples), String(options.iters), String(options.warmup)],
			{
				cwd: tmpDir,
				encoding: "utf-8",
				maxBuffer: 16 * 1024 * 1024,
			},
		);

		if (run.status !== 0) {
			const msg = (run.stderr || run.stdout || `go run exit=${run.status}`).trim().split("\n").slice(-1)[0];
			return { status: "runtime-error", reason: msg.slice(0, 180) };
		}

		const parsed = JSON.parse(extractBetween(run.stdout, "===BENCH_GO_BEGIN===", "===BENCH_GO_END==="));
		return { status: "ok", ...parsed };
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

function discoverScenarios(onlyFilter) {
	const entries = fs.readdirSync(INPUTS_DIR, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();

	return entries.filter((id) => {
		if (onlyFilter && !onlyFilter.has(id)) {
			return false;
		}
		const dir = path.join(INPUTS_DIR, id);
		return fs.existsSync(path.join(dir, "kernel.ts")) && fs.existsSync(path.join(dir, "index.ts"));
	});
}

function main() {
	const options = parseCliArgs(process.argv.slice(2));
	const scenarioIds = discoverScenarios(options.only);

	if (scenarioIds.length === 0) {
		console.error("[bench] Aucun scénario trouvé dans benchmark/inputs/");
		process.exit(1);
	}

	fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

	const meta = {
		generatedAt: new Date().toISOString(),
		gitBranch: getVersion("git", ["rev-parse", "--abbrev-ref", "HEAD"]),
		gitCommit: getVersion("git", ["rev-parse", "--short", "HEAD"]),
		nodeVersion: getVersion("node", ["-v"]),
		bunVersion: getVersion("bun", ["-v"]),
		goVersion: getVersion("go", ["version"]),
		baseSeed: options.seed,
		samples: options.samples,
		itersPerSample: options.iters,
		totalOpsPerCase: options.samples * options.iters,
		warmupIters: options.warmup,
	};

	console.log(`[bench] Branche ${meta.gitBranch}@${meta.gitCommit} | graine=${meta.baseSeed} | ${meta.totalOpsPerCase} ops/cas (${scenarioIds.length} sources)`);
	console.log(`[bench] Runtimes: Node ${meta.nodeVersion} | Bun ${meta.bunVersion} | ${meta.goVersion}`);

	const scenarios = [];

	// Exécution strictement séquentielle pour éviter toute contention CPU/RAM entre runtimes.
	for (const id of scenarioIds) {
		const sourceDir = path.join(INPUTS_DIR, id);
		const kernelPath = path.join(sourceDir, "kernel.ts");
		const caseResultDir = path.join(OUTPUTS_DIR, id);
		const goOutDir = path.join(caseResultDir, "go");
		fs.mkdirSync(caseResultDir, { recursive: true });

		console.log(`[bench] -> ${id}`);
		const nodeRes = runJsRuntime("node", kernelPath, options);
		const bunRes = runJsRuntime("bun", kernelPath, options);
		const goRes = runGoBenchmark(id, sourceDir, goOutDir, options);

		if (goRes.status === "ok" && nodeRes.status === "ok" && goRes.checksum !== nodeRes.checksum) {
			goRes.status = "checksum-mismatch";
			goRes.reason = `expected=${nodeRes.checksum} got=${goRes.checksum}`;
		}

		const record = {
			id,
			title: SCENARIO_TITLES[id] ?? id,
			checksum: nodeRes.status === "ok" ? nodeRes.checksum : null,
			checksumMatch:
				nodeRes.status === "ok"
				&& bunRes.status === "ok"
				&& goRes.status === "ok"
				&& nodeRes.checksum === bunRes.checksum
				&& nodeRes.checksum === goRes.checksum,
			node: nodeRes,
			bun: bunRes,
			go: goRes,
		};

		fs.writeFileSync(
			path.join(caseResultDir, "result.json"),
			`${JSON.stringify({ meta, scenario: record }, null, "\t")}\n`,
			"utf-8",
		);
		scenarios.push(record);
	}

	fs.writeFileSync(
		path.join(OUTPUTS_DIR, "report.json"),
		`${JSON.stringify({ meta, scenarios }, null, "\t")}\n`,
		"utf-8",
	);

	const okCount = scenarios.filter((s) => s.go.status === "ok").length;
	console.log(`[bench] Terminé : ${okCount}/${scenarios.length} cas Go OK -> benchmark/outputs/report.json`);
}

main();
