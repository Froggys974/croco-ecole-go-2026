from __future__ import annotations

import io
import json
import subprocess
import sys
import tarfile
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Final, cast
from unittest.mock import patch

E2E_DIR: Final[Path] = Path(__file__).resolve().parent
if TYPE_CHECKING:
	from . import normalizer, runner
else:
	if str(E2E_DIR) not in sys.path:
		sys.path.insert(0, str(E2E_DIR))
	import normalizer
	import runner


@dataclass(frozen=True)
class FakeCompletedProcess:
	"""Stub type de subprocess.CompletedProcess sans utiliser MagicMock."""

	returncode: int
	stdout: bytes
	stderr: bytes


class TestRule1TextCleaning(unittest.TestCase):
	"""Tests de la Regle 1 : normalisation CRLF->LF et suppression ANSI."""

	def test_crlf_cr_and_ansi_stripped(self) -> None:
		raw = "\x1b[32mok\x1b[0m\r\n\x1b]0;win\x07un opérande est négatif\r42\r\n"
		cleaned = normalizer.normalize_text(raw)
		self.assertEqual(cleaned, "ok\nun opérande est négatif\n42\n")

	def test_empty_stdout_produces_no_blocks(self) -> None:
		self.assertEqual(normalizer.normalize_stdout(""), [])
		self.assertEqual(normalizer.normalize_stdout("  \r\n\t\n "), [])


class TestRule2BlockSplitting(unittest.TestCase):
	"""Tests de la Regle 2 : decoupage contextuel des blocs stdout."""

	def test_multiline_and_adjacent_blocks(self) -> None:
		text = "{\n  a: 1,\n  b: 'x'\n}\n[ 1, 2 ]{ c: true }\n"
		blocks = normalizer.split_stdout_blocks(text)
		self.assertEqual(len(blocks), 3)
		self.assertTrue(blocks[0].startswith("{"))
		self.assertEqual(blocks[1], "[ 1, 2 ]")
		self.assertEqual(blocks[2], "{ c: true }")

	def test_braces_and_quotes_inside_strings_and_raw_scalar_lines(self) -> None:
		text = (
			"it's {not} a [block]\n"
			"{ msg: 'hello {world} [1] \\'ok\\'', tpl: `a[b]{c}` }\n"
			"['fin']\n"
		)
		blocks = normalizer.split_stdout_blocks(text)
		self.assertEqual(
			blocks,
			[
				"it's {not} a [block]",
				"{ msg: 'hello {world} [1] \\'ok\\'', tpl: `a[b]{c}` }",
				"['fin']",
			],
		)

	def test_unclosed_structure_or_mismatch_raises(self) -> None:
		with self.assertRaises(normalizer.NormalizerParseError):
			_ = normalizer.split_stdout_blocks("{ a: [1, 2 }")
		with self.assertRaises(normalizer.NormalizerParseError):
			_ = normalizer.split_stdout_blocks("{ a: 'unterminated }")
		with self.assertRaises(normalizer.NormalizerParseError):
			_ = normalizer.split_stdout_blocks("[ 1, 2")

	def test_leading_horizontal_whitespace_preserved_on_scalar_lines(self) -> None:
		ts_out = "  hello\n\t\tindented\n  42\n  { a: 1 }\n\n  [1, 2]\n"
		blocks = normalizer.split_stdout_blocks(ts_out)
		self.assertEqual(
			blocks,
			["  hello", "\t\tindented", "  42", "{ a: 1 }", "[1, 2]"],
		)
		ts_vals = normalizer.normalize_stdout("  hello\n  42\n")
		go_vals = normalizer.normalize_stdout('"  hello"\n"  42"\n')
		self.assertEqual(ts_vals, ["  hello", "  42"])
		self.assertTrue(normalizer.compare_blocks(ts_vals, go_vals).equal)


class TestRule3ParsingAndGolden(unittest.TestCase):
	"""Tests de la Regle 3 : tsx util.inspect, bun, Go JSON, scalaires et golden."""

	def test_tsx_util_inspect_vs_bun_vs_go_json(self) -> None:
		tsx_out = (
			"{\n"
			"  a: 'bonjour\\'\\n\\x41\\u00e9\\u{1F600}',\n"
			"  b: undefined,\n"
			"  c: `backtick`,\n"
			"  d: -12.5\n"
			"}\n"
		)
		bun_out = (
			"{\n"
			'  "a": "bonjour\'\\nAé😀",\n'
			'  "b": undefined,\n'
			'  "c": "backtick",\n'
			'  "d": -12.5,\n'
			"}\n"
		)
		go_out = '{"a":"bonjour\'\\nAé😀","b":null,"c":"backtick","d":-12.5}\n'

		tsx_vals = normalizer.normalize_stdout(tsx_out)
		bun_vals = normalizer.normalize_stdout(bun_out)
		go_vals = normalizer.normalize_stdout(go_out)

		self.assertEqual(tsx_vals, bun_vals)
		self.assertIs(cast("dict[str, object]", tsx_vals[0])["b"], normalizer.UNDEFINED)
		self.assertIsNone(cast("dict[str, object]", go_vals[0])["b"])

	def test_scalars_and_go_quoted_top_level_string(self) -> None:
		ts_out = "true\nfalse\nnull\nundefined\n42\n-0\n1.5\n1e-5\nun opérande est négatif\n"
		go_out = 'true\nfalse\nnull\nundefined\n42\n0\n1.5\n0.00001\n"un opérande est négatif"\n'
		ts_blocks = normalizer.normalize_stdout(ts_out)
		go_blocks = normalizer.normalize_stdout(go_out)
		self.assertEqual(
			ts_blocks,
			[True, False, None, normalizer.UNDEFINED, 42, 0, 1.5, 1e-5, "un opérande est négatif"],
		)
		res = normalizer.compare_blocks(ts_blocks, go_blocks)
		self.assertTrue(res.equal, res.format_report())

	def test_golden_round_trip_preserves_undefined_sentinel(self) -> None:
		value: normalizer.CanonicalValue = {
			normalizer.EITHER_VALUE_KEY: normalizer.UNDEFINED,
			"explicitNull": None,
			"items": [normalizer.UNDEFINED, 1, "x"],
		}
		encoded = normalizer.encode_golden_value(value)
		raw_json = json.dumps(encoded)
		self.assertIn(normalizer.UNDEFINED_JSON_SENTINEL_KEY, raw_json)
		decoded = normalizer.decode_golden_value(cast("object", json.loads(raw_json)))
		self.assertEqual(decoded, value)

	def test_invalid_js_inspect_raises(self) -> None:
		with self.assertRaises(normalizer.NormalizerParseError):
			_ = normalizer.parse_block("{ a: ??? }")

	def test_non_finite_numbers_rejected_everywhere(self) -> None:
		for raw_block in (
			'{"a": NaN}',
			"[Infinity]",
			"[-Infinity]",
			"{ a: NaN }",
			"{ a: -Infinity }",
			"NaN",
			"Infinity",
			"-Infinity",
		):
			with self.assertRaises(normalizer.NormalizerParseError):
				_ = normalizer.parse_block(raw_block)

		with self.assertRaises(normalizer.NormalizerParseError):
			_ = normalizer.encode_golden_value({"a": float("nan")})
		with self.assertRaises(normalizer.NormalizerParseError):
			_ = normalizer.encode_golden_value([float("inf")])

	def test_unicode_escapes_and_utf16_surrogates(self) -> None:
		parsed_pair = normalizer.parse_block("{ emoji: '\\uD83D\\uDE00' }")
		self.assertEqual(parsed_pair, {"emoji": "😀"})
		go_pair = normalizer.parse_block('{"emoji":"\\ud83d\\ude00"}')
		self.assertEqual(go_pair, {"emoji": "😀"})

		for bad_unicode in (
			"{ a: '\\u{110000}' }",
			"{ a: '\\u{FFFFFF}' }",
			"{ a: '\\u{D800}' }",
			"{ a: '\\uD800' }",
			"{ a: '\\uDC00' }",
			"{ a: '\\uD83D\\u0041' }",
			'{"a": "\\uD800"}',
		):
			with self.assertRaises(normalizer.NormalizerParseError):
				_ = normalizer.parse_block(bad_unicode)

		cmp_err = normalizer.compare_blocks([parsed_pair], [{"emoji": "x"}])
		self.assertFalse(cmp_err.equal)
		_ = cmp_err.format_report().encode("utf-8")


class TestRule4EitherUndefined(unittest.TestCase):
	"""Tests de la Regle 4 : JSUndefined sur @duplojs/lang/kind/@DuplojsLangEither/value."""

	def test_either_undefined_accepts_null_and_omitted(self) -> None:
		expected: list[normalizer.CanonicalValue] = [
			{
				"@duplojs/lang/kind/@DuplojsLangEither/left": None,
				"@duplojs/lang/kind/@DuplojsLangEither/information": "fail",
				normalizer.EITHER_VALUE_KEY: normalizer.UNDEFINED,
				"@duplojs/lang/kind/@DuplojsLangEither/fail": None,
			}
		]
		go_null: list[normalizer.CanonicalValue] = [
			{
				"@duplojs/lang/kind/@DuplojsLangEither/left": None,
				"@duplojs/lang/kind/@DuplojsLangEither/information": "fail",
				normalizer.EITHER_VALUE_KEY: None,
				"@duplojs/lang/kind/@DuplojsLangEither/fail": None,
			}
		]
		go_omitzero: list[normalizer.CanonicalValue] = [
			{
				"@duplojs/lang/kind/@DuplojsLangEither/left": None,
				"@duplojs/lang/kind/@DuplojsLangEither/information": "fail",
				"@duplojs/lang/kind/@DuplojsLangEither/fail": None,
			}
		]
		go_concrete: list[normalizer.CanonicalValue] = [
			{
				"@duplojs/lang/kind/@DuplojsLangEither/left": None,
				"@duplojs/lang/kind/@DuplojsLangEither/information": "fail",
				normalizer.EITHER_VALUE_KEY: 0,
				"@duplojs/lang/kind/@DuplojsLangEither/fail": None,
			}
		]
		self.assertTrue(normalizer.compare_blocks(expected, go_null).equal)
		self.assertTrue(normalizer.compare_blocks(expected, go_omitzero).equal)
		self.assertFalse(normalizer.compare_blocks(expected, go_concrete).equal)

	def test_explicit_null_either_rejects_omitted_and_undefined(self) -> None:
		expected: list[normalizer.CanonicalValue] = [
			{
				"@duplojs/lang/kind/@DuplojsLangEither/left": None,
				"@duplojs/lang/kind/@DuplojsLangEither/information": "info",
				normalizer.EITHER_VALUE_KEY: None,
			}
		]
		actual_omitted: list[normalizer.CanonicalValue] = [
			{
				"@duplojs/lang/kind/@DuplojsLangEither/left": None,
				"@duplojs/lang/kind/@DuplojsLangEither/information": "info",
			}
		]
		actual_undefined: list[normalizer.CanonicalValue] = [
			{
				"@duplojs/lang/kind/@DuplojsLangEither/left": None,
				"@duplojs/lang/kind/@DuplojsLangEither/information": "info",
				normalizer.EITHER_VALUE_KEY: normalizer.UNDEFINED,
			}
		]
		self.assertFalse(normalizer.compare_blocks(expected, actual_omitted).equal)
		self.assertFalse(normalizer.compare_blocks(expected, actual_undefined).equal)

	def test_non_either_undefined_strict(self) -> None:
		exp_obj: list[normalizer.CanonicalValue] = [{"a": normalizer.UNDEFINED}]
		act_null: list[normalizer.CanonicalValue] = [{"a": None}]
		act_empty: list[normalizer.CanonicalValue] = [{}]
		self.assertFalse(normalizer.compare_blocks(exp_obj, act_null).equal)
		self.assertFalse(normalizer.compare_blocks(exp_obj, act_empty).equal)


class TestRule5NumbersAndBool(unittest.TestCase):
	"""Tests de la Regle 5 : bool strict avant float64, -0 == 0, tolerance 1e-12."""

	def test_numeric_equivalence_and_tolerance(self) -> None:
		self.assertTrue(normalizer.compare_blocks([3], [3.0]).equal)
		self.assertTrue(normalizer.compare_blocks([-0.0], [0]).equal)
		self.assertTrue(normalizer.compare_blocks([3.3333333333335], [3.333333333333]).equal)
		self.assertFalse(normalizer.compare_blocks([3.333333333], [3.333333334]).equal)

	def test_bool_never_matches_int(self) -> None:
		self.assertFalse(normalizer.compare_blocks([True], [1]).equal)
		self.assertFalse(normalizer.compare_blocks([False], [0]).equal)
		self.assertFalse(normalizer.compare_blocks([1], [True]).equal)
		self.assertTrue(normalizer.compare_blocks([True], [True]).equal)

	def test_string_zero_vs_negative_zero_and_42_distinct(self) -> None:
		self.assertFalse(normalizer.compare_blocks([["0"]], [["-0"]]).equal)
		self.assertFalse(normalizer.compare_blocks([[42]], [["42"]]).equal)


class TestRule6EmptyArray(unittest.TestCase):
	"""Tests de la Regle 6 : [] strictement distinct de null (nil slice)."""

	def test_empty_array_rejects_null(self) -> None:
		self.assertTrue(normalizer.compare_blocks([[]], [[]]).equal)
		res = normalizer.compare_blocks([[]], [None])
		self.assertFalse(res.equal)
		self.assertIn("nil slice", res.format_report())
		self.assertFalse(normalizer.compare_blocks([{"items": []}], [{"items": None}]).equal)


class TestRule7TupleEquivalence(unittest.TestCase):
	"""Tests de la Regle 7 : equivalence TupleN V0..VN-1."""

	def test_valid_tuple_bidirectional_and_nested(self) -> None:
		ts_list: list[normalizer.CanonicalValue] = [[1, "a", True]]
		go_tuple: list[normalizer.CanonicalValue] = [{"V0": 1, "V1": "a", "V2": True}]
		self.assertTrue(normalizer.compare_blocks(ts_list, go_tuple).equal)
		self.assertTrue(normalizer.compare_blocks(go_tuple, ts_list).equal)

		nested_ts: list[normalizer.CanonicalValue] = [[[1, 2], [3, 4]]]
		nested_go: list[normalizer.CanonicalValue] = [[{"V0": 1, "V1": 2}, {"V0": 3, "V1": 4}]]
		self.assertTrue(normalizer.compare_blocks(nested_ts, nested_go).equal)

	def test_invalid_tuple_shapes_rejected(self) -> None:
		self.assertFalse(normalizer.compare_blocks([[1, 2]], [{"V0": 1, "V2": 2}]).equal)
		self.assertFalse(normalizer.compare_blocks([[1, 2]], [{"V1": 1, "V2": 2}]).equal)
		self.assertFalse(normalizer.compare_blocks([[1, 2]], [{"V0": 1, "V1": 2, "extra": 3}]).equal)
		self.assertFalse(normalizer.compare_blocks([[1, 2]], [{"v0": 1, "v1": 2}]).equal)
		self.assertFalse(normalizer.compare_blocks([[]], [{}]).equal)


class TestRule8DictAndDiffs(unittest.TestCase):
	"""Tests de la Regle 8 : ordre de cles ignore et diff JSONPath structure."""

	def test_key_order_ignored_and_paths_reported(self) -> None:
		self.assertTrue(normalizer.compare_blocks([{"b": 2, "a": 1}], [{"a": 1, "b": 2}]).equal)
		res = normalizer.compare_blocks(
			[{"items": [{"price": 10}, {"price": 20}]}],
			[{"items": [{"price": 10}, {"price": 99}]}],
		)
		self.assertFalse(res.equal)
		self.assertEqual(res.diffs[0].path, "$[0].items[1].price")

	def test_block_count_mismatch(self) -> None:
		res = normalizer.compare_blocks([1, 2], [1])
		self.assertFalse(res.equal)
		self.assertEqual(res.diffs[0].reason, "block count mismatch")


class TestOfficialProjects00To10(unittest.TestCase):
	"""Tests de bout en bout normalizer sur les formats reels tsx/bun/Go de 00 a 10."""

	def test_projects_00_to_10_formats_equivalent(self) -> None:
		samples: list[tuple[str, str, str]] = [
			("", "", ""),
			(
				"{\n  '@duplojs/lang/kind/@DuplojsLangEither/right': null,\n"
				+ "  '@duplojs/lang/kind/@DuplojsLangEither/information': 'success',\n"
				+ "  '@duplojs/lang/kind/@DuplojsLangEither/value': 3,\n"
				+ "  '@duplojs/lang/kind/@DuplojsLangEither/success': null\n}\n",
				'{\n  "@duplojs/lang/kind/@DuplojsLangEither/right": null,\n'
				+ '  "@duplojs/lang/kind/@DuplojsLangEither/information": "success",\n'
				+ '  "@duplojs/lang/kind/@DuplojsLangEither/value": 3,\n'
				+ '  "@duplojs/lang/kind/@DuplojsLangEither/success": null,\n}\n',
				'{"@duplojs/lang/kind/@DuplojsLangEither/right":null,'
				+ '"@duplojs/lang/kind/@DuplojsLangEither/information":"success",'
				+ '"@duplojs/lang/kind/@DuplojsLangEither/value":3,'
				+ '"@duplojs/lang/kind/@DuplojsLangEither/success":null}\n',
			),
			(
				"{\n  '@duplojs/lang/kind/@DuplojsLangEither/left': null,\n"
				+ "  '@duplojs/lang/kind/@DuplojsLangEither/information': 'fail',\n"
				+ "  '@duplojs/lang/kind/@DuplojsLangEither/value': undefined,\n"
				+ "  '@duplojs/lang/kind/@DuplojsLangEither/fail': null\n}\n",
				'{\n  "@duplojs/lang/kind/@DuplojsLangEither/left": null,\n'
				+ '  "@duplojs/lang/kind/@DuplojsLangEither/information": "fail",\n'
				+ '  "@duplojs/lang/kind/@DuplojsLangEither/value": undefined,\n'
				+ '  "@duplojs/lang/kind/@DuplojsLangEither/fail": null,\n}\n',
				'{"@duplojs/lang/kind/@DuplojsLangEither/left":null,'
				+ '"@duplojs/lang/kind/@DuplojsLangEither/information":"fail",'
				+ '"@duplojs/lang/kind/@DuplojsLangEither/fail":null}\n',
			),
			(
				"[ '-12' ]\nun opérande est négatif\n",
				'[ "-12" ]\nun opérande est négatif\n',
				'["-12"]\n"un opérande est négatif"\n',
			),
			(
				"[ '-12' ]\ndivision par zéro impossible\n",
				'[ "-12" ]\ndivision par zéro impossible\n',
				'["-12"]\ndivision par zéro impossible\n',
			),
			(
				"[ '3', '3', 'échec' ]\n",
				'[ "3", "3", "échec" ]\n',
				'["3","3","échec"]\n',
			),
			(
				"[ 'transaction annulée' ]\n",
				'[ "transaction annulée" ]\n',
				'["transaction annulée"]\n',
			),
		]
		for tsx_raw, bun_raw, go_raw in samples:
			tsx_blocks = normalizer.normalize_stdout(tsx_raw)
			bun_blocks = normalizer.normalize_stdout(bun_raw)
			go_blocks = normalizer.normalize_stdout(go_raw)
			self.assertTrue(normalizer.compare_blocks(tsx_blocks, bun_blocks).equal)
			self.assertTrue(normalizer.compare_blocks(tsx_blocks, go_blocks).equal)


class TestVerifyRejectOutput(unittest.TestCase):
	"""Tests de verification des sorties stderr de rejet transpileur."""

	def test_valid_and_invalid_reject_outputs(self) -> None:
		ok_transform = normalizer.verify_reject_output(
			1,
			"NotRightError: Value is not Right.\n information: 'transformation-error'",
		)
		self.assertTrue(ok_transform.equal)

		ok_notfound = normalizer.verify_reject_output(
			1,
			"either-not-right-error: notfound-transformer",
		)
		self.assertTrue(ok_notfound.equal)

		bad_zero = normalizer.verify_reject_output(0, "NotRightError transformation-error")
		self.assertFalse(bad_zero.equal)

		bad_syntax = normalizer.verify_reject_output(1, "SyntaxError: Unexpected token")
		self.assertFalse(bad_syntax.equal)


class TestRunnerGoMocks(unittest.TestCase):
	"""Tests unitaires et mocks types de robots/e2e/runner.py (--mode go & reject)."""

	def _create_temp_cases(self, root: Path) -> tuple[Path, Path]:
		cases_dir = root / "cases"
		golden_dir = root / "golden"

		pos_dir = cases_dir / "tier1" / "t1_pos_ok"
		pos_dir.mkdir(parents=True)
		_ = (pos_dir / "case.json").write_text(
			json.dumps({
				"id": "t1_pos_ok",
				"tier": 1,
				"feature": "DEither.success",
				"kind": "positive",
				"entry": "index.ts",
				"description": "positive case",
				"expectRejectCategory": None,
			}),
			encoding="utf-8",
		)
		_ = (pos_dir / "tsconfig.json").write_text(
			'{"extends": "@duplojs/code-config/tsconfig/base.json", "include": ["*.ts"]}',
			encoding="utf-8",
		)
		_ = (pos_dir / "index.ts").write_text('console.info("ok");\n', encoding="utf-8")

		rej_dir = cases_dir / "tier2" / "t2_rej_eval"
		rej_dir.mkdir(parents=True)
		_ = (rej_dir / "case.json").write_text(
			json.dumps({
				"id": "t2_rej_eval",
				"tier": 2,
				"feature": "reject",
				"kind": "reject",
				"entry": "index.ts",
				"description": "reject eval",
				"expectRejectCategory": "meta-js",
			}),
			encoding="utf-8",
		)
		_ = (rej_dir / "tsconfig.json").write_text(
			'{"extends": "@duplojs/code-config/tsconfig/base.json", "include": ["*.ts"]}',
			encoding="utf-8",
		)
		_ = (rej_dir / "index.ts").write_text('eval("1+1");\n', encoding="utf-8")

		return cases_dir, golden_dir

	def test_build_remote_archive_contents_and_exclusions(self) -> None:
		with tempfile.TemporaryDirectory() as tmp:
			tmp_path = Path(tmp)
			cases_dir, _ = self._create_temp_cases(tmp_path)
			# Ajouter un dossier dist a exclure dans un cas
			dist_dir = cases_dir / "tier1" / "t1_pos_ok" / "dist"
			dist_dir.mkdir()
			_ = (dist_dir / "ignored.go").write_text("package main\n", encoding="utf-8")

			cases = runner.discover_cases(cases_dir=cases_dir, projects_dir=tmp_path / "missing")
			self.assertEqual([c.id for c in cases], ["t1_pos_ok", "t2_rej_eval"])

			archive_bytes = runner.build_remote_archive(cases, runtime="node")
			with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:gz") as tar:
				names = set(tar.getnames())
				self.assertIn("_e2e_manifest.json", names)
				self.assertIn("_remote_driver.mjs", names)
				self.assertIn("cases/tier1/t1_pos_ok/index.ts", names)
				self.assertIn("cases/tier2/t2_rej_eval/index.ts", names)
				self.assertNotIn("cases/tier1/t1_pos_ok/dist/ignored.go", names)

				manifest_member = tar.extractfile("_e2e_manifest.json")
				assert manifest_member is not None
				manifest = cast("dict[str, object]", json.loads(manifest_member.read().decode("utf-8")))
				self.assertEqual(manifest["runtime"], "node")
				driver_member = tar.extractfile("_remote_driver.mjs")
				assert driver_member is not None
				driver_src = driver_member.read().decode("utf-8")
				self.assertIn("go", driver_src)
				self.assertIn(runner.E2E_JSON_BEGIN, driver_src)

	def test_parse_remote_payload_ignores_sync_banner(self) -> None:
		raw = (
			"[sync] Envoi de 48.2 Ko vers /workspace...\n"
			+ "log bruit avant\n"
			+ f"{runner.E2E_JSON_BEGIN}\n"
			+ json.dumps({
				"results": [
					{
						"id": "t1_pos_ok",
						"transpileExit": 0,
						"transpileStdout": "",
						"transpileStderr": "",
						"buildExit": 0,
						"buildStdout": "",
						"buildStderr": "",
						"runExit": 0,
						"runStdout": "42\n",
						"runStderr": "",
					}
				]
			})
			+ f"\n{runner.E2E_JSON_END}\n"
		)
		parsed = runner.parse_remote_payload(raw)
		self.assertEqual(len(parsed), 1)
		self.assertEqual(parsed[0].id, "t1_pos_ok")
		self.assertEqual(parsed[0].run_stdout, "42\n")

		with self.assertRaises(runner.RemoteExecutionError):
			_ = runner.parse_remote_payload("[sync] Envoi de 10 Ko vers /workspace...")

	def test_parse_remote_payload_handles_inner_markers(self) -> None:
		inner = (
			f"before {runner.E2E_JSON_BEGIN}\n"
			f"middle {runner.E2E_JSON_END}\n"
			"after"
		)
		raw = (
			"[sync] Envoi de 12.0 Ko vers /workspace...\n"
			+ f"{runner.E2E_JSON_BEGIN}\n"
			+ json.dumps({
				"results": [
					{
						"id": "t1_markers",
						"transpileExit": 0,
						"transpileStdout": "",
						"transpileStderr": "",
						"buildExit": 0,
						"buildStdout": "",
						"buildStderr": "",
						"runExit": 0,
						"runStdout": inner,
						"runStderr": "",
						"durationMs": 42,
					}
				]
			})
			+ f"\n{runner.E2E_JSON_END}\n"
		)
		parsed = runner.parse_remote_payload(raw)
		self.assertEqual(len(parsed), 1)
		self.assertEqual(parsed[0].run_stdout, inner)
		self.assertEqual(parsed[0].duration_ms, 42)

		# Marqueurs inverses doivent echouer
		inverted = f"{runner.E2E_JSON_END}\n{{\"results\": []}}\n{runner.E2E_JSON_BEGIN}\n"
		with self.assertRaises(runner.RemoteExecutionError):
			_ = runner.parse_remote_payload(inverted)

	def test_build_remote_archive_normalizes_windows_entry_rel(self) -> None:
		with tempfile.TemporaryDirectory() as tmp:
			tmp_path = Path(tmp)
			cases_dir = tmp_path / "cases"
			case_dir = cases_dir / "tier1" / "t1_win_entry"
			sub_dir = case_dir / "sub"
			sub_dir.mkdir(parents=True)
			_ = (case_dir / "case.json").write_text(
				json.dumps({
					"id": "t1_win_entry",
					"tier": 1,
					"feature": "entry",
					"kind": "positive",
					"entry": "sub\\entry.ts",
					"description": "windows entry path",
					"expectRejectCategory": None,
				}),
				encoding="utf-8",
			)
			_ = (case_dir / "tsconfig.json").write_text("{}", encoding="utf-8")
			_ = (sub_dir / "entry.ts").write_text("console.info(1);\n", encoding="utf-8")

			cases = runner.discover_cases(cases_dir=cases_dir, projects_dir=tmp_path / "missing")
			archive_bytes = runner.build_remote_archive(cases, runtime="node")
			with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:gz") as tar:
				manifest_member = tar.extractfile("_e2e_manifest.json")
				assert manifest_member is not None
				manifest = cast("dict[str, object]", json.loads(manifest_member.read().decode("utf-8")))
				manifest_cases = cast("list[dict[str, object]]", manifest["cases"])
				self.assertEqual(
					manifest_cases[0]["entryRel"],
					"cases/tier1/t1_win_entry/sub/entry.ts",
				)
				driver_member = tar.extractfile("_remote_driver.mjs")
				assert driver_member is not None
				self.assertIn("durationMs", driver_member.read().decode("utf-8"))

	def test_run_remote_go_batch_mocked_subprocess(self) -> None:
		with tempfile.TemporaryDirectory() as tmp:
			tmp_path = Path(tmp)
			cases_dir, _ = self._create_temp_cases(tmp_path)
			cases = runner.discover_cases(cases_dir=cases_dir, projects_dir=tmp_path / "missing")

			captured_cmds: list[list[str]] = []
			captured_inputs: list[bytes | None] = []

			payload = (
				"[sync] Envoi de 12.3 Ko vers /workspace...\n"
				+ f"{runner.E2E_JSON_BEGIN}\n"
				+ json.dumps({
					"results": [
						{
							"id": "t1_pos_ok",
							"transpileExit": 0,
							"transpileStdout": "",
							"transpileStderr": "",
							"buildExit": 0,
							"buildStdout": "",
							"buildStderr": "",
							"runExit": 0,
							"runStdout": '"ok"\n',
							"runStderr": "",
						},
						{
							"id": "t2_rej_eval",
							"transpileExit": 1,
							"transpileStdout": "",
							"transpileStderr": "NotRightError: notfound-transformer",
							"buildExit": None,
							"buildStdout": "",
							"buildStderr": "",
							"runExit": None,
							"runStdout": "",
							"runStderr": "",
						},
					]
				})
				+ f"\n{runner.E2E_JSON_END}\n"
			).encode("utf-8")

			def fake_subprocess_run(
				cmd: list[str],
				cwd: Path | None = None,
				input: bytes | None = None,
				capture_output: bool = False,
				timeout: int | None = None,
				check: bool = False,
			) -> FakeCompletedProcess:
				_ = (cwd, capture_output, timeout, check)
				captured_cmds.append(list(cmd))
				captured_inputs.append(input)
				return FakeCompletedProcess(returncode=0, stdout=payload, stderr=b"")

			with patch.object(subprocess, "run", side_effect=fake_subprocess_run):
				res_map = runner.run_remote_go_batch(cases, runtime="node")

			self.assertEqual(len(captured_cmds), 1)
			self.assertIn("exec", captured_cmds[0])
			self.assertIn("ln -sfn /workspace/node_modules /tmp/e2e/node_modules", captured_cmds[0][-1])
			self.assertIsNotNone(captured_inputs[0])
			assert captured_inputs[0] is not None
			with tarfile.open(fileobj=io.BytesIO(captured_inputs[0]), mode="r:gz") as tar:
				self.assertIn("_remote_driver.mjs", tar.getnames())

			self.assertEqual(res_map["t1_pos_ok"].run_exit, 0)
			self.assertEqual(res_map["t2_rej_eval"].transpile_exit, 1)

	def test_run_remote_go_batch_raises_on_ssh_failure(self) -> None:
		with tempfile.TemporaryDirectory() as tmp:
			tmp_path = Path(tmp)
			cases_dir, _ = self._create_temp_cases(tmp_path)
			cases = runner.discover_cases(cases_dir=cases_dir, projects_dir=tmp_path / "missing")

			def fake_fail(
				cmd: list[str],
				cwd: Path | None = None,
				input: bytes | None = None,
				capture_output: bool = False,
				timeout: int | None = None,
				check: bool = False,
			) -> FakeCompletedProcess:
				_ = (cmd, cwd, input, capture_output, timeout, check)
				return FakeCompletedProcess(
					returncode=255,
					stdout=b"",
					stderr=b"ssh: connect to host 192.168.100.136 port 2222: Connection timed out",
				)

			with (
				patch.object(subprocess, "run", side_effect=fake_fail),
				self.assertRaises(runner.RemoteExecutionError),
			):
				_ = runner.run_remote_go_batch(cases, runtime="node")

	def test_evaluate_case_positive_reject_and_ts_mode(self) -> None:
		with tempfile.TemporaryDirectory() as tmp:
			tmp_path = Path(tmp)
			cases_dir, golden_dir = self._create_temp_cases(tmp_path)
			cases = runner.discover_cases(cases_dir=cases_dir, projects_dir=tmp_path / "missing")
			pos_case, rej_case = cases[0], cases[1]

			# Ecrire golden pour t1_pos_ok
			ts_ok = runner.TsRunResult(
				exit_code=0,
				stdout="ok\n",
				stderr="",
				blocks=("ok",),
				parse_error=None,
			)
			_ = runner.write_golden_snapshot(pos_case.id, "node", ts_ok, golden_dir=golden_dir)

			# Mode ts sur reject -> PASS statique sans toucher golden
			rep_ts_rej = runner.evaluate_case(
				case=rej_case,
				mode="ts",
				runtime="node",
				update_golden=True,
				check_golden=False,
				ts_res=None,
				go_res=None,
				duration_ms=5,
				golden_dir=golden_dir,
			)
			self.assertEqual(rep_ts_rej.status, "PASS")
			self.assertEqual(rep_ts_rej.detail, "reject-fixture-ready")
			self.assertFalse((golden_dir / "t2_rej_eval.json").exists())

			# Mode go sur positive + reject
			go_pos_ok = runner.RemoteGoCaseResult(
				id=pos_case.id,
				transpile_exit=0,
				transpile_stdout="",
				transpile_stderr="",
				build_exit=0,
				build_stdout="",
				build_stderr="",
				run_exit=0,
				run_stdout='"ok"\n',
				run_stderr="",
			)
			rep_go_pos = runner.evaluate_case(
				case=pos_case,
				mode="go",
				runtime="node",
				update_golden=False,
				check_golden=False,
				ts_res=None,
				go_res=go_pos_ok,
				duration_ms=10,
				golden_dir=golden_dir,
			)
			self.assertEqual(rep_go_pos.status, "PASS")

			go_rej_ok = runner.RemoteGoCaseResult(
				id=rej_case.id,
				transpile_exit=1,
				transpile_stdout="",
				transpile_stderr="NotRightError: transformation-error",
				build_exit=None,
				build_stdout="",
				build_stderr="",
				run_exit=None,
				run_stdout="",
				run_stderr="",
			)
			rep_go_rej = runner.evaluate_case(
				case=rej_case,
				mode="go",
				runtime="node",
				update_golden=False,
				check_golden=False,
				ts_res=None,
				go_res=go_rej_ok,
				duration_ms=10,
				golden_dir=golden_dir,
			)
			self.assertEqual(rep_go_rej.status, "PASS")

			go_rej_bad = runner.RemoteGoCaseResult(
				id=rej_case.id,
				transpile_exit=0,
				transpile_stdout="",
				transpile_stderr="",
				build_exit=0,
				build_stdout="",
				build_stderr="",
				run_exit=0,
				run_stdout="",
				run_stderr="",
			)
			rep_go_rej_fail = runner.evaluate_case(
				case=rej_case,
				mode="go",
				runtime="node",
				update_golden=False,
				check_golden=False,
				ts_res=None,
				go_res=go_rej_bad,
				duration_ms=10,
				golden_dir=golden_dir,
			)
			self.assertEqual(rep_go_rej_fail.status, "FAIL")

	def test_main_go_mode_and_json_report_mocked(self) -> None:
		with tempfile.TemporaryDirectory() as tmp:
			tmp_path = Path(tmp)
			cases_dir, golden_dir = self._create_temp_cases(tmp_path)
			report_path = tmp_path / "reports" / "e2e_report.json"

			ts_ok = runner.TsRunResult(
				exit_code=0,
				stdout="ok\n",
				stderr="",
				blocks=("ok",),
				parse_error=None,
			)
			_ = runner.write_golden_snapshot("t1_pos_ok", "node", ts_ok, golden_dir=golden_dir)

			def fake_batch(
				cases: list[runner.E2ECase],
				runtime: runner.RuntimeName,
				timeout_sec: int = 300,
			) -> dict[str, runner.RemoteGoCaseResult]:
				_ = (cases, runtime, timeout_sec)
				return {
					"t1_pos_ok": runner.RemoteGoCaseResult(
						id="t1_pos_ok",
						transpile_exit=0,
						transpile_stdout="",
						transpile_stderr="",
						build_exit=0,
						build_stdout="",
						build_stderr="",
						run_exit=0,
						run_stdout='"ok"\n',
						run_stderr="",
						duration_ms=17,
					),
					"t2_rej_eval": runner.RemoteGoCaseResult(
						id="t2_rej_eval",
						transpile_exit=1,
						transpile_stdout="",
						transpile_stderr="NotRightError: notfound-transformer",
						build_exit=None,
						build_stdout="",
						build_stderr="",
						run_exit=None,
						run_stdout="",
						run_stderr="",
						duration_ms=9,
					),
				}

			with (
				patch.object(runner, "CASES_DIR", cases_dir),
				patch.object(runner, "GOLDEN_DIR", golden_dir),
				patch.object(runner, "run_remote_go_batch", side_effect=fake_batch),
			):
				exit_code = runner.main(["--mode", "go", "--json-report", str(report_path)])

			self.assertEqual(exit_code, 0)
			self.assertTrue(report_path.is_file())
			raw_report = report_path.read_bytes()
			self.assertNotIn(b"\r", raw_report)
			report_obj = cast("dict[str, object]", json.loads(raw_report.decode("utf-8")))
			summary = cast("dict[str, object]", report_obj["summary"])
			self.assertEqual(summary["total"], 2)
			self.assertEqual(summary["passed"], 2)
			self.assertEqual(summary["failed"], 0)
			results = cast("list[dict[str, object]]", report_obj["results"])
			durations_by_id = {cast("str", item["id"]): item["durationMs"] for item in results}
			self.assertEqual(durations_by_id, {"t1_pos_ok": 17, "t2_rej_eval": 9})

	def test_tier_filter_with_include_projects_and_remote_timeout(self) -> None:
		with tempfile.TemporaryDirectory() as tmp:
			tmp_path = Path(tmp)
			cases_dir, golden_dir = self._create_temp_cases(tmp_path)
			projects_dir = tmp_path / "projects"
			p00 = projects_dir / "00"
			p00.mkdir(parents=True)
			_ = (p00 / "tsconfig.json").write_text("{}", encoding="utf-8")
			_ = (p00 / "index.ts").write_text("console.info(1);\n", encoding="utf-8")

			# --tier 1 --include-projects exclut proj_00 (tier 4)
			tier1_cases = runner.discover_cases(
				tier_filter="1",
				include_projects=True,
				cases_dir=cases_dir,
				projects_dir=projects_dir,
			)
			self.assertEqual([c.id for c in tier1_cases], ["t1_pos_ok"])

			# --tier 4 --include-projects inclut proj_00
			tier4_cases = runner.discover_cases(
				tier_filter="4",
				include_projects=True,
				cases_dir=cases_dir,
				projects_dir=projects_dir,
			)
			self.assertEqual([c.id for c in tier4_cases], ["proj_00"])

			# --projects-only inclut proj_00 meme si tier_filter="1"
			proj_only = runner.discover_cases(
				tier_filter="1",
				projects_only=True,
				cases_dir=cases_dir,
				projects_dir=projects_dir,
			)
			self.assertEqual([c.id for c in proj_only], ["proj_00"])

			# --remote-timeout invalide (< 1) sort avec SystemExit(2)
			with self.assertRaises(SystemExit) as sys_exc:
				_ = runner.parse_cli_args(["--remote-timeout", "0"])
			self.assertEqual(sys_exc.exception.code, 2)

			# --remote-timeout 600 transmet timeout_sec=600 a run_remote_go_batch
			seen_timeouts: list[int] = []

			def fake_batch_timeout(
				cases: list[runner.E2ECase],
				runtime: runner.RuntimeName,
				timeout_sec: int = 300,
			) -> dict[str, runner.RemoteGoCaseResult]:
				_ = (cases, runtime)
				seen_timeouts.append(timeout_sec)
				return {
					"t1_pos_ok": runner.RemoteGoCaseResult(
						id="t1_pos_ok",
						transpile_exit=0,
						transpile_stdout="",
						transpile_stderr="",
						build_exit=0,
						build_stdout="",
						build_stderr="",
						run_exit=0,
						run_stdout='"ok"\n',
						run_stderr="",
						duration_ms=5,
					)
				}

			ts_ok = runner.TsRunResult(
				exit_code=0,
				stdout="ok\n",
				stderr="",
				blocks=("ok",),
				parse_error=None,
				duration_ms=3,
			)
			_ = runner.write_golden_snapshot("t1_pos_ok", "node", ts_ok, golden_dir=golden_dir)

			with (
				patch.object(runner, "CASES_DIR", cases_dir),
				patch.object(runner, "GOLDEN_DIR", golden_dir),
				patch.object(runner, "PROJECTS_DIR", projects_dir),
				patch.object(runner, "run_remote_go_batch", side_effect=fake_batch_timeout),
			):
				rc = runner.main([
					"--tier",
					"1",
					"--include-projects",
					"--mode",
					"go",
					"--remote-timeout",
					"600",
				])
			self.assertEqual(rc, 0)
			self.assertEqual(seen_timeouts, [600])

	def test_golden_and_report_reject_non_finite_floats(self) -> None:
		with tempfile.TemporaryDirectory() as tmp:
			tmp_path = Path(tmp)
			bad_ts = runner.TsRunResult(
				exit_code=0,
				stdout="",
				stderr="",
				blocks=(float("nan"),),
				parse_error=None,
			)
			with self.assertRaises(normalizer.NormalizerParseError):
				_ = runner.write_golden_snapshot("bad_nan", "node", bad_ts, golden_dir=tmp_path)

			args = runner.parse_cli_args([])
			payload = runner.build_json_report_payload(args, [], 0)
			payload["nanField"] = float("inf")
			with self.assertRaises(ValueError):
				runner.write_json_report(tmp_path / "report.json", payload)


class TestStyleAndEncoding(unittest.TestCase):
	"""Verifie les conventions depot (tabulations et LF) sur robots/e2e/*.py."""

	def test_python_files_use_tabs_and_lf(self) -> None:
		py_files = sorted(E2E_DIR.glob("*.py"))
		self.assertGreaterEqual(len(py_files), 3)
		for path in py_files:
			raw = path.read_bytes()
			self.assertNotIn(b"\r", raw, f"CRLF detecte dans {path}")
			text = raw.decode("utf-8")
			for line_no, line in enumerate(text.splitlines(), start=1):
				if not line.strip():
					continue
				self.assertFalse(
					line.startswith(" "),
					f"Indentation par espaces interdite a {path.name}:{line_no}",
				)


if __name__ == "__main__":
	_ = unittest.main()
