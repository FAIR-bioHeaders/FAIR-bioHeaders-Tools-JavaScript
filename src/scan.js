/**
 * One pass over a sequence file's bytes: the header block, the checksum and
 * every rule that depends on line structure, without holding the file.
 *
 * Rules implemented here: `docs/FORMAT.md` R1 (lines end at LF, CRLF or a lone
 * CR), R2 (exactly one root-level checksum line), R3 (that line and its
 * terminator are the only bytes not covered), R4 (SHA-512/256), R5 (the
 * checksum line grammar), R6 (header lines are UTF-8 without YAML-only line
 * breaks), R7 (no byte order mark), R10 (header lines come first), the reader
 * limits, and `docs/FHGFF3.md` G1 (GFF3 line 1).
 *
 * The bytes arrive in chunks of any size, split anywhere, and each byte is
 * looked at once. Only the header lines are kept, and those are bounded by
 * `LIMITS.headerBytes`; every other byte goes straight into the hash and, for a
 * caller that strips, out again. Memory therefore stays the size of the header
 * whatever the size of the file, and offsets are plain numbers, so a file over
 * 2 GiB (or 4 GiB) is read like any other.
 *
 * Which header line is the root checksum line is only certain once the block
 * has ended: R2 compares indentations, and a later line can be less indented.
 * The scanner keeps a copy of the hash state taken just before the one
 * candidate that is currently at the smallest indentation, feeds it every
 * later byte, and drops it when a less indented line appears or a second
 * candidate at the same indentation does. At the end the surviving copy is the
 * hash of every byte except the root checksum line, which is what R3 asks for.
 *
 * @module scan
 */

import { createHash } from 'node:crypto';

import { HeaderError } from './errors.js';
import { LIMITS, PREFIXES, assertNoByteOrderMark, isGff3VersionLine } from './lines.js';

/**
 * R4/R5: the checksum value is 44 characters of canonical padded base64 of a
 * 32-byte digest. 32 bytes leave two unused bits that must be zero, so the
 * character before the `=` is one of `AEIMQUYcgkosw048`; any other value is
 * invalid even when it decodes to the same bytes.
 */
const CANONICAL_B64 = '[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=';

/** R5 grammar of the text after the prefix, anchored to the whole line. */
const CHECKSUM_LINE = new RegExp(`^( *)(checksum)( *)(:)( +)(?:${CANONICAL_B64}|'${CANONICAL_B64}'|"${CANONICAL_B64}")( *)$`);

/** R2: which line is a candidate root-level checksum line, before R5 applies. */
const CHECKSUM_CANDIDATE = /^([ \t]*)checksum[ \t]*:(.*)$/s;

/** YAML comment, document start/end or directive line: not header metadata. */
const NOT_METADATA = /^[ \t]*(?:#|%|---(?:[ \t]|$)|\.\.\.(?:[ \t]|$))/;

const LF = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;
const TAB = 0x09;
const HASH = 0x23;
const GT = 0x3e;

/** Bytes a line start must show before it can be classified (`##FASTA` plus one). */
const HEAD = 8;
/** How much of GFF3 line 1 is kept for G1 and its message. */
const FIRST_LINE_KEEP = 4096;
const FASTA_DIRECTIVE = new TextEncoder().encode('##FASTA');
const LENIENT = new TextDecoder('utf-8');

/**
 * @typedef {object} HeaderLine
 * @property {number} start byte offset of the line in the decompressed file
 * @property {number} end offset just past its terminator
 * @property {string} text the bytes after the prefix, terminator removed, as UTF-8
 * @property {number} line 1-based line number
 */

/**
 * @typedef {object} ScanResult
 * @property {string} stated the checksum value the root checksum line states
 * @property {string|null} computed base64 SHA-512/256 of the covered bytes; null when hashing was off
 * @property {number} coveredLength how many bytes the checksum covers
 * @property {number} size how many bytes were scanned
 * @property {HeaderLine} candidate the root checksum line
 * @property {HeaderLine[]} lines every header line, in file order
 * @property {number} root the root indentation of the header (R2)
 */

/**
 * Whether this Node build can compute SHA-512/256 at all.
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
 * @param {string} text a header line's text after its prefix
 * @returns {number} count of leading space and tab characters
 */
function indentOf(text) {
  const match = /^[ \t]*/.exec(text);
  return match ? match[0].length : 0;
}

/**
 * @param {Uint8Array[]} parts
 * @returns {Uint8Array}
 */
function concat(parts) {
  if (parts.length === 1) return parts[0];
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * The incremental reader of one sequence file.
 *
 * `push` each chunk of decompressed bytes in order, then call `finish`. Either
 * throws a `HeaderError` at the first rule the bytes break, in file order, so
 * the reported error is the one a whole-file reader would report; after that the
 * scanner is spent.
 */
export class HeaderScanner {
  /**
   * @param {'fasta'|'gfa'|'gff3'} container
   * @param {object} [options]
   * @param {boolean} [options.hash] compute the checksum (default true); a strip needs only the lines
   * @param {boolean} [options.versionLine] check GFF3 line 1 under G1 (default false: the
   *   checksum and strip helpers never did; `inspect*` does)
   * @param {boolean} [options.byteOrderMark] refuse a leading UTF-8 byte order mark under
   *   R7 (default false: the checksum helpers compute over whatever bytes they are
   *   given; reading and stripping refuse it)
   * @param {(bytes: Uint8Array) => void} [options.onData] called, in order, with every
   *   byte that is not on a header line - the stripped file. The view is only valid
   *   during the call when the caller reuses its buffers.
   */
  constructor(container, options = {}) {
    const prefix = PREFIXES[container];
    if (prefix === undefined) throw new HeaderError(`unknown container ${JSON.stringify(container)}: expected 'fasta', 'gfa' or 'gff3'`);
    if (options.hash !== false && !sha512_256Available()) {
      throw new HeaderError('this Node.js build has no SHA-512/256; the checksum cannot be computed or verified');
    }
    this.container = container;
    this.prefix = prefix;
    this.p0 = prefix.charCodeAt(0);
    this.p1 = prefix.charCodeAt(1);
    this.hash = options.hash === false ? null : createHash('sha512-256');
    this.fork = null;
    this.onData = options.onData ?? null;
    this.versionLine = options.versionLine === true && container === 'gff3';
    this.byteOrderMark = options.byteOrderMark === true;
    this.decoder = new TextDecoder('utf-8', { fatal: true });
    this.size = 0;
    this.lineNo = 0;
    this.block = true;
    /** @type {HeaderLine[]} */
    this.lines = [];
    this.headerBytes = 0;
    this.minIndent = Infinity;
    /** @type {HeaderLine[]} */
    this.atMin = [];
    this.content = 0;
    // The line in progress.
    this.inLine = false;
    this.kind = 'other';
    this.lineStart = 0;
    /** @type {Uint8Array[]} */
    this.parts = [];
    this.partLength = 0;
    this.lineFirst = -1;
    this.blank = true;
    this.firstKept = [];
    this.firstKeptLength = 0;
    this.firstTailBlank = true;
    /** @type {Uint8Array|null} */
    this.carry = null;
    this.pendingCR = false;
    this.failed = null;
    this.done = false;
  }

  /**
   * @param {Uint8Array} chunk the next decompressed bytes
   */
  push(chunk) {
    if (this.failed !== null) throw this.failed;
    if (this.done) throw new Error('HeaderScanner: push after finish');
    try {
      this.consume(chunk, false);
    } catch (error) {
      this.failed = error;
      throw error;
    }
  }

  /**
   * @returns {ScanResult}
   */
  finish() {
    if (this.failed !== null) throw this.failed;
    try {
      this.consume(new Uint8Array(0), true);
      if (this.inLine) this.endLine();
      this.done = true;
      return this.result();
    } catch (error) {
      this.failed = error;
      throw error;
    }
  }

  /**
   * @param {Uint8Array} input
   * @param {boolean} final
   */
  consume(input, final) {
    this.size += input.length;
    let data = input;
    if (this.carry !== null) {
      data = concat([this.carry, input]);
      this.carry = null;
    }
    const n = data.length;
    this.base = this.size - n; // absolute offset of data[0]
    let i = 0;
    // `run` is where the not-yet-hashed bytes of non-header lines begin; -1 while
    // inside a header line, whose bytes are collected and hashed when it ends.
    let run = this.inLine && this.kind === 'header' ? -1 : 0;
    if (this.pendingCR) {
      if (n === 0 && !final) return;
      this.pendingCR = false;
      if (n > 0 && data[0] === LF) {
        this.lineBytes(data, 0, 1);
        i = 1;
      }
      this.endLine();
      if (run === -1) run = i;
    }
    let nextLF = -2;
    let nextCR = -2;
    while (i < n) {
      if (!this.inLine) {
        if (n - i < HEAD && !final) {
          let terminated = false;
          for (let k = i; k < n; k += 1) {
            if (data[k] === LF || data[k] === CR) {
              terminated = true;
              break;
            }
          }
          if (!terminated) {
            if (run >= 0) this.emit(data, run, i);
            this.carry = data.slice(i);
            return;
          }
        }
        this.startLine(data, i);
        if (this.kind === 'header' && run >= 0) {
          this.emit(data, run, i);
          run = -1;
        }
      }
      if (nextLF !== -1 && nextLF < i) nextLF = data.indexOf(LF, i);
      if (nextCR !== -1 && nextCR < i) nextCR = data.indexOf(CR, i);
      let t;
      if (nextLF === -1) t = nextCR;
      else if (nextCR === -1) t = nextLF;
      else t = Math.min(nextLF, nextCR);
      if (t === -1) {
        this.lineBytes(data, i, n);
        i = n;
        break;
      }
      let stop;
      if (data[t] === CR) {
        if (t + 1 < n) stop = data[t + 1] === LF ? t + 2 : t + 1;
        else if (final) stop = t + 1;
        else {
          // A CR at the end of the chunk: whether an LF follows decides where
          // this line ends, so the line stays open until the next chunk.
          this.lineBytes(data, i, n);
          this.pendingCR = true;
          i = n;
          break;
        }
      } else {
        stop = t + 1;
      }
      this.lineBytes(data, i, stop);
      const wasHeader = this.kind === 'header';
      this.endLine();
      i = stop;
      if (wasHeader) run = i;
    }
    if (run >= 0 && run < n) this.emit(data, run, n);
  }

  /**
   * Bytes of non-header lines: into the hash, the surviving fork and the output.
   *
   * @param {Uint8Array} data
   * @param {number} from
   * @param {number} to
   */
  emit(data, from, to) {
    if (to <= from) return;
    const bytes = data.subarray(from, to);
    if (this.hash !== null) {
      this.hash.update(bytes);
      if (this.fork !== null) this.fork.update(bytes);
    }
    if (this.onData !== null) this.onData(bytes);
  }

  /**
   * Classify the line that starts at `data[i]`; at least `HEAD` bytes, or the
   * whole line, are visible.
   *
   * @param {Uint8Array} data
   * @param {number} i
   */
  startLine(data, i) {
    const index = this.lineNo;
    this.inLine = true;
    this.lineStart = this.base + i;
    this.lineFirst = data[i];
    this.blank = true;
    this.parts = [];
    this.partLength = 0;
    if (index === 0 && this.byteOrderMark) assertNoByteOrderMark(data.subarray(i, Math.min(i + 3, data.length))); // R7
    const isPrefix = data[i] === this.p0 && i + 1 < data.length && data[i + 1] === this.p1;
    if (this.container === 'gff3' && index === 0) {
      // G1: with the version check on, line 1 is judged by isGff3VersionLine when
      // it ends, and a #~ line there fails that check; without it, a #~ line 1 is
      // the specific G1 refusal the header-line reader has always given.
      if (isPrefix && !this.versionLine) {
        throw new HeaderError('a #~ header line cannot be the first line of a GFF3 file: line 1 must be "##gff-version 3" (FHGFF3.md G1)', { rule: 'G1' });
      }
      if (isPrefix) {
        this.kind = 'other';
        return;
      }
    }
    if (this.block) {
      if (this.container === 'fasta') {
        if (data[i] === GT) this.block = false;
      } else if (this.container === 'gff3' && startsWith(data, i, FASTA_DIRECTIVE)) {
        this.block = false;
      }
    }
    if (isPrefix) {
      if (!this.block) {
        throw new HeaderError(`a ${this.prefix} header line follows the first record at line ${index + 1} (FORMAT.md R10)`, { rule: 'R10', field: `line ${index + 1}` });
      }
      this.kind = 'header';
    } else {
      this.kind = 'other';
    }
  }

  /**
   * @param {Uint8Array} data
   * @param {number} from
   * @param {number} to
   */
  lineBytes(data, from, to) {
    if (to <= from) return;
    if (this.kind === 'header') {
      this.partLength += to - from;
      if (this.headerBytes + this.partLength > LIMITS.headerBytes) {
        throw new HeaderError(`header lines exceed the ${LIMITS.headerBytes / 2 ** 20} MiB limit`, { rule: 'limits' });
      }
      this.parts.push(data.slice(from, to));
      return;
    }
    // A GFA or GFF3 line that is not a comment ends the block unless it is blank,
    // which is only known once every byte of it has been seen.
    if (this.blank && this.block && this.container !== 'fasta' && this.lineFirst !== HASH) {
      for (let k = from; k < to; k += 1) {
        const c = data[k];
        if (c !== SPACE && c !== TAB && c !== LF && c !== CR) {
          this.blank = false;
          break;
        }
      }
    }
    if (this.versionLine && this.lineNo === 0) {
      const room = FIRST_LINE_KEEP - this.firstKeptLength;
      const keep = Math.min(room, to - from);
      if (keep > 0) {
        this.firstKept.push(data.slice(from, from + keep));
        this.firstKeptLength += keep;
      }
      for (let k = from + keep; k < to && this.firstTailBlank; k += 1) {
        const c = data[k];
        if (c !== SPACE && c !== TAB && c !== LF && c !== CR) this.firstTailBlank = false;
      }
    }
  }

  endLine() {
    const index = this.lineNo;
    this.lineNo += 1;
    this.inLine = false;
    if (this.kind !== 'header') {
      if (this.versionLine && index === 0) {
        const first = LENIENT.decode(concat(this.firstKept)).replace(/[\r\n]+$/, '');
        if (!(this.firstTailBlank && isGff3VersionLine(first))) {
          const shown = this.firstTailBlank ? first : `${first}…`;
          throw new HeaderError(`GFF3 line 1 must be "##gff-version 3" with an optional .MINOR.PATCH (FHGFF3.md G1), found ${JSON.stringify(shown)}`, {
            rule: 'G1',
            field: 'line 1',
          });
        }
      }
      if (this.block && this.container !== 'fasta' && this.lineFirst !== HASH && !this.blank) this.block = false;
      return;
    }
    const bytes = concat(this.parts);
    this.parts = [];
    this.headerBytes += bytes.length;
    if (this.headerBytes > LIMITS.headerBytes) {
      throw new HeaderError(`header lines exceed the ${LIMITS.headerBytes / 2 ** 20} MiB limit`, { rule: 'limits' });
    }
    if (this.lines.length + 1 > LIMITS.headerLines) {
      throw new HeaderError(`header lines exceed the ${LIMITS.headerLines} line limit`, { rule: 'limits' });
    }
    let text;
    try {
      text = this.decoder.decode(bytes.subarray(this.prefix.length));
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
    /** @type {HeaderLine} */
    const line = { start: this.lineStart, end: this.lineStart + bytes.length, text, line: index + 1 };
    this.lines.push(line);

    // R2: track the root indentation and the candidates at it, forking the hash
    // just before a candidate that may turn out to be the root checksum line.
    let newFork = false;
    if (text.trim() !== '' && !NOT_METADATA.test(text)) {
      this.content += 1;
      const indent = indentOf(text);
      if (indent < this.minIndent) {
        this.minIndent = indent;
        this.atMin = [];
        this.fork = null;
      }
    }
    const found = CHECKSUM_CANDIDATE.exec(text);
    if (found !== null && found[1].length === this.minIndent) {
      this.atMin.push(line);
      if (this.atMin.length === 1 && this.hash !== null) {
        this.fork = this.hash.copy();
        newFork = true;
      } else {
        this.fork = null;
      }
    }
    if (this.hash !== null) {
      this.hash.update(bytes);
      if (this.fork !== null && !newFork) this.fork.update(bytes);
    }
  }

  /**
   * @returns {ScanResult}
   */
  result() {
    if (this.versionLine && this.lineNo === 0) {
      throw new HeaderError('an empty GFF3 file has no ##gff-version line (FHGFF3.md G1)', { rule: 'G1', field: 'line 1' });
    }
    if (this.content === 0) {
      throw new HeaderError(`no ${this.prefix} header metadata in the file (FORMAT.md R2)`, { rule: 'R2' });
    }
    if (this.atMin.length !== 1) {
      throw new HeaderError(`expected exactly one root-level ${this.prefix}checksum: line, found ${this.atMin.length} (FORMAT.md R2)`, { rule: 'R2' });
    }
    const candidate = this.atMin[0];
    if (!CHECKSUM_LINE.test(candidate.text)) {
      throw new HeaderError(
        `the checksum line at line ${candidate.line} must hold only the checksum value: 44 canonical base64 characters, optionally quoted, with no comment, tag, tab or other text (FORMAT.md R4 and R5)`,
        { rule: 'R5', field: `line ${candidate.line}` },
      );
    }
    const afterColon = CHECKSUM_CANDIDATE.exec(candidate.text)[2].trim();
    const stated =
      afterColon.length > 1 && ((afterColon.startsWith("'") && afterColon.endsWith("'")) || (afterColon.startsWith('"') && afterColon.endsWith('"')))
        ? afterColon.slice(1, -1)
        : afterColon;
    const computed = this.fork === null ? null : this.fork.digest('base64');
    return {
      stated,
      computed,
      coveredLength: this.size - (candidate.end - candidate.start),
      size: this.size,
      candidate,
      lines: this.lines,
      root: this.minIndent,
    };
  }
}

/**
 * @param {Uint8Array} data
 * @param {number} offset
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
function startsWith(data, offset, bytes) {
  if (offset + bytes.length > data.length) return false;
  for (let k = 0; k < bytes.length; k += 1) {
    if (data[offset + k] !== bytes[k]) return false;
  }
  return true;
}

/**
 * Scan bytes already in memory.
 *
 * @param {Uint8Array} data decompressed file bytes
 * @param {'fasta'|'gfa'|'gff3'} container
 * @param {ConstructorParameters<typeof HeaderScanner>[1]} [options]
 * @returns {ScanResult}
 */
export function scanBytes(data, container, options = {}) {
  const scanner = new HeaderScanner(container, options);
  scanner.push(data);
  return scanner.finish();
}
