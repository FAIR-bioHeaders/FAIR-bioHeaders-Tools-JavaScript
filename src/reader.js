/**
 * Reading, checking and stripping FAIR-bioHeaders files.
 *
 * This module orchestrates the rules: it takes the exact bytes of a FASTA, GFA
 * or GFF3 file, finds the leading header block, recomputes the SHA-512/256
 * checksum over the bytes R3 says are covered, reads the header YAML, selects
 * the contract the record cites and validates against it. The rules themselves
 * live in `lines.js`, `checksum.js`, `yaml.js`, `selection.js` and `validate.js`.
 *
 * What this library is **not**: it is not the browser tooling on the FAIR
 * bioHeaders website, and it is not `gff3-validator`'s Pyodide build. Every
 * check here runs as native JavaScript on Node's own `crypto`, `zlib` and `ajv`;
 * no CPython runs under the hood, and no result from this library may be
 * described as the website's validation (fair-bioheaders.github.io#23). It also
 * performs no GFF3 feature or biology validation: that belongs to
 * `gff3-validator`.
 *
 * @module reader
 */

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { HeaderError } from './errors.js';
import { computeChecksum, findChecksumLine } from './checksum.js';
import { assertNoByteOrderMark, headerLines, isGff3VersionLine, splitLines } from './lines.js';
import { selectSchema } from './selection.js';
import { validateRecord } from './validate.js';
import { loadHeaderYaml } from './yaml.js';

const GZIP_MAGIC = [0x1f, 0x8b];

/** Which header types occur in which container (docs/FORMAT.md, "Each header type has its containers"). */
const CONTAINER_TYPES = {
  fasta: new Set(['FHR', 'FHP']),
  gfa: new Set(['FHR']),
  gff3: new Set(['FHGFF3']),
};

/**
 * @typedef {'fasta'|'gfa'|'gff3'} Container
 */

/**
 * @typedef {object} Reading
 * @property {boolean} valid true when the header, its checksum and the cited contract all hold
 * @property {Container} container
 * @property {Record<string, unknown>} metadata the header as a plain object; `{}` when unreadable
 * @property {{stated: string, computed: string, matches: boolean}} checksum base64 SHA-512/256 values
 * @property {{type: string, release: string, schemaVersion: string|number, rule: string}} schema what the record cites and what was used
 * @property {string[]} warnings things a conforming validator reports without rejecting the file
 * @property {string[]} errors why the file was rejected, when it was
 */

/**
 * Infer the container from a file name. Gzip or BGZF transport is removed from
 * the name first, so `.gff3.gz` is a GFF3 file.
 *
 * @param {string} path
 * @returns {Container}
 */
export function containerOf(path) {
  const name = path.toLowerCase().replace(/(\.bgz|\.gz)$/, '');
  if (name.endsWith('.gff3')) return 'gff3';
  if (name.endsWith('.gfa')) return 'gfa';
  if (/\.(fasta|fa|fna|fas)$/.test(name)) return 'fasta';
  throw new HeaderError(`cannot tell the container of ${path}: pass {container: 'fasta'|'gfa'|'gff3'}`);
}

/**
 * The bytes the checksum covers are the decompressed bytes: compression is
 * transport, so the same content has the same checksum whatever compressed it
 * (R1).
 *
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
export function decompress(data) {
  const compressed = data.length >= 2 && data[0] === GZIP_MAGIC[0] && data[1] === GZIP_MAGIC[1];
  if (!compressed) return data;
  try {
    return new Uint8Array(gunzipSync(data));
  } catch (error) {
    throw new HeaderError(`invalid gzip or BGZF input: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`, { rule: 'R1' });
  }
}

/**
 * G1: GFF3 line 1 is `##gff-version 3`, optionally `3.MINOR.PATCH`, before any
 * header line may appear.
 *
 * @param {Uint8Array} bytes decompressed file bytes
 */
function assertGff3VersionLine(bytes) {
  const lines = splitLines(bytes);
  if (lines.length === 0) {
    throw new HeaderError('an empty GFF3 file has no ##gff-version line (FHGFF3.md G1)', { rule: 'G1', field: 'line 1' });
  }
  const first = decode(bytes.subarray(lines[0].start, lines[0].end)).replace(/[\r\n]+$/, '');
  if (!isGff3VersionLine(first)) {
    throw new HeaderError(`GFF3 line 1 must be "##gff-version 3" with an optional .MINOR.PATCH (FHGFF3.md G1), found ${JSON.stringify(first)}`, {
      rule: 'G1',
      field: 'line 1',
    });
  }
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function decode(bytes) {
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * R11: in FASTA, a header line should not hold a raw `>` or `@`, because kseq
 * readers start a record at either character. Such a file stays valid and the
 * validator warns. GFA and GFF3 headers are not affected.
 *
 * @param {string} text the header block's text, prefixes removed
 * @param {Container} container
 * @returns {string[]}
 */
function recordMarkerWarnings(text, container) {
  if (container !== 'fasta') return [];
  const warnings = [];
  for (const line of text.split('\n')) {
    const body = line.replace(/^[ \t]*/, '');
    if (body === '' || body.startsWith('#')) continue;
    if (body.includes('>') || body.includes('@')) {
      const key = /^[^:]*/.exec(body)[0].trim();
      warnings.push(`R11 warning: ${key || 'a header line'} holds a raw '>' or '@'; writers escape it as \\x3E or \\x40 in a double-quoted scalar (docs/FORMAT.md R11)`);
    }
  }
  return warnings;
}

/**
 * Read and check the bytes of a FAIR-bioHeaders file.
 *
 * Nothing throws for a non-conforming file: findings come back in `errors`, and
 * an unavailable contract is reported as `unsupported-version` in the message
 * text and never checked against another schema (V4).
 *
 * @param {Uint8Array} data the file's exact bytes, plain or gzip/BGZF
 * @param {object} [options]
 * @param {Container} [options.container] the container; required without `name`
 * @param {string} [options.name] a file name used only to infer the container
 * @returns {Reading}
 */
export function inspectBytes(data, options = {}) {
  const container = options.container ?? (options.name !== undefined ? containerOf(options.name) : undefined);
  if (container === undefined) {
    throw new HeaderError("inspectBytes needs {container: 'fasta'|'gfa'|'gff3'} or a {name} to infer it from");
  }
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  try {
    const bytes = decompress(data);
    assertNoByteOrderMark(bytes); // R7
    if (container === 'gff3') assertGff3VersionLine(bytes);
    const { stated, computed, covered, lines } = computeChecksum(bytes, container);
    const text = lines.map(({ text: line }) => line).join('\n');
    const read = loadHeaderYaml(text);
    const metadata = read.metadata;
    warnings.push(...read.warnings);
    if (typeof metadata.checksum !== 'string' || metadata.checksum !== stated) {
      errors.push('the checksum header line must hold the complete checksum value as a single-line scalar that matches the parsed metadata (R5)');
    }
    if (stated !== computed) {
      errors.push(`checksum mismatch: the line states ${stated}, SHA-512/256 of the ${covered.length} covered bytes is ${computed} (R3, R4)`);
    }
    warnings.push(...recordMarkerWarnings(text, container));
    const selection = selectSchema(metadata);
    if (!CONTAINER_TYPES[container].has(selection.type)) {
      errors.push(`a ${selection.type} header does not belong in a ${container} file, whatever its checksum says (docs/FORMAT.md)`);
    }
    const result = validateRecord(metadata, selection);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    return {
      valid: errors.length === 0,
      container,
      metadata,
      checksum: { stated, computed, matches: stated === computed },
      schema: { type: selection.type, release: selection.release, schemaVersion: result.schema.schemaVersion, rule: selection.rule },
      warnings,
      errors,
    };
  } catch (error) {
    if (!(error instanceof HeaderError)) throw error;
    const prefix = error.rule === null ? '' : `${error.rule}: `;
    if (error.result === 'unsupported-version') {
      return {
        valid: false,
        container,
        metadata: {},
        checksum: { stated: '', computed: '', matches: false },
        schema: { type: 'FHR', release: '', schemaVersion: '', rule: 'V4' },
        warnings,
        errors: [error.message],
      };
    }
    return {
      valid: false,
      container,
      metadata: {},
      checksum: { stated: '', computed: '', matches: false },
      schema: { type: 'FHR', release: '', schemaVersion: '', rule: '' },
      warnings,
      errors: [`${prefix}${error.message}`],
    };
  }
}

/**
 * Read and check a file by path.
 *
 * @param {string} path
 * @param {object} [options]
 * @param {Container} [options.container] overrides the name-based guess
 * @returns {Reading}
 */
export function inspectFile(path, options = {}) {
  const data = new Uint8Array(readFileSync(path));
  return inspectBytes(data, { container: options.container, name: path });
}

/**
 * @param {Uint8Array} bytes
 * @param {{start: number, end: number}[]} ranges
 * @returns {Uint8Array} the bytes outside those ranges, in order
 */
function removeRanges(bytes, ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const parts = [];
  let at = 0;
  for (const range of sorted) {
    if (range.start > at) parts.push(bytes.subarray(at, range.start));
    at = Math.max(at, range.end);
  }
  if (at < bytes.length) parts.push(bytes.subarray(at, bytes.length));
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Remove the header block from a FAIR-bioHeaders file, byte-exactly.
 *
 * Every `;~`/`#~` line of the leading header block goes, with its terminator;
 * ordinary comments, blank lines and all data bytes stay exactly as they were.
 * This is what a strict FASTA reader (htslib, Picard, Biopython's default
 * `fasta` format) needs before it will open the file.
 *
 * Stripping needs no contract: it is a byte operation on the header block, so
 * it works on a file whose metadata cites a schema this build does not have —
 * the checksum is not re-verified here, and nothing is re-compressed.
 *
 * @param {Uint8Array} data the file's exact bytes, plain or gzip/BGZF
 * @param {object} options
 * @param {Container} [options.container]
 * @param {string} [options.name]
 * @returns {Uint8Array}
 */
export function stripBytes(data, options = {}) {
  const container = options.container ?? (options.name !== undefined ? containerOf(options.name) : undefined);
  if (container === undefined) {
    throw new HeaderError("stripBytes needs {container: 'fasta'|'gfa'|'gff3'} or a {name} to infer it from");
  }
  const bytes = decompress(data);
  assertNoByteOrderMark(bytes); // R7: a stripped copy is still a sequence file
  findChecksumLine(bytes, container); // the same R2/R5 checks: refuse to strip a malformed header
  const ranges = headerLines(bytes, container).map(({ start, end }) => ({ start, end }));
  return removeRanges(bytes, ranges);
}

/**
 * Strip a file by path.
 *
 * @param {string} path
 * @param {object} [options]
 * @param {Container} [options.container]
 * @returns {Uint8Array}
 */
export function stripFile(path, options = {}) {
  return stripBytes(new Uint8Array(readFileSync(path)), { container: options.container, name: path });
}
