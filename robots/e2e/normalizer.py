from __future__ import annotations

import json
import math
import re
from collections.abc import Sequence
from dataclasses import dataclass
from enum import Enum
from typing import Final, NoReturn, cast

EITHER_VALUE_KEY: Final[str] = "@duplojs/lang/kind/@DuplojsLangEither/value"
UNDEFINED_JSON_SENTINEL_KEY: Final[str] = "__e2e_undefined__"
FLOAT_ABS_TOLERANCE: Final[float] = 1e-12

ANSI_RE: Final[re.Pattern[str]] = re.compile(
	r"\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))"
)
NUMBER_RE: Final[re.Pattern[str]] = re.compile(
	r"^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$"
)


class UndefinedSentinel(Enum):
	"""Marqueur canonique distinct de None pour representer undefined."""

	UNDEFINED = "UNDEFINED"


UNDEFINED: Final[UndefinedSentinel] = UndefinedSentinel.UNDEFINED

type CanonicalPrimitive = str | int | float | bool | None | UndefinedSentinel
type CanonicalValue = CanonicalPrimitive | list[CanonicalValue] | dict[str, CanonicalValue]


class NormalizerParseError(ValueError):
	"""Erreur levee lors du decoupage ou du parsing d'une sortie stdout."""


@dataclass(frozen=True)
class DiffItem:
	"""Ecart elementaire detecte entre une sortie attendue et une sortie observee."""

	path: str
	reason: str
	expected: str
	actual: str


@dataclass(frozen=True)
class ComparisonResult:
	"""Resultat structure d'une comparaison E2E."""

	equal: bool
	diffs: tuple[DiffItem, ...]

	def format_report(self) -> str:
		"""Formate les ecarts en texte multi-lignes lisible."""
		if self.equal:
			return "OK"
		lines: list[str] = []
		for item in self.diffs:
			lines.append(
				f"- {item.path}: {item.reason} (attendu={item.expected}, obtenu={item.actual})"
			)
		return "\n".join(lines)


def normalize_text(raw_stdout: str) -> str:
	"""Normalise les fins de ligne en LF et supprime les codes ANSI."""
	lf_text = raw_stdout.replace("\r\n", "\n").replace("\r", "\n")
	return ANSI_RE.sub("", lf_text)


def split_stdout_blocks(cleaned_stdout: str) -> list[str]:
	"""Decoupe stdout en blocs logiques selon la profondeur {}/[] hors chaines."""
	blocks: list[str] = []
	length = len(cleaned_stdout)
	i = 0

	while i < length:
		# Ignorer uniquement les lignes vides avant de verifier les espaces horizontaux
		while i < length and cleaned_stdout[i] == "\n":
			i += 1
		if i >= length:
			break

		# Regarder au-dela des espaces horizontaux pour savoir si la ligne ouvre {/[ ou est blanche
		peek = i
		while peek < length and cleaned_stdout[peek] in (" ", "\t"):
			peek += 1
		if peek >= length or cleaned_stdout[peek] == "\n":
			i = peek + 1 if peek < length else peek
			continue

		ch = cleaned_stdout[peek]
		if ch in ("{", "["):
			i = peek
			start = i
			stack: list[str] = ["}" if ch == "{" else "]"]
			quote_char: str | None = None
			escaped = False
			i += 1

			while i < length and stack:
				cur = cleaned_stdout[i]
				if quote_char is not None:
					if escaped:
						escaped = False
					elif cur == "\\":
						escaped = True
					elif cur == quote_char:
						quote_char = None
					i += 1
					continue

				if cur in ("'", '"', "`"):
					quote_char = cur
				elif cur == "{":
					stack.append("}")
				elif cur == "[":
					stack.append("]")
				elif cur in ("}", "]"):
					expected_close = stack[-1]
					if cur != expected_close:
						raise NormalizerParseError(
							f"Fermeture '{cur}' inattendue, '{expected_close}' attendu a l'index {i}."
						)
					_ = stack.pop()
				i += 1

			if quote_char is not None or stack:
				raise NormalizerParseError("Bloc structurel non ferme avant la fin de stdout.")

			blocks.append(cleaned_stdout[start:i])
			while i < length and cleaned_stdout[i] in (" ", "\t"):
				i += 1
			if i < length and cleaned_stdout[i] == "\n":
				i += 1
			continue

		# Ligne scalaire brute : preserver les espaces/tabulations en debut de ligne
		start = i
		while i < length and cleaned_stdout[i] != "\n":
			i += 1
		blocks.append(cleaned_stdout[start:i])
		if i < length and cleaned_stdout[i] == "\n":
			i += 1

	return blocks


class JsInspectParser:
	"""Parseur recursif descendant pour les objets/tableaux util.inspect (tsx/bun)."""

	def __init__(self, source: str) -> None:
		self._src: str = source
		self._len: int = len(source)
		self._pos: int = 0

	def parse(self) -> CanonicalValue:
		"""Parse un bloc unique et verifie qu'aucun jeton residuel ne subsiste."""
		self._skip_ws()
		value = self._parse_value()
		self._skip_ws()
		if self._pos != self._len:
			raise NormalizerParseError(
				f"Contenu inattendu apres la fin du bloc a l'index {self._pos}."
			)
		return value

	def _skip_ws(self) -> None:
		while self._pos < self._len and self._src[self._pos] in (" ", "\t", "\n", "\r"):
			self._pos += 1

	def _peek(self) -> str | None:
		if self._pos >= self._len:
			return None
		return self._src[self._pos]

	def _parse_value(self) -> CanonicalValue:
		self._skip_ws()
		ch = self._peek()
		if ch is None:
			raise NormalizerParseError("Fin de bloc inattendue lors de la lecture d'une valeur.")
		if ch == "{":
			return self._parse_object()
		if ch == "[":
			return self._parse_array()
		if ch in ("'", '"', "`"):
			return self._parse_string(ch)
		if ch == "-" or ch.isdigit():
			return self._parse_number()
		return self._parse_keyword()

	def _parse_object(self) -> dict[str, CanonicalValue]:
		self._pos += 1
		result: dict[str, CanonicalValue] = {}
		self._skip_ws()
		if self._peek() == "}":
			self._pos += 1
			return result

		while True:
			self._skip_ws()
			if self._peek() == "}":
				self._pos += 1
				return result

			key = self._parse_object_key()
			self._skip_ws()
			if self._peek() != ":":
				raise NormalizerParseError(
					f"':' attendu apres la cle '{key}' a l'index {self._pos}."
				)
			self._pos += 1
			val = self._parse_value()
			result[key] = val

			self._skip_ws()
			nxt = self._peek()
			if nxt == ",":
				self._pos += 1
				continue
			if nxt == "}":
				self._pos += 1
				return result
			raise NormalizerParseError(
				f"',' ou '}}' attendu dans l'objet a l'index {self._pos}."
			)

	def _parse_object_key(self) -> str:
		ch = self._peek()
		if ch is None:
			raise NormalizerParseError("Cle d'objet attendue avant la fin du bloc.")
		if ch in ("'", '"', "`"):
			return self._parse_string(ch)
		if ch.isdigit():
			start = self._pos
			while self._pos < self._len and self._src[self._pos].isdigit():
				self._pos += 1
			return self._src[start:self._pos]
		if ch.isalpha() or ch in ("_", "$"):
			start = self._pos
			self._pos += 1
			while self._pos < self._len:
				cur = self._src[self._pos]
				if cur.isalnum() or cur in ("_", "$"):
					self._pos += 1
				else:
					break
			return self._src[start:self._pos]
		raise NormalizerParseError(
			f"Cle d'objet invalide '{ch}' a l'index {self._pos}."
		)

	def _parse_array(self) -> list[CanonicalValue]:
		self._pos += 1
		items: list[CanonicalValue] = []
		self._skip_ws()
		if self._peek() == "]":
			self._pos += 1
			return items

		while True:
			self._skip_ws()
			if self._peek() == "]":
				self._pos += 1
				return items

			items.append(self._parse_value())
			self._skip_ws()
			nxt = self._peek()
			if nxt == ",":
				self._pos += 1
				continue
			if nxt == "]":
				self._pos += 1
				return items
			raise NormalizerParseError(
				f"',' ou ']' attendu dans le tableau a l'index {self._pos}."
			)

	def _parse_string(self, quote: str) -> str:
		self._pos += 1
		chars: list[str] = []
		simple_escapes: dict[str, str] = {
			"\\": "\\",
			"'": "'",
			'"': '"',
			"`": "`",
			"n": "\n",
			"r": "\r",
			"t": "\t",
			"b": "\b",
			"f": "\f",
			"v": "\v",
		}
		while self._pos < self._len:
			ch = self._src[self._pos]
			self._pos += 1
			if ch == quote:
				return "".join(chars)
			if ch != "\\":
				if 0xD800 <= ord(ch) <= 0xDFFF:
					raise NormalizerParseError("Surrogate UTF-16 isole interdit dans une chaine.")
				chars.append(ch)
				continue

			if self._pos >= self._len:
				raise NormalizerParseError("Sequence d'echappement incomplete en fin de chaine.")
			esc = self._src[self._pos]
			self._pos += 1

			if esc in simple_escapes:
				chars.append(simple_escapes[esc])
			elif esc == "0" and (self._pos >= self._len or not self._src[self._pos].isdigit()):
				chars.append("\0")
			elif esc == "x":
				hex_str = self._read_hex(2)
				chars.append(chr(int(hex_str, 16)))
			elif esc == "u":
				if self._peek() == "{":
					self._pos += 1
					end_brace = self._src.find("}", self._pos)
					if end_brace == -1:
						raise NormalizerParseError("Sequence \\u{...} non fermee.")
					code_hex = self._src[self._pos:end_brace]
					if not code_hex or not all(c in "0123456789abcdefABCDEF" for c in code_hex):
						raise NormalizerParseError(f"Code point unicode invalide: '{code_hex}'.")
					self._pos = end_brace + 1
					codepoint = int(code_hex, 16)
					if codepoint < 0 or codepoint > 0x10FFFF:
						raise NormalizerParseError(
							f"Code point unicode hors bornes: '0x{code_hex}'."
						)
					if 0xD800 <= codepoint <= 0xDFFF:
						raise NormalizerParseError(
							f"Surrogate UTF-16 isole interdit dans \\u{{...}}: '0x{code_hex}'."
						)
					chars.append(chr(codepoint))
				else:
					hex_str = self._read_hex(4)
					cp = int(hex_str, 16)
					if 0xD800 <= cp <= 0xDBFF:
						if (
							self._pos + 2 <= self._len
							and self._src[self._pos:self._pos + 2] == "\\u"
							and (self._pos + 2 >= self._len or self._src[self._pos + 2] != "{")
						):
							self._pos += 2
							lo_hex = self._read_hex(4)
							lo = int(lo_hex, 16)
							if not (0xDC00 <= lo <= 0xDFFF):
								raise NormalizerParseError(
									f"Paire de surrogates UTF-16 invalide: 0x{cp:04X} suivi de 0x{lo:04X}."
								)
							scalar = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00)
							chars.append(chr(scalar))
						else:
							raise NormalizerParseError(
								f"Surrogate UTF-16 haut isole interdit: 0x{cp:04X}."
							)
					elif 0xDC00 <= cp <= 0xDFFF:
						raise NormalizerParseError(
							f"Surrogate UTF-16 bas isole interdit: 0x{cp:04X}."
						)
					else:
						chars.append(chr(cp))
			else:
				chars.append(esc)

		raise NormalizerParseError("Chaine non fermee avant la fin du bloc.")

	def _read_hex(self, count: int) -> str:
		if self._pos + count > self._len:
			raise NormalizerParseError("Sequence hexadecimale tronquee.")
		segment = self._src[self._pos:self._pos + count]
		if not all(c in "0123456789abcdefABCDEF" for c in segment):
			raise NormalizerParseError(f"Sequence hexadecimale invalide: '{segment}'.")
		self._pos += count
		return segment

	def _parse_number(self) -> int | float:
		start = self._pos
		if self._src[self._pos] == "-":
			self._pos += 1
		while self._pos < self._len:
			cur = self._src[self._pos]
			if cur.isdigit() or cur in (".", "e", "E", "+", "-"):
				# Le signe '+' ou '-' apres le premier caractere n'est valide qu'apres e/E
				if cur in ("+", "-") and self._src[self._pos - 1] not in ("e", "E"):
					break
				self._pos += 1
			else:
				break

		raw_num = self._src[start:self._pos]
		if not NUMBER_RE.fullmatch(raw_num):
			raise NormalizerParseError(f"Nombre invalide '{raw_num}' a l'index {start}.")
		if "." in raw_num or "e" in raw_num or "E" in raw_num:
			return float(raw_num)
		return int(raw_num)

	def _parse_keyword(self) -> bool | None | UndefinedSentinel:
		start = self._pos
		while self._pos < self._len and (self._src[self._pos].isalpha() or self._src[self._pos] == "_"):
			self._pos += 1
		word = self._src[start:self._pos]
		if word == "true":
			return True
		if word == "false":
			return False
		if word == "null":
			return None
		if word == "undefined":
			return UNDEFINED
		raise NormalizerParseError(
			f"Jeton inconnu '{word or self._peek()}' a l'index {start}."
		)


def _reject_json_constant(token: str) -> NoReturn:
	"""Rejette les constantes JSON non standard (NaN, Infinity, -Infinity)."""
	raise NormalizerParseError(f"Constante numerique non finie interdite: '{token}'.")


def _coerce_json_value(raw: object) -> CanonicalValue:
	"""Convertit une valeur issue de json.loads en CanonicalValue strictement typee."""
	if raw is None or isinstance(raw, bool):
		return raw
	if isinstance(raw, (int, float)):
		if isinstance(raw, float) and not math.isfinite(raw):
			raise NormalizerParseError(f"Nombre JSON non fini interdit: {raw!r}")
		return raw
	if isinstance(raw, str):
		if any(0xD800 <= ord(ch) <= 0xDFFF for ch in raw):
			raise NormalizerParseError("Surrogate UTF-16 isole interdit dans une chaine JSON.")
		return raw
	if isinstance(raw, list):
		raw_list = cast("list[object]", raw)
		items: list[CanonicalValue] = []
		for entry in raw_list:
			items.append(_coerce_json_value(entry))
		return items
	if isinstance(raw, dict):
		raw_dict = cast("dict[object, object]", raw)
		mapping: dict[str, CanonicalValue] = {}
		for key, val in raw_dict.items():
			if not isinstance(key, str):
				raise NormalizerParseError(f"Cle JSON non-string inattendue: {key!r}")
			if any(0xD800 <= ord(ch) <= 0xDFFF for ch in key):
				raise NormalizerParseError("Surrogate UTF-16 isole interdit dans une cle JSON.")
			mapping[key] = _coerce_json_value(val)
		return mapping
	raise NormalizerParseError(f"Type JSON non supporte: {type(raw).__name__}")


def parse_block(block: str) -> CanonicalValue:
	"""Convertit un bloc stdout brut (JSON, util.inspect ou scalaire) en valeur canonique."""
	stripped = block.strip()
	if stripped.startswith(("{", "[")):
		try:
			parsed_json = cast(
				"object",
				json.loads(stripped, parse_constant=_reject_json_constant),
			)
		except json.JSONDecodeError:
			return JsInspectParser(stripped).parse()
		return _coerce_json_value(parsed_json)

	if block[:1] in (" ", "\t"):
		return block.rstrip("\n")

	if stripped.startswith('"') and stripped.endswith('"') and len(stripped) >= 2:
		try:
			decoded_str = cast(
				"object",
				json.loads(stripped, parse_constant=_reject_json_constant),
			)
		except json.JSONDecodeError:
			decoded_str = None
		if isinstance(decoded_str, str):
			if any(0xD800 <= ord(ch) <= 0xDFFF for ch in decoded_str):
				raise NormalizerParseError("Surrogate UTF-16 isole interdit dans une chaine JSON.")
			return decoded_str

	if stripped in ("NaN", "Infinity", "-Infinity"):
		raise NormalizerParseError(f"Nombre non fini interdit: '{stripped}'.")
	if stripped == "true":
		return True
	if stripped == "false":
		return False
	if stripped == "null":
		return None
	if stripped == "undefined":
		return UNDEFINED
	if NUMBER_RE.fullmatch(stripped):
		if "." in stripped or "e" in stripped or "E" in stripped:
			return float(stripped)
		return int(stripped)

	return block.rstrip("\n")


def normalize_stdout(raw_stdout: str) -> list[CanonicalValue]:
	"""Pipeline complet de normalisation d'une sortie stdout en liste de valeurs canoniques."""
	cleaned = normalize_text(raw_stdout)
	blocks = split_stdout_blocks(cleaned)
	return [parse_block(block) for block in blocks]


def encode_golden_value(value: CanonicalValue) -> object:
	"""Encode une valeur canonique pour serialisation JSON golden."""
	if value is UNDEFINED:
		return {UNDEFINED_JSON_SENTINEL_KEY: True}
	if isinstance(value, float) and not math.isfinite(value):
		raise NormalizerParseError(f"Nombre non fini interdit dans un golden JSON: {value!r}")
	if isinstance(value, list):
		return [encode_golden_value(item) for item in value]
	if isinstance(value, dict):
		return {key: encode_golden_value(val) for key, val in value.items()}
	return value


def decode_golden_value(raw: object) -> CanonicalValue:
	"""Restaure une valeur canonique depuis un objet JSON golden."""
	if raw is None or isinstance(raw, bool):
		return raw
	if isinstance(raw, (int, float)):
		if isinstance(raw, float) and not math.isfinite(raw):
			raise NormalizerParseError(f"Nombre golden non fini interdit: {raw!r}")
		return raw
	if isinstance(raw, str):
		return raw
	if isinstance(raw, list):
		raw_list = cast("list[object]", raw)
		return [decode_golden_value(item) for item in raw_list]
	if isinstance(raw, dict):
		raw_dict = cast("dict[object, object]", raw)
		if (
			len(raw_dict) == 1
			and UNDEFINED_JSON_SENTINEL_KEY in raw_dict
			and raw_dict[UNDEFINED_JSON_SENTINEL_KEY] is True
		):
			return UNDEFINED
		decoded: dict[str, CanonicalValue] = {}
		for key, val in raw_dict.items():
			if not isinstance(key, str):
				raise NormalizerParseError(f"Cle golden invalide: {key!r}")
			decoded[key] = decode_golden_value(val)
		return decoded
	raise NormalizerParseError(f"Type golden invalide: {type(raw).__name__}")


def _try_tuple_dict_to_list(obj: dict[str, CanonicalValue]) -> list[CanonicalValue] | None:
	"""Convertit un struct Go TupleN {"V0":..., "V1":...} en liste si les cles sont exactement V0..VN-1."""
	count = len(obj)
	if count == 0:
		return None
	expected_keys = {f"V{idx}" for idx in range(count)}
	if set(obj.keys()) != expected_keys:
		return None
	return [obj[f"V{idx}"] for idx in range(count)]


def _encode_for_format(value: CanonicalValue) -> object:
	if value is UNDEFINED:
		return {UNDEFINED_JSON_SENTINEL_KEY: True}
	if isinstance(value, list):
		return [_encode_for_format(item) for item in value]
	if isinstance(value, dict):
		return {key: _encode_for_format(val) for key, val in value.items()}
	return value


def _format_value(value: CanonicalValue) -> str:
	if value is UNDEFINED:
		return "undefined"
	if value is None:
		return "null"
	if isinstance(value, bool):
		return "true" if value else "false"
	if isinstance(value, (int, float)):
		return repr(value)
	if isinstance(value, str):
		return json.dumps(value, ensure_ascii=False)
	if isinstance(value, list):
		return json.dumps(_encode_for_format(value), ensure_ascii=False)
	return json.dumps(_encode_for_format(value), ensure_ascii=False, sort_keys=True)


def compare_values(
	expected: CanonicalValue,
	actual: CanonicalValue,
	path: str = "$",
) -> list[DiffItem]:
	"""Compare recursivement deux valeurs canoniques selon les 8 regles E2E."""
	# Regle 4 (hors cle EITHER_VALUE_KEY): undefined ne correspond qu'a undefined
	if expected is UNDEFINED:
		if actual is UNDEFINED:
			return []
		return [
			DiffItem(
				path=path,
				reason="expected undefined",
				expected="undefined",
				actual=_format_value(actual),
			)
		]

	if actual is UNDEFINED:
		return [
			DiffItem(
				path=path,
				reason="unexpected undefined",
				expected=_format_value(expected),
				actual="undefined",
			)
		]

	# Regle 5: tester bool IMPERATIVEMENT avant (int, float)
	if isinstance(expected, bool):
		if isinstance(actual, bool) and expected is actual:
			return []
		return [
			DiffItem(
				path=path,
				reason="boolean mismatch",
				expected=_format_value(expected),
				actual=_format_value(actual),
			)
		]

	if isinstance(actual, bool):
		return [
			DiffItem(
				path=path,
				reason="type mismatch (unexpected boolean)",
				expected=_format_value(expected),
				actual=_format_value(actual),
			)
		]

	if isinstance(expected, (int, float)):
		if not isinstance(actual, (int, float)):
			return [
				DiffItem(
					path=path,
					reason="type mismatch (expected number)",
					expected=_format_value(expected),
					actual=_format_value(actual),
				)
			]
		exp_num = 0.0 if float(expected) == 0.0 else float(expected)
		act_num = 0.0 if float(actual) == 0.0 else float(actual)
		if not (math.isfinite(exp_num) and math.isfinite(act_num)):
			return [
				DiffItem(
					path=path,
					reason="non-finite number",
					expected=_format_value(expected),
					actual=_format_value(actual),
				)
			]
		if abs(exp_num - act_num) <= FLOAT_ABS_TOLERANCE:
			return []
		return [
			DiffItem(
				path=path,
				reason="number mismatch",
				expected=_format_value(expected),
				actual=_format_value(actual),
			)
		]

	# Regle 6: None strict (rejette notamment [] vs null)
	if expected is None:
		if actual is None:
			return []
		return [
			DiffItem(
				path=path,
				reason="expected null",
				expected="null",
				actual=_format_value(actual),
			)
		]

	if isinstance(expected, str):
		if isinstance(actual, str) and expected == actual:
			return []
		return [
			DiffItem(
				path=path,
				reason="string mismatch",
				expected=_format_value(expected),
				actual=_format_value(actual),
			)
		]

	# Regle 7: equivalence TupleN entre liste et dict V0..VN-1
	if isinstance(expected, list) and isinstance(actual, dict):
		tuple_list = _try_tuple_dict_to_list(actual)
		if tuple_list is not None:
			return compare_values(expected, tuple_list, path)
		return [
			DiffItem(
				path=path,
				reason="type mismatch (expected array)",
				expected=_format_value(expected),
				actual=_format_value(actual),
			)
		]

	if isinstance(expected, dict) and isinstance(actual, list):
		tuple_list = _try_tuple_dict_to_list(expected)
		if tuple_list is not None:
			return compare_values(tuple_list, actual, path)
		return [
			DiffItem(
				path=path,
				reason="type mismatch (expected object)",
				expected=_format_value(expected),
				actual=_format_value(actual),
			)
		]

	if isinstance(expected, list):
		if actual is None:
			reason = (
				"empty array [] cannot match null (nil slice)"
				if len(expected) == 0
				else "array cannot match null"
			)
			return [
				DiffItem(
					path=path,
					reason=reason,
					expected=_format_value(expected),
					actual="null",
				)
			]
		if not isinstance(actual, list):
			return [
				DiffItem(
					path=path,
					reason="type mismatch (expected array)",
					expected=_format_value(expected),
					actual=_format_value(actual),
				)
			]
		diffs: list[DiffItem] = []
		if len(expected) != len(actual):
			diffs.append(
				DiffItem(
					path=path,
					reason="array length mismatch",
					expected=str(len(expected)),
					actual=str(len(actual)),
				)
			)
		for idx in range(min(len(expected), len(actual))):
			diffs.extend(compare_values(expected[idx], actual[idx], f"{path}[{idx}]"))
		return diffs

	# expected est necessairement dict[str, CanonicalValue]
	if not isinstance(actual, dict):
		return [
			DiffItem(
				path=path,
				reason="type mismatch (expected object)",
				expected=_format_value(expected),
				actual=_format_value(actual),
			)
		]

	diffs_dict: list[DiffItem] = []
	expected_keys = set(expected.keys())
	actual_keys = set(actual.keys())

	for key in sorted(expected_keys - actual_keys):
		# Regle 4: omission toleree uniquement pour EITHER_VALUE_KEY == UNDEFINED (omitzero)
		if key == EITHER_VALUE_KEY and expected[key] is UNDEFINED:
			continue
		diffs_dict.append(
			DiffItem(
				path=f"{path}.{key}",
				reason="missing key",
				expected=_format_value(expected[key]),
				actual="<missing>",
			)
		)

	for key in sorted(actual_keys - expected_keys):
		diffs_dict.append(
			DiffItem(
				path=f"{path}.{key}",
				reason="unexpected key",
				expected="<missing>",
				actual=_format_value(actual[key]),
			)
		)

	for key in sorted(expected_keys & actual_keys):
		exp_val = expected[key]
		act_val = actual[key]
		if key == EITHER_VALUE_KEY and exp_val is UNDEFINED:
			if act_val is None or act_val is UNDEFINED:
				continue
			diffs_dict.append(
				DiffItem(
					path=f"{path}.{key}",
					reason="expected undefined or null for Either value",
					expected="undefined | null",
					actual=_format_value(act_val),
				)
			)
			continue
		diffs_dict.extend(compare_values(exp_val, act_val, f"{path}.{key}"))

	return diffs_dict


def compare_blocks(
	expected_blocks: Sequence[CanonicalValue],
	actual_blocks: Sequence[CanonicalValue],
) -> ComparisonResult:
	"""Compare deux suites ordonnees de blocs canoniques."""
	diffs: list[DiffItem] = []
	if len(expected_blocks) != len(actual_blocks):
		diffs.append(
			DiffItem(
				path="$",
				reason="block count mismatch",
				expected=str(len(expected_blocks)),
				actual=str(len(actual_blocks)),
			)
		)
	for idx in range(min(len(expected_blocks), len(actual_blocks))):
		diffs.extend(compare_values(expected_blocks[idx], actual_blocks[idx], f"$[{idx}]"))
	return ComparisonResult(equal=len(diffs) == 0, diffs=tuple(diffs))


def verify_reject_output(exit_code: int, stderr: str) -> ComparisonResult:
	"""Verifie qu'un cas reject a bien echoue cote transpileur avec NotRightError."""
	diffs: list[DiffItem] = []
	if exit_code == 0:
		diffs.append(
			DiffItem(
				path="$.exitCode",
				reason="reject case must exit with non-zero status",
				expected="!= 0",
				actual="0",
			)
		)
	has_not_right = "NotRightError" in stderr or "either-not-right-error" in stderr
	if not has_not_right:
		diffs.append(
			DiffItem(
				path="$.stderr",
				reason="missing NotRightError / either-not-right-error in stderr",
				expected="NotRightError | either-not-right-error",
				actual=stderr.strip()[:200] or "<empty>",
			)
		)
	has_transpile_err = "transformation-error" in stderr or "notfound-transformer" in stderr
	if not has_transpile_err:
		diffs.append(
			DiffItem(
				path="$.stderr",
				reason="missing transformation-error / notfound-transformer in stderr",
				expected="transformation-error | notfound-transformer",
				actual=stderr.strip()[:200] or "<empty>",
			)
		)
	return ComparisonResult(equal=len(diffs) == 0, diffs=tuple(diffs))
