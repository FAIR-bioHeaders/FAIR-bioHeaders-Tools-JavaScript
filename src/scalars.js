/**
 * Plain-scalar type resolution for the two YAML dialects rule R12 compares.
 *
 * `docs/FORMAT.md` R12 requires metadata to be read with YAML 1.2 core-schema
 * types and to read the *same way* under YAML 1.1. Checking that needs both
 * resolutions, and one library's tag table is not the rule: `js-yaml`'s YAML 1.1
 * tags differ from PyYAML's resolver in several corners (`._0`, `+.5`, `=`, `<<`,
 * leading-zero integers), and the Python toolkit is the family's reference
 * implementation. Both tables are therefore written out here from the dialects
 * themselves, and verified against the toolkit scalar by scalar by
 * `scripts/capability/yaml-portability-differential.mjs`.
 *
 * Where the patterns come from:
 * - YAML 1.2 core schema: the `null`, `bool`, `int` and `float` regular
 *   expressions of the YAML 1.2 specification, Core Schema chapter.
 * - YAML 1.1: the patterns PyYAML registers for
 *   `tag:yaml.org,2002:{null,bool,int,float,timestamp,value,merge}`, which is
 *   what the toolkit resolves through, plus the `y`/`Y`/`n`/`N` booleans of the
 *   YAML 1.1 boolean channel that the toolkit adds explicitly.
 *
 * A YAML 1.1 timestamp resolves to `str` here, because R12 keeps date-looking
 * plain scalars as strings exactly as written; the toolkit does the same. The
 * 1.1-only `value` (`=`) and `merge` (`<<`) tags have no YAML 1.2 counterpart, so
 * they stay distinct tags and make the scalar non-portable.
 *
 * Integers are resolved as `BigInt`, so the comparison does not inherit the
 * IEEE-754 rounding of the value the reader hands back.
 *
 * @module scalars
 */

/** Tag names, abbreviated: the `tag:yaml.org,2002:` suffix is dropped. */
export const TAGS = Object.freeze({
  null: 'null',
  bool: 'bool',
  int: 'int',
  float: 'float',
  str: 'str',
  value: 'value',
  merge: 'merge',
});

/** YAML 1.2 core schema. */
const CORE = Object.freeze({
  null: /^(?:~|null|Null|NULL|)$/,
  bool: /^(?:true|True|TRUE|false|False|FALSE)$/,
  dec: /^[-+]?[0-9]+$/,
  oct: /^0o[0-7]+$/,
  hex: /^0x[0-9a-fA-F]+$/,
  float: /^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/,
  inf: /^[-+]?\.(?:inf|Inf|INF)$/,
  nan: /^\.(?:nan|NaN|NAN)$/,
});

/** YAML 1.1, as PyYAML's resolver and the toolkit's reading of it resolve plain scalars. */
const YAML11 = Object.freeze({
  null: /^(?:~|null|Null|NULL|)$/,
  bool: /^(?:yes|Yes|YES|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF|y|Y|n|N)$/,
  binary: /^[-+]?0b[0-1_]+$/,
  octal: /^[-+]?0[0-7_]+$/,
  decimal: /^[-+]?(?:0|[1-9][0-9_]*)$/,
  hexadecimal: /^[-+]?0x[0-9a-fA-F_]+$/,
  sexagesimalInt: /^[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+$/,
  float: /^[-+]?(?:[0-9][0-9_]*)\.[0-9_]*(?:[eE][-+][0-9]+)?$/,
  leadingDotFloat: /^\.[0-9][0-9_]*(?:[eE][-+][0-9]+)?$/,
  sexagesimalFloat: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
  inf: /^[-+]?\.(?:inf|Inf|INF)$/,
  nan: /^\.(?:nan|NaN|NAN)$/,
  timestamp:
    /^(?:[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]|[0-9][0-9][0-9][0-9]-[0-9][0-9]?-[0-9][0-9]?(?:[Tt]|[ \t]+)[0-9][0-9]?:[0-9][0-9]:[0-9][0-9](?:\.[0-9]*)?(?:[ \t]*(?:Z|[-+][0-9][0-9]?(?::[0-9][0-9])?))?)$/,
  value: /^=$/,
  merge: /^<<$/,
});

/**
 * @typedef {{tag: string, value: unknown}} Resolution
 */

/**
 * @param {string} text digits, possibly signed, possibly `_` grouped
 * @param {'core'|'1.1'} dialect whose integer notation the text is read in
 * @returns {bigint}
 */
function toBigInt(text, dialect) {
  const clean = text.replace(/_/g, '');
  const sign = clean.startsWith('-') ? -1n : 1n;
  const unsigned = clean.replace(/^[-+]/, '');
  if (/^0x[0-9a-fA-F]+$/.test(unsigned)) return sign * BigInt(unsigned);
  if (/^0o[0-7]+$/.test(unsigned)) return sign * BigInt(unsigned);
  if (/^0b[01]+$/.test(unsigned)) return sign * BigInt(unsigned);
  if (!/^[0-9]+$/.test(unsigned)) throw new TypeError(`not an integer literal: ${text}`);
  // Only YAML 1.1 reads a bare leading zero as octal; YAML 1.2 core reads the
  // same text as a decimal integer with a redundant zero. That difference is
  // the example R12 gives, so the notation is resolved per dialect here.
  if (dialect === '1.1' && /^0[0-7]*$/.test(unsigned) && unsigned.length > 1) return sign * BigInt(`0o${unsigned.slice(1)}`);
  return sign * BigInt(unsigned.replace(/^0+(?=.)/, ''));
}

/**
 * YAML 1.1 sexagesimal: `1:30` is 90, `1:00:30` is 3630.
 *
 * @param {string} text
 * @returns {bigint}
 */
function fromSexagesimalInt(text) {
  const clean = text.replace(/_/g, '');
  const sign = clean.startsWith('-') ? -1n : 1n;
  const parts = clean.replace(/^[-+]/, '').split(':');
  let total = 0n;
  for (const part of parts) total = total * 60n + BigInt(part);
  return sign * total;
}

/**
 * @param {string} text
 * @returns {number}
 */
function fromSexagesimalFloat(text) {
  const clean = text.replace(/_/g, '');
  const sign = clean.startsWith('-') ? -1 : 1;
  const parts = clean.replace(/^[-+]/, '').split(':');
  let total = 0;
  for (const part of parts) total = total * 60 + Number(part);
  return sign * total;
}

/**
 * A tag the regexes matched but the digit conversion cannot read — `0b_` is
 * YAML 1.1's `0b[0-1_]+` with no digit in it — keeps its tag and gets a value
 * nothing else equals. The dialect still reads the scalar as an integer, which
 * is what R12 compares; refusing it is also what the toolkit ends up doing,
 * because its constructor fails on the same text.
 *
 * @param {string} text
 * @param {'core'|'1.1'} dialect
 * @returns {bigint|number}
 */
function intOrUnresolved(text, dialect) {
  try {
    return toBigInt(text, dialect);
  } catch {
    return Number.NaN;
  }
}

/**
 * @param {string} text
 * @returns {bigint|number}
 */
function sexagesimalOrUnresolved(text) {
  try {
    return fromSexagesimalInt(text);
  } catch {
    return Number.NaN;
  }
}

/**
 * Resolve a plain scalar the way a YAML 1.2 core-schema reader does.
 *
 * @param {string} text
 * @returns {Resolution}
 */
export function resolveCore(text) {
  if (CORE.null.test(text)) return { tag: TAGS.null, value: null };
  if (CORE.bool.test(text)) return { tag: TAGS.bool, value: /^(?:true|True|TRUE)$/.test(text) };
  if (CORE.dec.test(text) || CORE.oct.test(text) || CORE.hex.test(text)) return { tag: TAGS.int, value: intOrUnresolved(text, 'core') }
  if (CORE.float.test(text)) return { tag: TAGS.float, value: Number(text.replace(/_/g, '')) };
  if (CORE.inf.test(text)) return { tag: TAGS.float, value: text.startsWith('-') ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY };
  if (CORE.nan.test(text)) return { tag: TAGS.float, value: Number.NaN };
  return { tag: TAGS.str, value: text };
}

/**
 * Resolve a plain scalar the way a YAML 1.1 reader does.
 *
 * @param {string} text
 * @returns {Resolution}
 */
export function resolveYaml11(text) {
  if (YAML11.null.test(text)) return { tag: TAGS.null, value: null };
  if (YAML11.bool.test(text)) return { tag: TAGS.bool, value: /^(?:yes|Yes|YES|true|True|TRUE|on|On|ON|y|Y)$/.test(text) };
  if (YAML11.binary.test(text) || YAML11.octal.test(text) || YAML11.decimal.test(text) || YAML11.hexadecimal.test(text)) {
    return { tag: TAGS.int, value: intOrUnresolved(text, '1.1') };
  }
  if (YAML11.sexagesimalInt.test(text)) return { tag: TAGS.int, value: sexagesimalOrUnresolved(text) };
  if (YAML11.float.test(text) || YAML11.leadingDotFloat.test(text)) return { tag: TAGS.float, value: Number(text.replace(/_/g, '')) };
  if (YAML11.sexagesimalFloat.test(text)) {
    try {
      return { tag: TAGS.float, value: fromSexagesimalFloat(text) };
    } catch {
      return { tag: TAGS.str, value: text };
    }
  }
  if (YAML11.inf.test(text)) return { tag: TAGS.float, value: text.startsWith('-') ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY };
  if (YAML11.nan.test(text)) return { tag: TAGS.float, value: Number.NaN };
  // R12 keeps date-like scalars strings, so a 1.1 timestamp reads as `str`.
  if (YAML11.timestamp.test(text)) return { tag: TAGS.str, value: text };
  // 1.1-only tags with no YAML 1.2 counterpart: a genuine disagreement.
  if (YAML11.value.test(text)) return { tag: TAGS.value, value: text };
  if (YAML11.merge.test(text)) return { tag: TAGS.merge, value: text };
  return { tag: TAGS.str, value: text };
}

/**
 * R12: does a plain (unquoted) scalar read the same under YAML 1.1 and YAML 1.2?
 *
 * The tag must agree and the value must agree. `010` is the integer 10 to
 * YAML 1.2 and octal 8 to YAML 1.1 — same tag, different value — and `01`,
 * which happens to be 1 in both, is still the kind of notation R12 tells writers
 * to quote, so every leading-zero decimal integer is refused, as the toolkit
 * refuses it.
 *
 * @param {string} text the scalar's text
 * @returns {boolean}
 */
export function plainScalarIsPortable(text) {
  const core = resolveCore(text);
  const eleven = resolveYaml11(text);
  if (core.tag !== eleven.tag) return false;
  if (core.tag === TAGS.int) {
    const unsigned = text.replace(/^[-+]/, '').replace(/_/g, '');
    const prefixed = /^(0[bBoOxX])/.test(unsigned);
    if (!prefixed && unsigned.length > 1 && unsigned.startsWith('0')) return false;
    if (typeof core.value !== 'bigint' || typeof eleven.value !== 'bigint') return false;
    return core.value === eleven.value;
  }
  if (core.tag === TAGS.float) return sameFloat(core.value, eleven.value);
  return true;
}

/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function sameFloat(a, b) {
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return true;
  return a === b;
}

/** A plain scalar written in a numeric notation at all. */
const NUMERIC_LITERAL = /^[-+]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][-+]?[0-9]+)?$/;

/**
 * R13: a value that overflows to infinity is invalid, so a scalar that YAML 1.2
 * core reads as a number too large to represent must not survive as a string
 * either.
 *
 * @param {string} text the scalar's text
 * @returns {boolean}
 */
export function plainScalarOverflows(text) {
  return NUMERIC_LITERAL.test(text) && !Number.isFinite(Number(text));
}
