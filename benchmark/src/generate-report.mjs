import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCH_ROOT = path.resolve(__dirname, "..");
const INPUTS_DIR = path.join(BENCH_ROOT, "inputs");
const OUTPUTS_DIR = path.join(BENCH_ROOT, "outputs");
const SUMMARY_PATH = path.join(OUTPUTS_DIR, "report.json");

function fmtRatio(a, b) {
	if (!a || !b || b <= 0) {
		return "-";
	}
	return `${(a / b).toFixed(2)}x`;
}

function collectFiles(rootDir, exts) {
	const files = [];
	if (!fs.existsSync(rootDir)) {
		return files;
	}
	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (exts.some((ext) => entry.name.endsWith(ext))) {
				const rel = path.relative(rootDir, full).replace(/\\/g, "/");
				files.push({ path: rel, content: fs.readFileSync(full, "utf-8") });
			}
		}
	};
	walk(rootDir);
	return files;
}

function buildMarkdownReport(summary) {
	const { meta, scenarios } = summary;
	const okCases = scenarios.filter((s) => s.go.status === "ok");
	const zeroAllocCases = okCases.filter((s) => s.go.bytesPerOp === 0 && s.go.allocsPerOp === 0);

	const lines = [
		"# Rapport de Benchmarks — TypeScript / DuploJS vers Go",
		"",
		`- **Branche :** \`${meta.gitBranch}@${meta.gitCommit}\``,
		`- **Date :** \`${meta.generatedAt}\``,
		`- **Runtimes :** Node \`${meta.nodeVersion}\` · Bun \`${meta.bunVersion}\` · \`${meta.goVersion}\``,
		`- **Charge :** \`${meta.totalOpsPerCase.toLocaleString("fr-FR")}\` ops/cas (\`${meta.samples} x ${meta.itersPerSample}\`, graine \`${meta.baseSeed}\`)`,
		`- **Couverture Go :** **${okCases.length} / ${scenarios.length}** cas valides (**${zeroAllocCases.length}** à \`0 B/op\` · \`0 alloc/op\`)`,
		"",
		"## Vue groupée",
		"",
		"| ID | Scénario | Node P50 | Bun P50 | Go P50 / Mops / RAM | Gain Go | Checksum |",
		"| :---: | :--- | :---: | :---: | :---: | :---: | :---: |",
	];

	for (const s of scenarios) {
		const nodeCell = s.node.status === "ok"
			? `\`${s.node.p50NsPerOp} ns\`<br>\`${s.node.mopsPerSec} Mops/s\``
			: `ERR: ${s.node.reason}`;
		const bunCell = s.bun.status === "ok"
			? `\`${s.bun.p50NsPerOp} ns\`<br>\`${s.bun.mopsPerSec} Mops/s\``
			: `ERR: ${s.bun.reason}`;
		const goCell = s.go.status === "ok"
			? `**\`${s.go.p50NsPerOp} ns\`**<br>\`${s.go.mopsPerSec} Mops/s\`<br>\`${s.go.bytesPerOp} B\` · \`${s.go.allocsPerOp} a\``
			: `\`${s.go.status}\`<br>${s.go.reason ?? ""}`;
		const gainCell = s.go.status === "ok"
			? `vs Node: **${fmtRatio(s.node.p50NsPerOp, s.go.p50NsPerOp)}**<br>vs Bun: **${fmtRatio(s.bun.p50NsPerOp, s.go.p50NsPerOp)}**`
			: "-";
		const chkCell = s.checksumMatch ? "OK" : "MISMATCH";

		const escapedTitle = s.title.replace(/\|/g, "\\|");
		lines.push(`| \`${s.id}\` | ${escapedTitle} | ${nodeCell} | ${bunCell} | ${goCell} | ${gainCell} | ${chkCell} |`);
	}

	lines.push("", "## Détails par source", "");
	for (const s of scenarios) {
		lines.push(`### \`${s.id}\` — ${s.title}`, "");
		lines.push(`- Résultat JSON : [\`${s.id}/result.json\`](./${s.id}/result.json)`);
		lines.push(`- Code Go généré : [\`${s.id}/go/\`](./${s.id}/go/)`);
		if (s.go.status === "ok") {
			lines.push(
				`- Go : P50 \`${s.go.p50NsPerOp} ns\` · P95 \`${s.go.p95NsPerOp} ns\` · P99 \`${s.go.p99NsPerOp} ns\` · \`${s.go.mopsPerSec} Mops/s\` · \`${s.go.bytesPerOp} B/op\` · \`${s.go.allocsPerOp} allocs/op\` · \`${s.go.numGC} GC\``,
			);
		} else {
			lines.push(`- Go : \`${s.go.status}\` (${s.go.reason ?? "échec"})`);
		}
		lines.push("");
	}

	return `${lines.join("\n")}\n`;
}

function buildHtmlReport(summary, detailsById) {
	const payload = JSON.stringify({ summary, detailsById }).replace(/<\//g, "<\\/");
	return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Rapport Benchmarks — DuploJS TS vers Go</title>
<style>
	:root {
		color-scheme: light dark;
		--bg: #0f172a; --panel: #1e293b; --panel-2: #0b1220; --panel-3: #162033; --border: #334155;
		--text: #e2e8f0; --muted: #94a3b8; --accent: #38bdf8; --accent-text: #082f49;
		--ok: #22c55e; --warn: #f59e0b; --err: #ef4444;
	}
	@media (prefers-color-scheme: light) {
		:root {
			--bg: #f8fafc; --panel: #ffffff; --panel-2: #f1f5f9; --panel-3: #e2e8f0; --border: #cbd5e1;
			--text: #0f172a; --muted: #475569; --accent: #0284c7; --accent-text: #ffffff;
			--ok: #16a34a; --warn: #d97706; --err: #dc2626;
		}
	}
	* { box-sizing: border-box; }
	body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
	header { padding: 20px 28px; border-bottom: 1px solid var(--border); background: var(--panel); display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px; align-items: center; }
	h1 { margin: 0; font-size: 1.35rem; }
	.meta { color: var(--muted); font-size: 0.85rem; display: flex; flex-wrap: wrap; gap: 12px; }
	.tabs { display: flex; gap: 8px; }
	.tab-btn { background: var(--panel-2); color: var(--text); border: 1px solid var(--border); padding: 8px 14px; border-radius: 8px; cursor: pointer; font-weight: 600; }
	.tab-btn.active { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
	main { max-width: 1360px; margin: 0 auto; padding: 24px; }
	.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; margin-bottom: 22px; }
	.kpi { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
	.kpi .label { color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
	.kpi .val { font-size: 1.45rem; font-weight: 700; margin-top: 4px; }
	.toolbar { display: flex; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; align-items: center; }
	input[type="search"], select { background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; font-size: 0.9rem; }
	table { width: 100%; border-collapse: collapse; background: var(--panel); border-radius: 10px; overflow: hidden; border: 1px solid var(--border); }
	th, td { padding: 11px 12px; text-align: left; border-bottom: 1px solid var(--border); font-size: 0.88rem; vertical-align: top; }
	th { background: var(--panel-2); color: var(--muted); font-weight: 600; }
	tr.clickable { cursor: pointer; }
	tr.clickable:hover { background: rgba(56, 189, 248, 0.08); }
	.badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 700; }
	.badge.ok { background: rgba(34, 197, 94, 0.16); color: var(--ok); }
	.badge.zero { background: rgba(56, 189, 248, 0.16); color: var(--accent); }
	.badge.err { background: rgba(239, 68, 68, 0.16); color: var(--err); }
	.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
	.bars { display: flex; flex-direction: column; gap: 5px; min-width: 170px; }
	.bar-row { display: grid; grid-template-columns: 42px 1fr 64px; gap: 6px; align-items: center; font-size: 0.76rem; }
	.bar-track { background: var(--panel-2); height: 8px; border-radius: 4px; overflow: hidden; }
	.bar-fill { height: 100%; border-radius: 4px; }
	.bar-node { background: #94a3b8; }
	.bar-bun { background: #f59e0b; }
	.bar-go { background: #22c55e; }
	.split { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
	@media (max-width: 960px) { .split { grid-template-columns: 1fr; } }
	.code-card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
	.code-card h3 { margin: 0; padding: 10px 14px; background: var(--panel-2); border-bottom: 1px solid var(--border); font-size: 0.9rem; display: flex; justify-content: space-between; align-items: center; }
	.file-tabs { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--panel-3); }
	.file-tab { background: transparent; color: var(--muted); border: 1px solid var(--border); border-radius: 6px; padding: 4px 9px; font-size: 0.78rem; cursor: pointer; }
	.file-tab.active { color: var(--text); border-color: var(--accent); background: rgba(56, 189, 248, 0.14); }
	pre { margin: 0; padding: 14px; overflow: auto; max-height: 520px; font-size: 0.8rem; background: var(--panel-2); }
	.hidden { display: none; }
</style>
</head>
<body>
<header>
	<div>
		<h1>Rapport de Benchmarks — DuploJS TypeScript vers Go</h1>
		<div class="meta" id="meta-line"></div>
	</div>
	<div class="tabs">
		<button class="tab-btn active" data-view="grouped">Vue groupée</button>
		<button class="tab-btn" data-view="single">Vue par source</button>
	</div>
</header>
<main>
	<section id="view-grouped">
		<div class="kpis" id="kpis"></div>
		<div class="toolbar">
			<input type="search" id="filter-input" placeholder="Filtrer par ID ou scénario..." />
			<span class="meta">Clique sur une ligne pour ouvrir sa fiche individuelle (TS vs Go généré).</span>
		</div>
		<table>
			<thead>
				<tr>
					<th>Scénario</th>
					<th>Latence P50 (échelle relative)</th>
					<th>Node / Bun / Go</th>
					<th>Mémoire Go</th>
					<th>Gains Go</th>
					<th>Parité</th>
				</tr>
			</thead>
			<tbody id="summary-body"></tbody>
		</table>
	</section>

	<section id="view-single" class="hidden">
		<div class="toolbar">
			<label for="case-select">Source :</label>
			<select id="case-select"></select>
		</div>
		<div class="kpis" id="single-kpis"></div>
		<div class="split">
			<div class="code-card">
				<h3>Sources TypeScript <span class="mono" id="ts-count"></span></h3>
				<div class="file-tabs" id="ts-tabs"></div>
				<pre class="mono" id="ts-code"></pre>
			</div>
			<div class="code-card">
				<h3>Code Go généré <span class="mono" id="go-count"></span></h3>
				<div class="file-tabs" id="go-tabs"></div>
				<pre class="mono" id="go-code"></pre>
			</div>
		</div>
	</section>
</main>
<script>
const DATA = ${payload};
const { summary, detailsById } = DATA;
const { meta, scenarios } = summary;

document.getElementById("meta-line").innerHTML =
	\`<span>Branche: <strong>\${meta.gitBranch}@\${meta.gitCommit}</strong></span>\`
	+ \`<span>Node \${meta.nodeVersion} · Bun \${meta.bunVersion} · \${meta.goVersion}</span>\`
	+ \`<span>\${meta.totalOpsPerCase.toLocaleString("fr-FR")} ops/cas (graine \${meta.baseSeed})</span>\`;

const okCases = scenarios.filter((s) => s.go.status === "ok");
const zeroAlloc = okCases.filter((s) => s.go.bytesPerOp === 0 && s.go.allocsPerOp === 0);
const medGainNode = okCases.length ? (okCases.reduce((a, s) => a + s.node.p50NsPerOp / s.go.p50NsPerOp, 0) / okCases.length).toFixed(1) : "-";
const medGainBun = okCases.length ? (okCases.reduce((a, s) => a + s.bun.p50NsPerOp / s.go.p50NsPerOp, 0) / okCases.length).toFixed(1) : "-";

document.getElementById("kpis").innerHTML = [
	["Couverture Go", \`\${okCases.length} / \${scenarios.length}\`],
	["Cas 0 B/op · 0 alloc", \`\${zeroAlloc.length} / \${okCases.length}\`],
	["Gain moyen vs Node", \`\${medGainNode}x\`],
	["Gain moyen vs Bun", \`\${medGainBun}x\`],
].map(([l, v]) => \`<div class="kpi"><div class="label">\${l}</div><div class="val">\${v}</div></div>\`).join("");

function renderGrouped(filter = "") {
	const q = filter.trim().toLowerCase();
	const body = document.getElementById("summary-body");
	body.innerHTML = "";
	for (const s of scenarios) {
		if (q && !s.id.toLowerCase().includes(q) && !s.title.toLowerCase().includes(q)) continue;
		const maxNs = Math.max(s.node.p50NsPerOp || 1, s.bun.p50NsPerOp || 1, s.go.p50NsPerOp || 1);
		const pct = (v) => Math.max(2, Math.round((v / maxNs) * 100));
		const tr = document.createElement("tr");
		tr.className = "clickable";
		tr.onclick = () => openSingle(s.id);
		const goOk = s.go.status === "ok";
		tr.innerHTML = \`
			<td><div class="mono"><strong>\${s.id}</strong></div><div style="color:var(--muted);font-size:0.8rem">\${s.title}</div></td>
			<td>
				<div class="bars">
					<div class="bar-row"><span>Node</span><div class="bar-track"><div class="bar-fill bar-node" style="width:\${pct(s.node.p50NsPerOp)}%"></div></div><span class="mono">\${s.node.p50NsPerOp}ns</span></div>
					<div class="bar-row"><span>Bun</span><div class="bar-track"><div class="bar-fill bar-bun" style="width:\${pct(s.bun.p50NsPerOp)}%"></div></div><span class="mono">\${s.bun.p50NsPerOp}ns</span></div>
					<div class="bar-row"><span>Go</span><div class="bar-track"><div class="bar-fill bar-go" style="width:\${goOk ? pct(s.go.p50NsPerOp) : 100}%"></div></div><span class="mono">\${goOk ? s.go.p50NsPerOp + "ns" : s.go.status}</span></div>
				</div>
			</td>
			<td class="mono">
				Node: \${s.node.mopsPerSec} Mops/s<br/>
				Bun: \${s.bun.mopsPerSec} Mops/s<br/>
				<strong>Go: \${goOk ? s.go.mopsPerSec + " Mops/s" : "-"}</strong>
			</td>
			<td class="mono">
				\${goOk
					? (s.go.bytesPerOp === 0 ? '<span class="badge zero">0 B/op · 0 alloc</span>' : \`\${s.go.bytesPerOp} B/op<br/>\${s.go.allocsPerOp} alloc/op · \${s.go.numGC} GC\`)
					: '<span class="badge err">' + s.go.status + '</span>'}
			</td>
			<td class="mono">
				\${goOk ? \`Node: <strong>\${(s.node.p50NsPerOp / s.go.p50NsPerOp).toFixed(2)}x</strong><br/>Bun: <strong>\${(s.bun.p50NsPerOp / s.go.p50NsPerOp).toFixed(2)}x</strong>\` : "-"}
			</td>
			<td>\${s.checksumMatch ? '<span class="badge ok">OK</span>' : '<span class="badge err">KO</span>'}</td>
		\`;
		body.appendChild(tr);
	}
}

const selectEl = document.getElementById("case-select");
for (const s of scenarios) {
	const opt = document.createElement("option");
	opt.value = s.id;
	opt.textContent = \`\${s.id} — \${s.title}\`;
	selectEl.appendChild(opt);
}
selectEl.onchange = () => renderSingle(selectEl.value);

function renderFileViewer(files, tabsId, codeId, countId) {
	const tabsEl = document.getElementById(tabsId);
	const codeEl = document.getElementById(codeId);
	document.getElementById(countId).textContent = \`\${files.length} fichier(s)\`;
	tabsEl.innerHTML = "";
	if (!files.length) {
		codeEl.textContent = "(aucun fichier)";
		return;
	}
	const show = (idx) => {
		[...tabsEl.children].forEach((b, i) => b.classList.toggle("active", i === idx));
		codeEl.textContent = files[idx].content;
	};
	files.forEach((f, idx) => {
		const btn = document.createElement("button");
		btn.className = "file-tab";
		btn.textContent = f.path;
		btn.onclick = () => show(idx);
		tabsEl.appendChild(btn);
	});
	const defaultIdx = Math.max(0, files.findIndex((f) => f.path.includes("kernel.ts")));
	show(defaultIdx);
}

function renderSingle(id) {
	const s = scenarios.find((x) => x.id === id) || scenarios[0];
	selectEl.value = s.id;
	const goOk = s.go.status === "ok";
	document.getElementById("single-kpis").innerHTML = [
		["Node P50 / P99", \`\${s.node.p50NsPerOp} / \${s.node.p99NsPerOp} ns\`],
		["Bun P50 / P99", \`\${s.bun.p50NsPerOp} / \${s.bun.p99NsPerOp} ns\`],
		["Go P50 / P99", goOk ? \`\${s.go.p50NsPerOp} / \${s.go.p99NsPerOp} ns\` : s.go.status],
		["Mémoire Go", goOk ? \`\${s.go.bytesPerOp} B/op · \${s.go.allocsPerOp} a · \${s.go.numGC} GC\` : "-"],
		["Checksum", \`\${s.checksum} (\${s.checksumMatch ? "OK" : "KO"})\`],
	].map(([l, v]) => \`<div class="kpi"><div class="label">\${l}</div><div class="val" style="font-size:1.1rem">\${v}</div></div>\`).join("");

	const detail = detailsById[s.id] || { tsFiles: [], goFiles: [] };
	renderFileViewer(detail.tsFiles, "ts-tabs", "ts-code", "ts-count");
	renderFileViewer(detail.goFiles, "go-tabs", "go-code", "go-count");
}

function setView(view) {
	document.getElementById("view-grouped").classList.toggle("hidden", view !== "grouped");
	document.getElementById("view-single").classList.toggle("hidden", view !== "single");
	document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
}

function openSingle(id) {
	renderSingle(id);
	setView("single");
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
	btn.onclick = () => {
		if (btn.dataset.view === "single") renderSingle(selectEl.value);
		setView(btn.dataset.view);
	};
});
document.getElementById("filter-input").oninput = (e) => renderGrouped(e.target.value);

renderGrouped();
renderSingle(scenarios[0].id);
</script>
</body>
</html>
`;
}

function main() {
	if (!fs.existsSync(SUMMARY_PATH)) {
		console.error("[report] benchmark/outputs/report.json introuvable. Lance runner.mjs d'abord.");
		process.exit(1);
	}

	const summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, "utf-8"));
	const detailsById = {};

	for (const s of summary.scenarios) {
		detailsById[s.id] = {
			tsFiles: collectFiles(path.join(INPUTS_DIR, s.id), [".ts"]),
			goFiles: collectFiles(path.join(OUTPUTS_DIR, s.id, "go"), [".go"]),
		};
	}

	const md = buildMarkdownReport(summary);
	const html = buildHtmlReport(summary, detailsById);

	fs.writeFileSync(path.join(OUTPUTS_DIR, "report.md"), md, "utf-8");
	fs.writeFileSync(path.join(OUTPUTS_DIR, "report.html"), html, "utf-8");
	console.log("[report] Généré : benchmark/outputs/report.md et benchmark/outputs/report.html");
}

main();
