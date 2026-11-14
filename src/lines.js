/**
 * Byte-level line reading for FASTA, GFA and GFF3 containers.
 *
 * Rules implemented here: `docs/FORMAT.md` R1 (line definition, no
 * normalisation), R7 (no UTF-8 byte order mark in a sequence file) and R10 with
 * the GFF3 block end (`docs/FHGFF3.md` G1).
 *
 * Everything in this module works on `Uint8Array` bytes. Only header lines are
 * ever decoded; bytes outside the header block stay bytes (R6).
 *
 * @module lines
 */

import { HeaderError } from './errors.js';

/** Line prefixes per container (R2). */
export const PREFIXES = Object.freeze({ fasta: ';~', gfa: '#~', gff3: '#~' });

/**
 * Reader limits. `docs/FORMAT.md` ("Readers may refuse input beyond these
 * limits") states them; a conforming writer stays inside them.
 */
export const LIMITS = Object.freeze({
  headerBytes: 2 ** 20,
  headerLines: 10_000,
  yamlNodes: 20_000,
  yamlDepth: 64,
});

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const LF = 0x0a;
const CR = 0x0d;

/**
 * R1: a line ends at LF, at CRLF, or at a CR that is not followed by LF, and
 * the terminator belongs to the line. A final unterminated run of bytes is a
 * line too.
 *
 * @param {Uint8Array} data
 * @returns {Array<{start: number, end: number}>} byte ranges `[start, end)`
 */
export function splitLines(data) {
  const lines = [];
  let start = 0;
  const size = data.length;
  while (start < size) {
    let end = start;
    while (end < size && data[end] !== LF && data[end] !== CR) end += 1;
    if (end < size) {
      end += data[end] === CR && data[end + 1] === LF ? 2 : 1;
    }
    lines.push({ start, end });
    start = end;
  }
  return lines;
}

/**
 * Reject a leading UTF-8 byte order mark (R7). Sequence containers only: JSON,
 * YAML, JSON-LD and HTML metadata may begin with one.
 *
 * @param {Uint8Array} data
 */
export function assertNoByteOrderMark(data) {
  if (data.length >= 3 && data[0] === UTF8_BOM[0] && data[1] === UTF8_BOM[1] && data[2] === UTF8_BOM[2]) {
    throw new HeaderError('the file begins with a UTF-8 byte order mark (FORMAT.md R7)', { rule: 'R7' });
  }
}

/**
 * @param {Uint8Array} data
 * @param {number} at
 * @returns {boolean} true when the line holds only spaces, tabs and a terminator
 */
function isBlankLine(data, start, end) {
  for (let i = start; i < end; i += 1) {
    const c = data[i];
    if (c !== 0x20 && c !== 0x09 && c !== LF && c !== CR) return false;
  }
  return true;
}

/**
 * The leading header block of a sequence file, and every `;~`/`#~` line in it.
 *
 * R10: every header line must come before the first record — the first FASTA
 * `>` line, or the first GFA line that is neither a `#` comment nor blank; for
 * GFF3 the block also ends at `##FASTA`. A header line after that point is an
 * error, not something to ignore or merge.
 *
 * G1 additionally requires `##gff-version 3` (or `3.MINOR.PATCH`) on GFF3 line 1
 * and rejects a `#~` line there.
 *
 * @param {Uint8Array} data exact file bytes, decompressed
 * @param {'fasta'|'gfa'|'gff3'} container
 * @returns {Array<{start: number, end: number, text: string, line: number}>}
 *   header lines in file order, with `text` the bytes after the prefix and
 *   without its terminator, decoded as UTF-8
 */
export function headerLines(data, container) {
  const prefix = PREFIXES[container];
  const encoder = new TextEncoder();
  const prefixBytes = encoder.encode(prefix);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const lines = splitLines(data);
  const header = [];
  let block = true;
  let headerBytes = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const { start, end } = lines[index];
    const startsWithPrefix = startsWithBytes(data, start, prefixBytes);

    if (container === 'gff3' && index === 0 && startsWithPrefix) {
      throw new HeaderError('a #~ header line cannot be the first line of a GFF3 file: line 1 must be "##gff-version 3" (FHGFF3.md G1)', { rule: 'G1' });
    }

    if (block) {
      if (container === 'fasta') {
        if (data[start] === 0x3e) block = false; // '>'
      } else if (data[start] !== 0x23 && !isBlankLine(data, start, end)) {
        block = false; // a GFA record line, or a GFF3 feature line
      }
      if (container === 'gff3' && startsWithBytes(data, start, encoder.encode('##FASTA'))) {
        block = false;
      }
    }

    if (!startsWithPrefix) continue;
    if (!block) {
      throw new HeaderError(`a ${prefix} header line follows the first record at line ${index + 1} (FORMAT.md R10)`, { rule: 'R10', field: `line ${index + 1}` });
    }
    headerBytes += end - start;
    if (headerBytes > LIMITS.headerBytes) {
      throw new HeaderError(`header lines exceed the ${LIMITS.headerBytes / 2 ** 20} MiB limit`, { rule: 'limits' });
    }
    if (header.length + 1 > LIMITS.headerLines) {
      throw new HeaderError(`header lines exceed the ${LIMITS.headerLines} line limit`, { rule: 'limits' });
    }

    let text;
    try {
      text = decoder.decode(data.subarray(start + prefixBytes.length, end));
    } catch {
      throw new HeaderError(`a header line at line ${index + 1} is not valid UTF-8 (FORMAT.md R6)`, { rule: 'R6', field: `line ${index + 1}` });
    }
    text = text.replace(/[\r\n]+$/, '');
    if (/[\u0085\u2028\u2029]/.test(text)) {
      throw new HeaderError(`a header line at line ${index + 1} contains U+0085, U+2028 or U+2029, which YAML reads as a line break (FORMAT.md R6)`, {
        rule: 'R6',
        field: `line ${index + 1}`,
      });
    }
    header.push({ start, end, text, line: index + 1 });
  }

  return header;
}

/**
 * Does `data` begin with `bytes` at `offset`?
 *
 * @param {Uint8Array} data
 * @param {number} offset
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
function startsWithBytes(data, offset, bytes) {
  if (offset + bytes.length > data.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (data[offset + i] !== bytes[i]) return false;
  }
  return true;
}

/**
 * G1: GFF3 line 1 is `##gff-version 3`, optionally `3.MINOR.PATCH`, with
 * trailing spaces or tabs. The pattern applies to the line content before its
 * terminator, so LF, CRLF and lone CR all match.
 *
 * @param {string} firstLine line 1 content, terminator removed
 * @returns {boolean}
 */
export function isGff3VersionLine(firstLine) {
  return /^##gff-version 3(\.[0-9]+\.[0-9]+)?[ \t]*$/.test(firstLine);
}
