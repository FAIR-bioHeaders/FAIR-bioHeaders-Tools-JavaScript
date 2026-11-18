/**
 * The FHR-family checksum: which bytes are covered and how they are hashed.
 *
 * Rules implemented here: `docs/FORMAT.md` R2 (exactly one root-level
 * `checksum` line), R3 (that line and its terminator are the only excluded
 * bytes), R4 (SHA-512/256 as canonical padded base64, compared as a string)
 * and R5 (the grammar of the checksum line itself).
 *
 * The rules are applied in one pass by `src/scan.js`; these functions are the
 * in-memory entry points to it. The algorithm is written from the rule text and
 * cross-checked against the shared vectors in `conformance/` (see
 * `docs/CONFORMANCE.md`).
 *
 * @module checksum
 */

import { createHash } from 'node:crypto';

import { HeaderError } from './errors.js';
import { scanBytes, sha512_256Available } from './scan.js';

export { sha512_256Available };

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
 * Locate the single root-level checksum line of a sequence file.
 *
 * R2: the key `checksum` must be unquoted and sit at the root indentation of
 * the other header lines. Nested `checksum` properties stay ordinary metadata
 * and stay covered. R5: the line holds the value and nothing else.
 *
 * @param {Uint8Array} data exact, decompressed file bytes
 * @param {'fasta'|'gfa'|'gff3'} container
 * @returns {{lines: import('./scan.js').HeaderLine[], root: number, candidate: import('./scan.js').HeaderLine, value: string}}
 */
export function findChecksumLine(data, container) {
  const { lines, root, candidate, stated } = scanBytes(data, container, { hash: false });
  return { lines, root, candidate, value: stated };
}

/**
 * The checksum a file states and the one its bytes have.
 *
 * R3: every byte except the root checksum line and its terminator. R1: for a
 * gzip or BGZF file these are the decompressed bytes; compression is transport.
 * The digest is computed without copying the covered bytes; `covered` builds
 * that copy only when it is read.
 *
 * @param {Uint8Array} data exact, decompressed file bytes
 * @param {'fasta'|'gfa'|'gff3'} container
 * @returns {{stated: string, computed: string, coveredLength: number, covered: Uint8Array, candidate: import('./scan.js').HeaderLine, lines: import('./scan.js').HeaderLine[]}}
 */
export function computeChecksum(data, container) {
  const { stated, computed, coveredLength, candidate, lines } = scanBytes(data, container);
  const result = { stated, computed: /** @type {string} */ (computed), coveredLength, candidate, lines };
  Object.defineProperty(result, 'covered', {
    enumerable: true,
    get: () => concatBytes([data.subarray(0, candidate.start), data.subarray(candidate.end)]),
  });
  return /** @type {any} */ (result);
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
