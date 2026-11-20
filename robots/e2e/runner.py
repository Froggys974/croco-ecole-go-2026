from __future__ import annotations

import argparse
import fnmatch
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import tempfile
import time
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Final, Literal, cast

E2E_DIR: Final[Path] = Path(__file__).resolve().parent
if TYPE_CHECKING:
	from . import normalizer
else:
	if str(E2E_DIR) not in sys.path:
		sys.path.insert(0, str(E2E_DIR))
	import normalizer

ROOT_DIR: Final[Path] = E2E_DIR.parents[1]
CASES_DIR: Final[Path] = E2E_DIR / "cases"
GOLDEN_DIR: Final[Path] = E2E_DIR / "golden"
PROJECTS_DIR: Final[Path] = ROOT_DIR / "projects"
REMOTE_PY: Final[Path] = ROOT_DIR / "robots" / "runner" / "remote.py"

E2E_JSON_BEGIN: Final[str] = "===E2E_JSON_BEGIN==="
E2E_JSON_END: Final[str] = "===E2E_JSON_END==="

VALID_REJECT_CATEGORIES: Final[frozenset[str]] = frozenset({
	"meta-js",
	"open-objects-any",
	"exceptions",
	"oop-this",
	"type-level",
	"unbounded-concurrency",
	"runtime-apis",
})

ARCHIVE_IGNORED_DIRS: Final[frozenset[str]] = frozenset({
	"dist",
	"node_modules",
	".git",
	"__pycache__",
	".pytest_cache",
})

type CaseKind = Literal["positive", "reject"]
type RunMode = Literal["ts", "go", "both"]
type RuntimeName = Literal["node", "bun"]
type CaseStatus = Literal["PASS", "FAIL"]


class CaseDiscoveryError(ValueError):
	"""Erreur de validation lors de la decouverte des cas E2E."""


class RemoteExecutionError(RuntimeError):
	"""Erreur d'infrastructure lors de l'execution distante sur croco-go-runner."""


@dataclass(frozen=True)
class E2ECase:
	"""Description validee d'un cas E2E ou d'un projet officiel."""

	id: str
	tier: int
	feature: str
	kind: CaseKind
	entry: str
	description: str
	expect_reject_category: str | None
	case_dir: Path
	is_project: bool = False

	@property
	def entry_path(self) -> Path:
		"""Chemin complet du fichier d'entree TypeScript."""
		return self.case_dir / self.entry

	@property
	def tsconfig_path(self) -> Path:
		"""Chemin complet du tsconfig.json du cas."""
		return self.case_dir / "tsconfig.json"


@dataclass(frozen=True)
class TsRunResult:
	"""Resultat d'execution locale du runtime TypeScript."""

	exit_code: int
	stdout: str
	stderr: str
	blocks: tuple[normalizer.CanonicalValue, ...] | None
	parse_error: str | None
	duration_ms: int = 0


@dataclass(frozen=True)
class RemoteGoCaseResult:
	"""Resultat brut de transpilation, compilation et execution Go pour un cas."""

	id: str
	transpile_exit: int
	transpile_stdout: str
	transpile_stderr: str
	build_exit: int | None
	build_stdout: str
	build_stderr: str
	run_exit: int | None
	run_stdout: str
	run_stderr: str
	duration_ms: int = 0


@dataclass(frozen=True)
class CaseReport:
	"""Verdict final d'un cas E2E pour le rapport console et JSON."""

	id: str
	tier: int
	feature: str
	kind: CaseKind
	status: CaseStatus
	detail: str
	duration_ms: int
	ts: TsRunResult | None
	go: RemoteGoCaseResult | None
	go_block_count: int | None
	diff: str | None

	def to_json_dict(self) -> dict[str, object]:
		"""Convertit le verdict en dictionnaire JSON serialisable."""
		ts_payload: dict[str, object] | None = None
		if self.ts is not None:
			ts_payload = {
				"exitCode": self.ts.exit_code,
				"blockCount": len(self.ts.blocks) if self.ts.blocks is not None else None,
				"stderr": self.ts.stderr,
			}

		go_payload: dict[str, object] | None = None
		if self.go is not None:
			go_stderr = "\n".join(
				part
				for part in (
					self.go.transpile_stderr.strip(),
					self.go.build_stderr.strip(),
					self.go.run_stderr.strip(),
				)
				if part
			)
			go_payload = {
				"transpileExit": self.go.transpile_exit,
				"buildExit": self.go.build_exit,
				"runExit": self.go.run_exit,
				"blockCount": self.go_block_count,
				"stderr": go_stderr,
			}

		return {
			"id": self.id,
			"tier": self.tier,
			"feature": self.feature,
			"kind": self.kind,
			"status": self.status,
			"detail": self.detail,
			"durationMs": self.duration_ms,
			"ts": ts_payload,
			"go": go_payload,
			"diff": self.diff,
		}


@dataclass(frozen=True)
class CliArgs:
	"""Arguments CLI parses et types."""

	tier: str
	case: str | None
	mode: RunMode
	runtime: RuntimeName
	update_golden: bool
	check_golden: bool
	include_projects: bool
	projects_only: bool
	go_local: bool
	jobs: int
	json_report: Path | None
	remote_timeout: int = 300


def _matches_case_pattern(case_id: str, pattern: str | None) -> bool:
	if pattern is None:
		return True
	if "*" in pattern or "?" in pattern:
		return fnmatch.fnmatchcase(case_id, pattern)
	return pattern in case_id


def _load_and_validate_case(case_dir: Path, expected_tier: int) -> E2ECase:
	case_json_path = case_dir / "case.json"
	try:
		raw_text = case_json_path.read_text(encoding="utf-8")
		parsed = cast("object", json.loads(raw_text))
	except (OSError, json.JSONDecodeError) as exc:
		raise CaseDiscoveryError(f"{case_json_path}: JSON invalide ({exc})") from exc

	if not isinstance(parsed, dict):
		raise CaseDiscoveryError(f"{case_json_path}: l'objet racine doit etre un dictionnaire")

	raw_dict = cast("dict[str, object]", parsed)
	case_id = raw_dict.get("id")
	if not isinstance(case_id, str) or not case_id or case_id != case_dir.name:
		raise CaseDiscoveryError(
			f"{case_json_path}: 'id' doit etre une chaine egale au dossier '{case_dir.name}'"
		)

	tier_val = raw_dict.get("tier")
	if isinstance(tier_val, bool) or not isinstance(tier_val, int) or tier_val != expected_tier:
		raise CaseDiscoveryError(
			f"{case_json_path}: 'tier' doit valoir {expected_tier}"
		)

	feature = raw_dict.get("feature")
	if not isinstance(feature, str) or not feature.strip():
		raise CaseDiscoveryError(f"{case_json_path}: 'feature' doit etre une chaine non vide")

	kind_raw = raw_dict.get("kind")
	if kind_raw not in ("positive", "reject"):
		raise CaseDiscoveryError(f"{case_json_path}: 'kind' doit valoir 'positive' ou 'reject'")
	kind: CaseKind = "positive" if kind_raw == "positive" else "reject"

	entry = raw_dict.get("entry")
	if not isinstance(entry, str) or not entry.strip():
		raise CaseDiscoveryError(f"{case_json_path}: 'entry' doit etre une chaine non vide")

	resolved_dir = case_dir.resolve()
	resolved_entry = (case_dir / entry).resolve()
	if not resolved_entry.is_relative_to(resolved_dir) or not resolved_entry.is_file():
		raise CaseDiscoveryError(
			f"{case_json_path}: fichier entry introuvable ou hors dossier '{entry}'"
		)

	description = raw_dict.get("description")
	if not isinstance(description, str):
		raise CaseDiscoveryError(f"{case_json_path}: 'description' doit etre une chaine")

	reject_cat = raw_dict.get("expectRejectCategory")
	if kind == "positive":
		if reject_cat is not None:
			raise CaseDiscoveryError(
				f"{case_json_path}: 'expectRejectCategory' doit etre null pour kind='positive'"
			)
		reject_cat_val: str | None = None
	else:
		if not isinstance(reject_cat, str) or reject_cat not in VALID_REJECT_CATEGORIES:
			raise CaseDiscoveryError(
				f"{case_json_path}: 'expectRejectCategory' invalide: {reject_cat!r}"
			)
		reject_cat_val = reject_cat

	tsconfig_path = case_dir / "tsconfig.json"
	if not tsconfig_path.is_file():
		raise CaseDiscoveryError(f"{case_dir}: tsconfig.json manquant")
	try:
		_ = cast("object", json.loads(tsconfig_path.read_text(encoding="utf-8")))
	except (OSError, json.JSONDecodeError) as exc:
		raise CaseDiscoveryError(f"{tsconfig_path}: JSON invalide ({exc})") from exc

	return E2ECase(
		id=case_id,
		tier=tier_val,
		feature=feature,
		kind=kind,
		entry=entry,
		description=description,
		expect_reject_category=reject_cat_val,
		case_dir=case_dir,
		is_project=False,
	)


def discover_cases(
	tier_filter: str = "all",
	case_pattern: str | None = None,
	include_projects: bool = False,
	projects_only: bool = False,
	cases_dir: Path = CASES_DIR,
	projects_dir: Path = PROJECTS_DIR,
) -> list[E2ECase]:
	"""Decouvre, valide et filtre les cas E2E et/ou les projets officiels 00-10."""
	discovered: list[E2ECase] = []
	seen_ids: set[str] = set()

	if not projects_only and cases_dir.is_dir():
		tiers = (1, 2, 3, 4) if tier_filter == "all" else (int(tier_filter),)
		for tier_num in tiers:
			tier_dir = cases_dir / f"tier{tier_num}"
			if not tier_dir.is_dir():
				continue
			for candidate in sorted(tier_dir.iterdir(), key=lambda p: p.name):
				if not candidate.is_dir():
					continue
				if not (candidate / "case.json").is_file():
					continue
				case_obj = _load_and_validate_case(candidate, tier_num)
				if case_obj.id in seen_ids:
					raise CaseDiscoveryError(f"Identifiant de cas duplique: '{case_obj.id}'")
				seen_ids.add(case_obj.id)
				if _matches_case_pattern(case_obj.id, case_pattern):
					discovered.append(case_obj)

	include_proj_for_tier = projects_only or (
		include_projects and tier_filter in ("all", "4")
	)
	if include_proj_for_tier and projects_dir.is_dir():
		for proj_dir in sorted(projects_dir.iterdir(), key=lambda p: p.name):
			if not proj_dir.is_dir() or not proj_dir.name.isdigit():
				continue
			if not (proj_dir / "index.ts").is_file() or not (proj_dir / "tsconfig.json").is_file():
				continue
			proj_id = f"proj_{proj_dir.name}"
			if proj_id in seen_ids:
				raise CaseDiscoveryError(f"Collision d'identifiant avec projet '{proj_id}'")
			seen_ids.add(proj_id)
			if not _matches_case_pattern(proj_id, case_pattern):
				continue
			discovered.append(
				E2ECase(
					id=proj_id,
					tier=4,
					feature="official-project",
					kind="positive",
					entry="index.ts",
					description=f"Official project {proj_dir.name}",
					expect_reject_category=None,
					case_dir=proj_dir,
					is_project=True,
				)
			)

	discovered.sort(key=lambda item: (item.tier, 1 if item.is_project else 0, item.id))
	return discovered


def _run_subprocess_utf8(
	cmd: Sequence[str],
	cwd: Path,
	timeout_sec: int = 60,
	stdin_bytes: bytes | None = None,
) -> tuple[int, str, str]:
	"""Execute un sous-processus en capturant bytes et en decodant explicitement UTF-8."""
	proc = subprocess.run(
		list(cmd),
		cwd=cwd,
		input=stdin_bytes,
		capture_output=True,
		timeout=timeout_sec,
		check=False,
	)
	stdout_text = proc.stdout.decode("utf-8", errors="replace")
	stderr_text = proc.stderr.decode("utf-8", errors="replace")
	return proc.returncode, stdout_text, stderr_text


def run_ts_case(
	case: E2ECase,
	runtime: RuntimeName,
	root_dir: Path = ROOT_DIR,
) -> TsRunResult:
	"""Execute un cas positif avec node/tsx ou bun et normalise sa sortie."""
	if runtime == "bun":
		cmd = ["bun", "run", str(case.entry_path)]
	else:
		tsx_cli = root_dir / "node_modules" / "tsx" / "dist" / "cli.mjs"
		cmd = ["node", str(tsx_cli), "--tsconfig", str(case.tsconfig_path), str(case.entry_path)]

	t_start = time.monotonic()
	exit_code, stdout_text, stderr_text = _run_subprocess_utf8(cmd, cwd=case.case_dir)
	duration_ms = int((time.monotonic() - t_start) * 1000)
	try:
		blocks = tuple(normalizer.normalize_stdout(stdout_text))
	except normalizer.NormalizerParseError as exc:
		return TsRunResult(
			exit_code=exit_code,
			stdout=stdout_text,
			stderr=stderr_text,
			blocks=None,
			parse_error=str(exc),
			duration_ms=duration_ms,
		)

	return TsRunResult(
		exit_code=exit_code,
		stdout=stdout_text,
		stderr=stderr_text,
		blocks=blocks,
		parse_error=None,
		duration_ms=duration_ms,
	)


def golden_path_for(case_id: str, golden_dir: Path = GOLDEN_DIR) -> Path:
	"""Retourne le chemin du fichier golden pour un cas donne."""
	return golden_dir / f"{case_id}.json"


def write_golden_snapshot(
	case_id: str,
	runtime: RuntimeName,
	ts_res: TsRunResult,
	golden_dir: Path = GOLDEN_DIR,
) -> Path:
	"""Ecrit un snapshot golden canonique encode en UTF-8 avec tabulations et LF."""
	if ts_res.blocks is None:
		raise ValueError(f"Impossible d'ecrire le golden '{case_id}' sans blocs canoniques.")
	golden_dir.mkdir(parents=True, exist_ok=True)
	payload: dict[str, object] = {
		"id": case_id,
		"runtime": runtime,
		"exitCode": ts_res.exit_code,
		"blocks": [normalizer.encode_golden_value(block) for block in ts_res.blocks],
		"stderr": ts_res.stderr,
	}
	target = golden_path_for(case_id, golden_dir)
	rendered = json.dumps(payload, indent="\t", ensure_ascii=False, allow_nan=False) + "\n"
	with target.open("w", encoding="utf-8", newline="\n") as handle:
		_ = handle.write(rendered)
	return target


def load_golden_snapshot(
	case_id: str,
	golden_dir: Path = GOLDEN_DIR,
) -> tuple[int, tuple[normalizer.CanonicalValue, ...]]:
	"""Charge un snapshot golden et restaure les valeurs canoniques (dont UNDEFINED)."""
	target = golden_path_for(case_id, golden_dir)
	if not target.is_file():
		raise FileNotFoundError(f"Snapshot golden manquant: {target}")
	raw_obj = cast("object", json.loads(target.read_text(encoding="utf-8")))
	if not isinstance(raw_obj, dict):
		raise TypeError(f"Snapshot golden invalide (objet attendu): {target}")
	raw_dict = cast("dict[str, object]", raw_obj)
	exit_code_raw = raw_dict.get("exitCode")
	if isinstance(exit_code_raw, bool) or not isinstance(exit_code_raw, int):
		raise TypeError(f"Champ 'exitCode' invalide dans {target}")
	blocks_raw = raw_dict.get("blocks")
	if not isinstance(blocks_raw, list):
		raise TypeError(f"Champ 'blocks' invalide dans {target}")
	blocks_list = cast("list[object]", blocks_raw)
	blocks = tuple(normalizer.decode_golden_value(item) for item in blocks_list)
	return exit_code_raw, blocks


def build_remote_driver_script() -> str:
	"""Genere le pilote autonome Node 24 execute dans /tmp/e2e sur le conteneur."""
	return (
		'import { mkdirSync, readFileSync } from "node:fs";\n'
		'import { spawnSync } from "node:child_process";\n'
		'import { join } from "node:path";\n'
		"\n"
		'const E2E_ROOT = "/tmp/e2e";\n'
		'const WORKSPACE_ROOT = "/workspace";\n'
		'const manifest = JSON.parse(readFileSync(join(E2E_ROOT, "_e2e_manifest.json"), "utf8"));\n'
		"const timeoutMs = Number(manifest.timeoutMs ?? 60000);\n"
		'const runtime = manifest.runtime === "bun" ? "bun" : "node";\n'
		"\n"
		"function runCmd(command, args, cwd) {\n"
		"\tconst res = spawnSync(command, args, {\n"
		"\t\tcwd,\n"
		'\t\tencoding: "utf8",\n'
		"\t\ttimeout: timeoutMs,\n"
		"\t\tmaxBuffer: 16 * 1024 * 1024,\n"
		"\t});\n"
		"\tconst errSuffix = res.error ? `\\n${res.error.message}` : \"\";\n"
		"\treturn {\n"
		"\t\texitCode: typeof res.status === \"number\" ? res.status : -1,\n"
		'\t\tstdout: res.stdout ?? "",\n'
		'\t\tstderr: `${res.stderr ?? ""}${errSuffix}`,\n'
		"\t};\n"
		"}\n"
		"\n"
		"const results = [];\n"
		"mkdirSync(join(E2E_ROOT, \"out\"), { recursive: true });\n"
		"mkdirSync(join(E2E_ROOT, \"bin\"), { recursive: true });\n"
		"\n"
		"for (const entry of manifest.cases) {\n"
		"\tconst caseStart = performance.now();\n"
		"\tconst tsconfigAbs = join(E2E_ROOT, entry.tsconfigRel);\n"
		"\tconst entryAbs = join(E2E_ROOT, entry.entryRel);\n"
		"\tconst outDir = join(E2E_ROOT, \"out\", entry.id);\n"
		"\tconst binPath = join(E2E_ROOT, \"bin\", entry.id);\n"
		"\n"
		"\tconst transpileCmd = runtime === \"bun\"\n"
		'\t\t? "bun"\n'
		'\t\t: "node";\n'
		"\tconst transpileArgs = runtime === \"bun\"\n"
		"\t\t? [\n"
		'\t\t\t"--tsconfig-override=tsconfig.app.json",\n'
		'\t\t\t"bin/index.ts",\n'
		'\t\t\t"--tsconfig",\n'
		"\t\t\ttsconfigAbs,\n"
		'\t\t\t"--input",\n'
		"\t\t\tentryAbs,\n"
		'\t\t\t"--output",\n'
		"\t\t\toutDir,\n"
		"\t\t]\n"
		"\t\t: [\n"
		'\t\t\t"/workspace/node_modules/tsx/dist/cli.mjs",\n'
		'\t\t\t"--tsconfig",\n'
		'\t\t\t"tsconfig.app.json",\n'
		'\t\t\t"bin/index.ts",\n'
		'\t\t\t"--tsconfig",\n'
		"\t\t\ttsconfigAbs,\n"
		'\t\t\t"--input",\n'
		"\t\t\tentryAbs,\n"
		'\t\t\t"--output",\n'
		"\t\t\toutDir,\n"
		"\t\t];\n"
		"\n"
		"\tconst transpile = runCmd(transpileCmd, transpileArgs, WORKSPACE_ROOT);\n"
		'\tif (entry.kind === "reject" || transpile.exitCode !== 0) {\n'
		"\t\tresults.push({\n"
		"\t\t\tid: entry.id,\n"
		"\t\t\ttranspileExit: transpile.exitCode,\n"
		"\t\t\ttranspileStdout: transpile.stdout,\n"
		"\t\t\ttranspileStderr: transpile.stderr,\n"
		"\t\t\tbuildExit: null,\n"
		'\t\t\tbuildStdout: "",\n'
		'\t\t\tbuildStderr: "",\n'
		"\t\t\trunExit: null,\n"
		'\t\t\trunStdout: "",\n'
		'\t\t\trunStderr: "",\n'
		"\t\t\tdurationMs: Math.max(0, Math.round(performance.now() - caseStart)),\n"
		"\t\t});\n"
		"\t\tcontinue;\n"
		"\t}\n"
		"\n"
		'\tconst build = runCmd("go", ["build", "-o", binPath, "."], outDir);\n'
		"\tif (build.exitCode !== 0) {\n"
		"\t\tresults.push({\n"
		"\t\t\tid: entry.id,\n"
		"\t\t\ttranspileExit: transpile.exitCode,\n"
		"\t\t\ttranspileStdout: transpile.stdout,\n"
		"\t\t\ttranspileStderr: transpile.stderr,\n"
		"\t\t\tbuildExit: build.exitCode,\n"
		"\t\t\tbuildStdout: build.stdout,\n"
		"\t\t\tbuildStderr: build.stderr,\n"
		"\t\t\trunExit: null,\n"
		'\t\t\trunStdout: "",\n'
		'\t\t\trunStderr: "",\n'
		"\t\t\tdurationMs: Math.max(0, Math.round(performance.now() - caseStart)),\n"
		"\t\t});\n"
		"\t\tcontinue;\n"
		"\t}\n"
		"\n"
		"\tconst run = runCmd(binPath, [], outDir);\n"
		"\tresults.push({\n"
		"\t\tid: entry.id,\n"
		"\t\ttranspileExit: transpile.exitCode,\n"
		"\t\ttranspileStdout: transpile.stdout,\n"
		"\t\ttranspileStderr: transpile.stderr,\n"
		"\t\tbuildExit: build.exitCode,\n"
		"\t\tbuildStdout: build.stdout,\n"
		"\t\tbuildStderr: build.stderr,\n"
		"\t\trunExit: run.exitCode,\n"
		"\t\trunStdout: run.stdout,\n"
		"\t\trunStderr: run.stderr,\n"
		"\t\tdurationMs: Math.max(0, Math.round(performance.now() - caseStart)),\n"
		"\t});\n"
		"}\n"
		"\n"
		f'process.stdout.write("\\n{E2E_JSON_BEGIN}\\n" + JSON.stringify({{ results }}) + "\\n{E2E_JSON_END}\\n");\n'
	)


def _archive_prefix_for_case(case: E2ECase) -> str:
	if case.is_project:
		return f"projects/{case.case_dir.name}"
	return f"cases/tier{case.tier}/{case.id}"


def _add_bytes_to_tar(tar: tarfile.TarFile, arcname: str, data: bytes) -> None:
	info = tarfile.TarInfo(name=arcname)
	info.size = len(data)
	info.mode = 0o644
	tar.addfile(info, io.BytesIO(data))


def build_remote_archive(
	cases: Sequence[E2ECase],
	runtime: RuntimeName,
	timeout_ms: int = 60000,
) -> bytes:
	"""Empaquette en memoire les cas selectionnes, le manifeste et le pilote Node 24."""
	buffer = io.BytesIO()
	manifest_cases: list[dict[str, object]] = []
	added_arcnames: set[str] = set()

	with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
		for case in cases:
			prefix = _archive_prefix_for_case(case)
			for root, dirs, files in os.walk(case.case_dir):
				dirs[:] = sorted(d for d in dirs if d not in ARCHIVE_IGNORED_DIRS)
				for file_name in sorted(files):
					file_path = Path(root) / file_name
					rel_sub = file_path.relative_to(case.case_dir).as_posix()
					arcname = f"{prefix}/{rel_sub}"
					if arcname in added_arcnames:
						continue
					added_arcnames.add(arcname)
					tar.add(file_path, arcname=arcname)

			entry_rel_sub = case.entry_path.resolve().relative_to(case.case_dir.resolve()).as_posix()
			manifest_cases.append({
				"id": case.id,
				"kind": case.kind,
				"tsconfigRel": f"{prefix}/tsconfig.json",
				"entryRel": f"{prefix}/{entry_rel_sub}",
			})

		manifest_payload: dict[str, object] = {
			"runtime": runtime,
			"timeoutMs": timeout_ms,
			"cases": manifest_cases,
		}
		manifest_bytes = (
			json.dumps(manifest_payload, indent="\t", ensure_ascii=False, allow_nan=False) + "\n"
		).encode("utf-8")
		_add_bytes_to_tar(tar, "_e2e_manifest.json", manifest_bytes)
		_add_bytes_to_tar(tar, "_remote_driver.mjs", build_remote_driver_script().encode("utf-8"))

	return buffer.getvalue()


def _require_int_or_none(mapping: dict[str, object], key: str) -> int | None:
	val = mapping.get(key)
	if val is None:
		return None
	if isinstance(val, bool) or not isinstance(val, int):
		raise RemoteExecutionError(f"Champ entier attendu pour '{key}', recu {val!r}")
	return val


def _require_int(mapping: dict[str, object], key: str) -> int:
	val = _require_int_or_none(mapping, key)
	if val is None:
		raise RemoteExecutionError(f"Champ entier obligatoire manquant: '{key}'")
	return val


def _require_str(mapping: dict[str, object], key: str) -> str:
	val = mapping.get(key)
	if not isinstance(val, str):
		raise RemoteExecutionError(f"Champ string attendu pour '{key}', recu {val!r}")
	return val


def _optional_non_negative_int(mapping: dict[str, object], key: str, default: int = 0) -> int:
	val = mapping.get(key)
	if val is None:
		return default
	if isinstance(val, bool) or not isinstance(val, int) or val < 0:
		raise RemoteExecutionError(f"Champ entier >= 0 attendu pour '{key}', recu {val!r}")
	return val


def parse_remote_payload(raw_stdout: str) -> list[RemoteGoCaseResult]:
	"""Extrait et valide le JSON delimite par ===E2E_JSON_BEGIN=== / END apres la banniere [sync]."""
	normalized = raw_stdout.replace("\r\n", "\n")
	begin_match = re.search(rf"(?:^|\n){re.escape(E2E_JSON_BEGIN)}\n", normalized)
	if begin_match is None:
		raise RemoteExecutionError(
			f"Marqueur {E2E_JSON_BEGIN} introuvable dans la sortie distante."
		)
	payload_start = begin_match.end()
	end_matches = list(
		re.finditer(rf"\n{re.escape(E2E_JSON_END)}(?:\n|$)", normalized[payload_start:])
	)
	if not end_matches:
		raise RemoteExecutionError(
			f"Marqueur {E2E_JSON_END} introuvable dans la sortie distante."
		)
	end_idx = payload_start + end_matches[-1].start()

	json_chunk = normalized[payload_start:end_idx].strip()
	try:
		parsed = cast("object", json.loads(json_chunk))
	except json.JSONDecodeError as exc:
		raise RemoteExecutionError(f"JSON distant invalide: {exc}") from exc

	if not isinstance(parsed, dict):
		raise RemoteExecutionError("Le payload JSON distant doit etre un objet.")
	parsed_dict = cast("dict[str, object]", parsed)
	results_raw = parsed_dict.get("results")
	if not isinstance(results_raw, list):
		raise RemoteExecutionError("Champ 'results' manquant ou invalide dans le payload distant.")

	items: list[RemoteGoCaseResult] = []
	for entry in cast("list[object]", results_raw):
		if not isinstance(entry, dict):
			raise RemoteExecutionError("Entree 'results' invalide (objet attendu).")
		item_dict = cast("dict[str, object]", entry)
		items.append(
			RemoteGoCaseResult(
				id=_require_str(item_dict, "id"),
				transpile_exit=_require_int(item_dict, "transpileExit"),
				transpile_stdout=_require_str(item_dict, "transpileStdout"),
				transpile_stderr=_require_str(item_dict, "transpileStderr"),
				build_exit=_require_int_or_none(item_dict, "buildExit"),
				build_stdout=_require_str(item_dict, "buildStdout"),
				build_stderr=_require_str(item_dict, "buildStderr"),
				run_exit=_require_int_or_none(item_dict, "runExit"),
				run_stdout=_require_str(item_dict, "runStdout"),
				run_stderr=_require_str(item_dict, "runStderr"),
				duration_ms=_optional_non_negative_int(item_dict, "durationMs", default=0),
			)
		)
	return items


def run_remote_go_batch(
	cases: Sequence[E2ECase],
	runtime: RuntimeName,
	root_dir: Path = ROOT_DIR,
	remote_py: Path = REMOTE_PY,
	timeout_sec: int = 300,
) -> dict[str, RemoteGoCaseResult]:
	"""Streame l'archive tar.gz sur stdin de remote.py exec et retourne les resultats Go."""
	archive_bytes = build_remote_archive(cases, runtime)
	remote_cmd = (
		"rm -rf /tmp/e2e && mkdir -p /tmp/e2e && tar -xzf - -C /tmp/e2e && "
		"ln -sfn /workspace/node_modules /tmp/e2e/node_modules && "
		"node /tmp/e2e/_remote_driver.mjs"
	)
	exit_code, stdout_text, stderr_text = _run_subprocess_utf8(
		["uv", "run", str(remote_py), "exec", remote_cmd],
		cwd=root_dir,
		timeout_sec=timeout_sec,
		stdin_bytes=archive_bytes,
	)
	if exit_code != 0:
		raise RemoteExecutionError(
			f"remote.py exec a echoue (code {exit_code}): {stderr_text.strip() or stdout_text.strip()}"
		)

	parsed = parse_remote_payload(stdout_text)
	return {item.id: item for item in parsed}


def run_local_go_case(
	case: E2ECase,
	runtime: RuntimeName,
	root_dir: Path = ROOT_DIR,
) -> RemoteGoCaseResult:
	"""Execute localement transpilation -> go build -> binaire dans un dossier temporaire."""
	t_start = time.monotonic()
	with tempfile.TemporaryDirectory(prefix="croco_e2e_") as tmp_name:
		tmp_dir = Path(tmp_name)
		out_dir = tmp_dir / "out"
		bin_name = f"{case.id}.exe" if os.name == "nt" else case.id
		bin_path = tmp_dir / bin_name

		if runtime == "bun":
			transpile_cmd = [
				"bun",
				"--tsconfig-override=tsconfig.app.json",
				"bin/index.ts",
				"--tsconfig",
				str(case.tsconfig_path),
				"--input",
				str(case.entry_path),
				"--output",
				str(out_dir),
			]
		else:
			tsx_cli = root_dir / "node_modules" / "tsx" / "dist" / "cli.mjs"
			transpile_cmd = [
				"node",
				str(tsx_cli),
				"--tsconfig",
				"tsconfig.app.json",
				"bin/index.ts",
				"--tsconfig",
				str(case.tsconfig_path),
				"--input",
				str(case.entry_path),
				"--output",
				str(out_dir),
			]

		t_exit, t_out, t_err = _run_subprocess_utf8(transpile_cmd, cwd=root_dir)
		if case.kind == "reject" or t_exit != 0:
			return RemoteGoCaseResult(
				id=case.id,
				transpile_exit=t_exit,
				transpile_stdout=t_out,
				transpile_stderr=t_err,
				build_exit=None,
				build_stdout="",
				build_stderr="",
				run_exit=None,
				run_stdout="",
				run_stderr="",
				duration_ms=int((time.monotonic() - t_start) * 1000),
			)

		b_exit, b_out, b_err = _run_subprocess_utf8(
			["go", "build", "-o", str(bin_path), "."],
			cwd=out_dir,
		)
		if b_exit != 0:
			return RemoteGoCaseResult(
				id=case.id,
				transpile_exit=t_exit,
				transpile_stdout=t_out,
				transpile_stderr=t_err,
				build_exit=b_exit,
				build_stdout=b_out,
				build_stderr=b_err,
				run_exit=None,
				run_stdout="",
				run_stderr="",
				duration_ms=int((time.monotonic() - t_start) * 1000),
			)

		r_exit, r_out, r_err = _run_subprocess_utf8([str(bin_path)], cwd=out_dir)
		return RemoteGoCaseResult(
			id=case.id,
			transpile_exit=t_exit,
			transpile_stdout=t_out,
			transpile_stderr=t_err,
			build_exit=b_exit,
			build_stdout=b_out,
			build_stderr=b_err,
			run_exit=r_exit,
			run_stdout=r_out,
			run_stderr=r_err,
			duration_ms=int((time.monotonic() - t_start) * 1000),
		)


def _validate_reject_fixture_static(case: E2ECase) -> str | None:
	if not case.tsconfig_path.is_file():
		return f"tsconfig.json manquant dans {case.case_dir}"
	try:
		_ = cast("object", json.loads(case.tsconfig_path.read_text(encoding="utf-8")))
	except (OSError, json.JSONDecodeError) as exc:
		return f"tsconfig.json invalide: {exc}"
	if not case.entry_path.is_file():
		return f"entry manquant: {case.entry_path}"
	if not case.entry_path.read_text(encoding="utf-8").strip():
		return f"entry vide: {case.entry_path}"
	return None


def evaluate_case(
	case: E2ECase,
	mode: RunMode,
	runtime: RuntimeName,
	update_golden: bool,
	check_golden: bool,
	ts_res: TsRunResult | None,
	go_res: RemoteGoCaseResult | None,
	duration_ms: int,
	golden_dir: Path = GOLDEN_DIR,
) -> CaseReport:
	"""Calcule le verdict PASS/FAIL d'un cas selon le mode et les regles golden/normalizer."""
	if case.kind == "reject":
		if mode == "ts":
			static_err = _validate_reject_fixture_static(case)
			if static_err is not None:
				return CaseReport(
					id=case.id,
					tier=case.tier,
					feature=case.feature,
					kind=case.kind,
					status="FAIL",
					detail="reject-fixture-invalid",
					duration_ms=duration_ms,
					ts=None,
					go=None,
					go_block_count=None,
					diff=static_err,
				)
			return CaseReport(
				id=case.id,
				tier=case.tier,
				feature=case.feature,
				kind=case.kind,
				status="PASS",
				detail="reject-fixture-ready",
				duration_ms=duration_ms,
				ts=None,
				go=None,
				go_block_count=None,
				diff=None,
			)

		if go_res is None:
			return CaseReport(
				id=case.id,
				tier=case.tier,
				feature=case.feature,
				kind=case.kind,
				status="FAIL",
				detail="missing-go-result",
				duration_ms=duration_ms,
				ts=None,
				go=None,
				go_block_count=None,
				diff="Resultat Go absent pour ce cas reject.",
			)
		reject_cmp = normalizer.verify_reject_output(
			go_res.transpile_exit,
			go_res.transpile_stderr,
		)
		if not reject_cmp.equal:
			return CaseReport(
				id=case.id,
				tier=case.tier,
				feature=case.feature,
				kind=case.kind,
				status="FAIL",
				detail="reject-check-failed",
				duration_ms=duration_ms,
				ts=None,
				go=go_res,
				go_block_count=None,
				diff=reject_cmp.format_report(),
			)
		return CaseReport(
			id=case.id,
			tier=case.tier,
			feature=case.feature,
			kind=case.kind,
			status="PASS",
			detail="reject-verified",
			duration_ms=duration_ms,
			ts=None,
			go=go_res,
			go_block_count=None,
			diff=None,
		)

	# Cas positive
	if mode in ("ts", "both"):
		if ts_res is None:
			return CaseReport(
				id=case.id,
				tier=case.tier,
				feature=case.feature,
				kind=case.kind,
				status="FAIL",
				detail="missing-ts-result",
				duration_ms=duration_ms,
				ts=None,
				go=go_res,
				go_block_count=None,
				diff="Resultat TS manquant.",
			)
		if ts_res.exit_code != 0:
			return CaseReport(
				id=case.id,
				tier=case.tier,
				feature=case.feature,
				kind=case.kind,
				status="FAIL",
				detail=f"ts-exit-{ts_res.exit_code}",
				duration_ms=duration_ms,
				ts=ts_res,
				go=go_res,
				go_block_count=None,
				diff=ts_res.stderr.strip() or f"TS a quitte avec le code {ts_res.exit_code}",
			)
		if ts_res.parse_error is not None or ts_res.blocks is None:
			return CaseReport(
				id=case.id,
				tier=case.tier,
				feature=case.feature,
				kind=case.kind,
				status="FAIL",
				detail="ts-parse-error",
				duration_ms=duration_ms,
				ts=ts_res,
				go=go_res,
				go_block_count=None,
				diff=ts_res.parse_error or "Erreur de parsing TS stdout",
			)

		if update_golden:
			_ = write_golden_snapshot(case.id, runtime, ts_res, golden_dir=golden_dir)
		elif check_golden:
			try:
				gold_exit, gold_blocks = load_golden_snapshot(case.id, golden_dir=golden_dir)
			except (FileNotFoundError, TypeError, ValueError, json.JSONDecodeError) as exc:
				return CaseReport(
					id=case.id,
					tier=case.tier,
					feature=case.feature,
					kind=case.kind,
					status="FAIL",
					detail="golden-load-error",
					duration_ms=duration_ms,
					ts=ts_res,
					go=go_res,
					go_block_count=None,
					diff=str(exc),
				)
			if gold_exit != ts_res.exit_code:
				return CaseReport(
					id=case.id,
					tier=case.tier,
					feature=case.feature,
					kind=case.kind,
					status="FAIL",
					detail="golden-exit-mismatch",
					duration_ms=duration_ms,
					ts=ts_res,
					go=go_res,
					go_block_count=None,
					diff=f"exitCode attendu={gold_exit}, obtenu={ts_res.exit_code}",
				)
			cmp_gold = normalizer.compare_blocks(gold_blocks, ts_res.blocks)
			if not cmp_gold.equal:
				return CaseReport(
					id=case.id,
					tier=case.tier,
					feature=case.feature,
					kind=case.kind,
					status="FAIL",
					detail="ts-golden-mismatch",
					duration_ms=duration_ms,
					ts=ts_res,
					go=go_res,
					go_block_count=None,
					diff=cmp_gold.format_report(),
				)

		if mode == "ts":
			detail = "golden-updated" if update_golden else ("golden-matched" if check_golden else "ts-ok")
			return CaseReport(
				id=case.id,
				tier=case.tier,
				feature=case.feature,
				kind=case.kind,
				status="PASS",
				detail=detail,
				duration_ms=duration_ms,
				ts=ts_res,
				go=None,
				go_block_count=None,
				diff=None,
			)

	# Verification Go (mode == "go" ou "both")
	if go_res is None:
		return CaseReport(
			id=case.id,
			tier=case.tier,
			feature=case.feature,
			kind=case.kind,
			status="FAIL",
			detail="missing-go-result",
			duration_ms=duration_ms,
			ts=ts_res,
			go=None,
			go_block_count=None,
			diff="Resultat Go absent.",
		)
	if go_res.transpile_exit != 0:
		return CaseReport(
			id=case.id,
			tier=case.tier,
			feature=case.feature,
			kind=case.kind,
			status="FAIL",
			detail=f"go-transpile-exit-{go_res.transpile_exit}",
			duration_ms=duration_ms,
			ts=ts_res,
			go=go_res,
			go_block_count=None,
			diff=go_res.transpile_stderr.strip() or f"Transpilation en echec ({go_res.transpile_exit})",
		)
	if go_res.build_exit != 0:
		return CaseReport(
			id=case.id,
			tier=case.tier,
			feature=case.feature,
			kind=case.kind,
			status="FAIL",
			detail=f"go-build-exit-{go_res.build_exit}",
			duration_ms=duration_ms,
			ts=ts_res,
			go=go_res,
			go_block_count=None,
			diff=go_res.build_stderr.strip() or f"go build en echec ({go_res.build_exit})",
		)
	if go_res.run_exit != 0:
		return CaseReport(
			id=case.id,
			tier=case.tier,
			feature=case.feature,
			kind=case.kind,
			status="FAIL",
			detail=f"go-run-exit-{go_res.run_exit}",
			duration_ms=duration_ms,
			ts=ts_res,
			go=go_res,
			go_block_count=None,
			diff=go_res.run_stderr.strip() or f"Execution binaire Go en echec ({go_res.run_exit})",
		)

	try:
		go_blocks = normalizer.normalize_stdout(go_res.run_stdout)
	except normalizer.NormalizerParseError as exc:
		return CaseReport(
			id=case.id,
			tier=case.tier,
			feature=case.feature,
			kind=case.kind,
			status="FAIL",
			detail="go-parse-error",
			duration_ms=duration_ms,
			ts=ts_res,
			go=go_res,
			go_block_count=None,
			diff=str(exc),
		)

	if mode == "both":
		assert ts_res is not None and ts_res.blocks is not None
		expected_blocks: Sequence[normalizer.CanonicalValue] = ts_res.blocks
		detail_ok = "both-equivalent"
	else:
		try:
			gold_exit, gold_blocks = load_golden_snapshot(case.id, golden_dir=golden_dir)
		except (FileNotFoundError, TypeError, ValueError, json.JSONDecodeError) as exc:
			return CaseReport(
				id=case.id,
				tier=case.tier,
				feature=case.feature,
				kind=case.kind,
				status="FAIL",
				detail="golden-load-error",
				duration_ms=duration_ms,
				ts=None,
				go=go_res,
				go_block_count=len(go_blocks),
				diff=str(exc),
			)
		if gold_exit != 0:
			return CaseReport(
				id=case.id,
				tier=case.tier,
				feature=case.feature,
				kind=case.kind,
				status="FAIL",
				detail="golden-exit-mismatch",
				duration_ms=duration_ms,
				ts=None,
				go=go_res,
				go_block_count=len(go_blocks),
				diff=f"Golden exitCode attendu=0, trouve={gold_exit}",
			)
		expected_blocks = gold_blocks
		detail_ok = "go-golden-matched"

	cmp_res = normalizer.compare_blocks(expected_blocks, go_blocks)
	if not cmp_res.equal:
		return CaseReport(
			id=case.id,
			tier=case.tier,
			feature=case.feature,
			kind=case.kind,
			status="FAIL",
			detail="output-mismatch",
			duration_ms=duration_ms,
			ts=ts_res,
			go=go_res,
			go_block_count=len(go_blocks),
			diff=cmp_res.format_report(),
		)

	return CaseReport(
		id=case.id,
		tier=case.tier,
		feature=case.feature,
		kind=case.kind,
		status="PASS",
		detail=detail_ok,
		duration_ms=duration_ms,
		ts=ts_res,
		go=go_res,
		go_block_count=len(go_blocks),
		diff=None,
	)


def build_json_report_payload(
	args: CliArgs,
	reports: Sequence[CaseReport],
	total_duration_ms: int,
) -> dict[str, object]:
	"""Construit l'objet complet destine a --json-report."""
	passed = sum(1 for item in reports if item.status == "PASS")
	failed = len(reports) - passed
	return {
		"schemaVersion": 1,
		"timestampUtc": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
		"mode": args.mode,
		"runtime": args.runtime,
		"goLocal": args.go_local,
		"filters": {
			"tier": args.tier,
			"case": args.case,
			"includeProjects": args.include_projects,
			"projectsOnly": args.projects_only,
		},
		"summary": {
			"total": len(reports),
			"passed": passed,
			"failed": failed,
			"durationMs": total_duration_ms,
		},
		"results": [item.to_json_dict() for item in reports],
	}


def write_json_report(path: Path, payload: dict[str, object]) -> None:
	"""Ecrit le rapport JSON avec tabulations, UTF-8 et LF."""
	path.parent.mkdir(parents=True, exist_ok=True)
	rendered = json.dumps(payload, indent="\t", ensure_ascii=False, allow_nan=False) + "\n"
	with path.open("w", encoding="utf-8", newline="\n") as handle:
		_ = handle.write(rendered)


def build_arg_parser() -> argparse.ArgumentParser:
	"""Construit le parseur CLI argparse avec validation des combinaisons."""
	parser = argparse.ArgumentParser(
		description="Harnais E2E opaque-box TypeScript vs Go (croco-ecole-go-2026)"
	)
	_ = parser.add_argument(
		"--tier",
		choices=("1", "2", "3", "4", "all"),
		default="all",
		help="Filtre de tier E2E (defaut: all)",
	)
	_ = parser.add_argument(
		"--case",
		default=None,
		help="Filtre sur l'identifiant du cas (sous-chaine ou glob * / ?)",
	)
	_ = parser.add_argument(
		"--mode",
		choices=("ts", "go", "both"),
		default="ts",
		help="Mode d'execution: ts, go ou both (defaut: ts)",
	)
	_ = parser.add_argument(
		"--runtime",
		choices=("node", "bun"),
		default="node",
		help="Runtime JS/TS utilise (defaut: node)",
	)
	golden_group = parser.add_mutually_exclusive_group()
	_ = golden_group.add_argument(
		"--update-golden",
		action="store_true",
		help="Enregistre les snapshots golden TS dans robots/e2e/golden/",
	)
	_ = golden_group.add_argument(
		"--check-golden",
		action="store_true",
		help="Compare la sortie aux snapshots golden existants",
	)
	proj_group = parser.add_mutually_exclusive_group()
	_ = proj_group.add_argument(
		"--include-projects",
		action="store_true",
		help="Ajoute les exercices officiels projects/00-10",
	)
	_ = proj_group.add_argument(
		"--projects-only",
		action="store_true",
		help="Execute uniquement les exercices officiels projects/00-10",
	)
	_ = parser.add_argument(
		"--go-local",
		action="store_true",
		help="Execute transpilation et go build localement au lieu de remote.py exec",
	)
	_ = parser.add_argument(
		"--jobs",
		type=int,
		default=4,
		help="Nombre de workers locaux en parallele (defaut: 4)",
	)
	_ = parser.add_argument(
		"--remote-timeout",
		type=int,
		default=300,
		help="Timeout global du batch SSH distant en secondes (defaut: 300)",
	)
	_ = parser.add_argument(
		"--json-report",
		type=Path,
		default=None,
		help="Chemin du rapport JSON detaille a generer",
	)
	return parser


def parse_cli_args(argv: Sequence[str] | None = None) -> CliArgs:
	"""Parse et valide la coherence des arguments CLI."""
	parser = build_arg_parser()
	ns = parser.parse_args(list(argv) if argv is not None else None)

	mode = cast("RunMode", ns.mode)
	update_golden = cast("bool", ns.update_golden)
	go_local = cast("bool", ns.go_local)
	jobs = cast("int", ns.jobs)
	remote_timeout = cast("int", ns.remote_timeout)

	if update_golden and mode == "go":
		parser.error("--update-golden ne peut pas etre utilise avec --mode go seul.")
	if go_local and mode == "ts":
		parser.error("--go-local requiert --mode go ou --mode both.")
	if jobs < 1:
		parser.error("--jobs doit etre >= 1.")
	if remote_timeout < 1:
		parser.error("--remote-timeout doit etre >= 1.")

	return CliArgs(
		tier=cast("str", ns.tier),
		case=cast("str | None", ns.case),
		mode=mode,
		runtime=cast("RuntimeName", ns.runtime),
		update_golden=update_golden,
		check_golden=cast("bool", ns.check_golden),
		include_projects=cast("bool", ns.include_projects),
		projects_only=cast("bool", ns.projects_only),
		go_local=go_local,
		jobs=jobs,
		json_report=cast("Path | None", ns.json_report),
		remote_timeout=remote_timeout,
	)


def main(argv: Sequence[str] | None = None) -> int:
	"""Point d'entree principal du runner E2E."""
	args = parse_cli_args(argv)
	t0 = time.monotonic()

	try:
		cases = discover_cases(
			tier_filter=args.tier,
			case_pattern=args.case,
			include_projects=args.include_projects,
			projects_only=args.projects_only,
			cases_dir=CASES_DIR,
			projects_dir=PROJECTS_DIR,
		)
	except CaseDiscoveryError as exc:
		print(f"[e2e] Erreur de decouverte: {exc}", file=sys.stderr)
		return 1

	if not cases:
		print(
			"[e2e] Aucun cas E2E selectionne (verifier --tier, --case ou ajouter --projects-only).",
			file=sys.stderr,
		)
		return 1

	ts_results: dict[str, TsRunResult] = {}
	if args.mode in ("ts", "both"):
		positive_cases = [item for item in cases if item.kind == "positive"]
		if positive_cases:
			max_workers = min(args.jobs, len(positive_cases))
			with ThreadPoolExecutor(max_workers=max_workers) as pool:
				futures = {
					item.id: pool.submit(run_ts_case, item, args.runtime)
					for item in positive_cases
				}
				for case_id, fut in futures.items():
					ts_results[case_id] = fut.result()

	go_results: dict[str, RemoteGoCaseResult] = {}
	if args.mode in ("go", "both"):
		if args.go_local:
			max_workers = min(args.jobs, len(cases))
			with ThreadPoolExecutor(max_workers=max_workers) as pool:
				futures_go = {
					item.id: pool.submit(run_local_go_case, item, args.runtime)
					for item in cases
				}
				for case_id, fut in futures_go.items():
					go_results[case_id] = fut.result()
		else:
			try:
				if args.remote_timeout == 300:
					go_results = run_remote_go_batch(cases, args.runtime)
				else:
					go_results = run_remote_go_batch(
						cases,
						args.runtime,
						timeout_sec=args.remote_timeout,
					)
			except RemoteExecutionError as exc:
				print(f"[e2e] Erreur runner distant: {exc}", file=sys.stderr)
				return 1

	reports: list[CaseReport] = []
	for item in cases:
		ts_item = ts_results.get(item.id)
		go_item = go_results.get(item.id)
		case_ms = (
			(ts_item.duration_ms if ts_item is not None else 0)
			+ (go_item.duration_ms if go_item is not None else 0)
		)
		report = evaluate_case(
			case=item,
			mode=args.mode,
			runtime=args.runtime,
			update_golden=args.update_golden,
			check_golden=args.check_golden,
			ts_res=ts_item,
			go_res=go_item,
			duration_ms=case_ms,
			golden_dir=GOLDEN_DIR,
		)
		reports.append(report)
		status_tag = report.status
		print(f"[{status_tag}] {report.id} (tier={report.tier}, {report.detail})")
		if report.diff is not None:
			for line in report.diff.splitlines():
				print(f"       {line}")

	total_ms = int((time.monotonic() - t0) * 1000)
	passed = sum(1 for item in reports if item.status == "PASS")
	failed = len(reports) - passed
	print(f"[e2e] total={len(reports)} passed={passed} failed={failed} duration={total_ms}ms")

	if args.json_report is not None:
		payload = build_json_report_payload(args, reports, total_ms)
		write_json_report(args.json_report, payload)

	return 0 if failed == 0 else 1


if __name__ == "__main__":
	raise SystemExit(main())
