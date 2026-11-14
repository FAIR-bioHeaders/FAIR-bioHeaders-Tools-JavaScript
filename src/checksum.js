/**
 * The FHR-family checksum: which bytes are covered and how they are hashed.
 *
 * Rules implemented here: `docs/FORMAT.md` R2 (exactly one root-level
 * `checksum` line), R3 (that line and its terminator are the only excluded
 * bytes), R4 (SHA-512/256 as canonical padded base64, compared as a string)
 * and R5 (the grammar of the checksum line itself).
 *
 * The algorithm is written from the rule text and cross-checked against the
 * shared vectors in `conformance/` (see `docs/CONFORMANCE.md`).
 *
 * @module checksum
 */

import { createHash } from 'node:crypto';

import { HeaderError } from './errors.js';
import { PREFIXES, headerLines, splitLines } from './lines.js';

/**
 * R4/R5: the checksum value is 44 characters of canonical padded base64 of a
 * 32-byte digest. 32 bytes leave two unused bits that must be zero, so the
 * character before the `=` is one of `AEIMQUYcgkosw048`; any other value is
 * invalid even when it decodes to the same bytes.
 */
const CANONICAL_B64 = "[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=";

/** R5 grammar of the text after the prefix, anchored to the whole line. */
const CHECKSUM_LINE = new RegExp(
  `^( *)(checksum)( *)(:)( +)(?:${CANONICAL_B64}|'${CANONICAL_B64}'|"${CANONICAL_B64}")( *)$`,
);

/** R2: which line is a candidate root-level checksum line, before R5 applies. */
const CHECKSUM_CANDIDATE = /^([ \t]*)checksum[ \t]*:(.*)$/s;

/** YAML comment, document start/end or directive line: not header metadata. */
const NOT_METADATA = /^[ \t]*(?:#|%|---(?:[ \t]|$)|\.\.\.(?:[ \t]|$))/;

/**
 * Whether this Node build can compute SHA-512/256 at all. OpenSSL provides it;
 * a build without it must say so rather than verify nothing.
 *
 * @returns {boolean}
 */
export function sha512_256Available() {
  try {
    createHash('sha512-256');
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {Uint8Array} data
 * @returns {string} base64 of SHA-512/256 of exactly these bytes (R4)
 */
export function digest(data) {
  if (!sha512_256Available()) {
    throw new HeaderError('this Node.js build has no SHA-512/256; the checksum cannot be computed or verified');
  }
  return createHash('sha512-256').update(data).digest('base64');
}

/**
 * @param {string} text a header line's text after its prefix
 * @returns {number} count of leading space and tab characters
 */
function indentOf(text) {
  const match = /^[ \t]*/.exec(text);
  return match ? match[0].length : 0;
}

/**
 * Locate the single root-level checksum line of a sequence file.
 *
 * R2: the key `checksum` must be unquoted and sit at the root indentation of
 * the other header lines. Nested `checksum` properties stay ordinary metadata
 * and stay covered. R5: the line holds the value and nothing else.
 *
 * @param {Uint8Array} data exact, decompressed file bytes
 * @param {'fasta'|'gfa'|'gff3'} container
 * @returns {{lines: ReturnType<typeof headerLines>, root: number, candidate: {start: number, end: number, text: string, line: number}, value: string}}
 */
export function findChecksumLine(data, container) {
  const lines = headerLines(data, container);
  const content = lines.filter(({ text }) => text.trim() !== '' && !NOT_METADATA.test(text));
  if (content.length === 0) {
    throw new HeaderError(`no ${PREFIXES[container]} header metadata in the file (FORMAT.md R2)`, { rule: 'R2' });
  }
  const root = Math.min(...content.map(({ text }) => indentOf(text)));
  const candidates = [];
  for (const line of lines) {
    const found = CHECKSUM_CANDIDATE.exec(line.text);
    if (found && found[1].length === root) candidates.push(line);
  }
  if (candidates.length !== 1) {
    throw new HeaderError(
      `expected exactly one root-level ${PREFIXES[container]}checksum: line, found ${candidates.length} (FORMAT.md R2)`,
      { rule: 'R2' },
    );
  }
  const candidate = candidates[0];
  if (!CHECKSUM_LINE.test(candidate.text)) {
    throw new HeaderError(
      `the checksum line at line ${candidate.line} must hold only the checksum value: 44 canonical base64 characters, optionally quoted, with no comment, tag, tab or other text (FORMAT.md R4 and R5)`,
      { rule: 'R5', field: `line ${candidate.line}` },
    );
  }
  const afterColon = CHECKSUM_CANDIDATE.exec(candidate.text)[2].trim();
  const value =
    afterColon.length > 1 && ((afterColon.startsWith("'") && afterColon.endsWith("'")) || (afterColon.startsWith('"') && afterColon.endsWith('"')))
      ? afterColon.slice(1, -1)
      : afterColon;
  return { lines, root, candidate, value };
}

/**
 * The bytes the checksum covers and the checksum itself.
 *
 * R3: every byte except the root checksum line and its terminator. R1: for a
 * gzip or BGZF file these are the decompressed bytes; compression is transport.
 *
 * @param {Uint8Array} data exact, decompressed file bytes
 * @param {'fasta'|'gfa'|'gff3'} container
 * @returns {{stated: string, computed: string, covered: Uint8Array, candidate: {start: number, end: number, text: string, line: number}, lines: ReturnType<typeof headerLines>}}
 */
export function computeChecksum(data, container) {
  const { lines, candidate, value } = findChecksumLine(data, container);
  const kept = [];
  for (const { start, end } of splitLines(data)) {
    if (start === candidate.start && end === candidate.end) continue;
    kept.push(data.subarray(start, end));
  }
  const covered = concatBytes(kept);
  return { stated: value, computed: digest(covered), covered, candidate, lines };
}

/**
 * @param {Uint8Array[]} parts
 * @returns {Uint8Array}
 */
export function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * The YAML text of the whole leading header block, one line after another,
 * prefix and line terminator removed (R2, R6).
 *
 * @param {Uint8Array} data
 * @param {'fasta'|'gfa'|'gff3'} container
 * @returns {string}
 */
export function headerText(data, container) {
  const { lines } = findChecksumLine(data, container);
  return lines.map(({ text }) => text).join('\n');
}
