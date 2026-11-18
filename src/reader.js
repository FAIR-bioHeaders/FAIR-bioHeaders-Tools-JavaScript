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
 * `gff3-validator`. The FHGM draft lane alone reads two columns below the header
 * - each feature row's `type` and `ID` - because FHGM K4 resolves a record
 * `featureId` against them; that index resolves pointers and judges no feature.
 *
 * @module reader
 */

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { open as openFile, rename, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable, pipeline } from 'node:stream';
import { createGunzip, gunzipSync } from 'node:zlib';

import { HeaderError } from './errors.js';
import { LIMITS } from './lines.js';
import { HeaderScanner } from './scan.js';
import { enabledDrafts, selectSchema } from './selection.js';
import { validateRecord } from './validate.js';
import { loadHeaderYaml } from './yaml.js';
import { checkFhgmModels } from './fhgm.js';
import { FeatureRowIndexer } from './features.js';
import { verifyParentLinks } from './parent-links.js';
import { headerTypesByContainer } from './types.js';

const GZIP_MAGIC = [0x1f, 0x8b];

/**
 * Which header types occur in which container (docs/FORMAT.md, "Each header type
 * has its containers"), with the V7 lane shut: exactly the released FHR, FHP and
 * FHGFF3 this library has always accepted.
 *
 * `src/types.js` owns the table; this is the default view of it, kept as a
 * constant so nothing recomputes state on a reading.
 */
export const CONTAINER_TYPES = Object.freeze(headerTypesByContainer());

/**
 * @typedef {'fasta'|'gfa'|'gff3'} Container
 */

/**
 * The file's own feature layer, handed to the FHGM lane for K4.
 *
 * `null` is a real answer, not a placeholder: it means this reading built no
 * index, because a FASTA or GFA body is never a GFF3 feature layer. The reader
 * that fills it in and the lane that consumes it agree on that one value, so the
 * gate that decides whether rows are indexed cannot drift away from the decision
 * about whether to read rows back out (issue #19).
 *
 * @typedef {() => (Uint8Array|import('./features.js').FeatureIndex|null)} FeatureLayer
 */

/**
 * @typedef {object} Reading
 * @property {boolean} valid true when the header, its checksum and the cited contract all hold
 * @property {Container} container
 * @property {Record<string, unknown>} metadata the header as a plain object; `{}` when unreadable
 * @property {{stated: string, computed: string, matches: boolean}} checksum base64 SHA-512/256 values
 * @property {{type: string, release: string|null, schemaVersion: string|number|null, rule: string}} schema
 *   what the record cites and what was used; `release` and `schemaVersion` are null
 *   for a V7 draft reading, because a draft has taken neither form
 * @property {string[]} warnings things a conforming validator reports without rejecting the file
 * @property {string[]} errors why the file was rejected, when it was
 * @property {import('./fhgm.js').FhgmResult} [fhgm]
 *   present only when the caller opened the V7 lane for FHGM: the draft verdict on
 *   the `x-fhgm-models` records, held apart from this reading's own FHGFF3 result
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
  if (/\.gff3?$/.test(name)) return 'gff3';
  if (name.endsWith('.gfa')) return 'gfa';
  if (/\.(fasta|fa|fna|faa|fas)$/.test(name)) return 'fasta';
  throw new HeaderError(`cannot tell the container of ${path}: pass {container: 'fasta'|'gfa'|'gff3'}`);
}

/** Bytes read from disk at a time by the file readers. */
const CHUNK = 1 << 20;

/**
 * Whether these bytes start a gzip (or BGZF) stream.
 *
 * @param {Uint8Array} data
 * @returns {boolean}
 */
function isGzip(data) {
  return data.length >= 2 && data[0] === GZIP_MAGIC[0] && data[1] === GZIP_MAGIC[1];
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function firstLine(error) {
  return error instanceof Error ? error.message.split('\n')[0] : String(error);
}

/**
 * The in-memory limit on decompressed bytes, from the options or `LIMITS`.
 *
 * @param {{maxDecompressedBytes?: number}} options
 * @returns {number}
 */
function decompressionLimit(options) {
  const limit = options.maxDecompressedBytes ?? LIMITS.decompressedBytes;
  if (!(typeof limit === 'number' && limit > 0)) {
    throw new HeaderError(`maxDecompressedBytes must be a positive number, got ${JSON.stringify(limit)}`);
  }
  return limit;
}

/**
 * @param {number} limit
 * @returns {HeaderError}
 */
function tooLarge(limit) {
  return new HeaderError(
    `gzip/BGZF input decompresses to more than ${limit} bytes, the limit for in-memory reading (maxDecompressedBytes); ` +
      'inspectFileAsync, inspectStream and stripFileTo read it as a stream with no such limit',
    { rule: 'limits' },
  );
}

/**
 * The bytes the checksum covers are the decompressed bytes: compression is
 * transport, so the same content has the same checksum whatever compressed it
 * (R1).
 *
 * The output is bounded: gzip can expand a few hundred kilobytes into gigabytes,
 * so in-memory decompression stops at `maxDecompressedBytes`
 * (`LIMITS.decompressedBytes`, 1 GiB, by default) with a `HeaderError` instead
 * of exhausting memory. The streaming readers have no such limit because they
 * never hold the output.
 *
 * @param {Uint8Array} data
 * @param {{maxDecompressedBytes?: number}} [options]
 * @returns {Uint8Array}
 */
export function decompress(data, options = {}) {
  if (!isGzip(data)) return data;
  const limit = decompressionLimit(options);
  try {
    return new Uint8Array(gunzipSync(data, { maxOutputLength: limit }));
  } catch (error) {
    if (error instanceof RangeError && /** @type {any} */ (error).code === 'ERR_BUFFER_TOO_LARGE') throw tooLarge(limit);
    throw new HeaderError(`invalid gzip or BGZF input: ${firstLine(error)}`, { rule: 'R1' });
  }
}

/**
 * Decompressed chunks of a byte source, plain or gzip/BGZF, without holding it.
 * A zlib error becomes the same R1 `HeaderError` `decompress` reports; any other
 * error (a file that cannot be read, say) is the caller's and is rethrown as is.
 *
 * @param {AsyncIterable<Uint8Array|string>} source
 * @param {{gzip: boolean}} transport set to whether the source turned out to be gzip
 * @returns {AsyncGenerator<Uint8Array>}
 */
async function* decompressedChunks(source, transport) {
  const iterator = source[Symbol.asyncIterator]();
  let finished = false;
  /** @type {Uint8Array[]} */
  const head = [];
  let headLength = 0;
  try {
    while (headLength < 2) {
      const next = await iterator.next();
      if (next.done) {
        finished = true;
        break;
      }
      const chunk = asBytes(next.value);
      if (chunk.length > 0) {
        head.push(chunk);
        headLength += chunk.length;
      }
    }
    const first = head.length === 1 ? head[0] : Buffer.concat(head);
    async function* all() {
      if (first.length > 0) yield first;
      while (!finished) {
        const next = await iterator.next();
        if (next.done) {
          finished = true;
          break;
        }
        yield asBytes(next.value);
      }
    }
    transport.gzip = isGzip(first);
    if (!transport.gzip) {
      yield* all();
      return;
    }
    const gunzip = createGunzip();
    pipeline(Readable.from(all(), { objectMode: false }), gunzip, () => {});
    try {
      for await (const chunk of gunzip) yield chunk;
    } catch (error) {
      if (error instanceof Error && typeof (/** @type {any} */ (error).code) === 'string' && /^Z_/.test(/** @type {any} */ (error).code)) {
        throw new HeaderError(`invalid gzip or BGZF input: ${firstLine(error)}`, { rule: 'R1' });
      }
      throw error;
    }
  } finally {
    if (!finished) await iterator.return?.();
  }
}

/**
 * @param {unknown} value
 * @returns {Uint8Array}
 */
function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  throw new HeaderError(`a byte source must yield Uint8Array chunks, got ${typeof value}`);
}

/**
 * The chunks of a file on disk, read synchronously into fresh buffers.
 *
 * @param {number} fd
 * @param {Uint8Array} [first] bytes already read from the start of the file
 * @returns {Generator<Uint8Array>}
 */
function* fileChunks(fd, first) {
  if (first !== undefined && first.length > 0) yield first;
  for (;;) {
    const buffer = Buffer.allocUnsafe(CHUNK);
    const read = readSync(fd, buffer, 0, CHUNK, null);
    if (read === 0) return;
    yield buffer.subarray(0, read);
  }
}

/**
 * Open a file for the sync readers: either a plain byte stream, read in
 * chunks, or a gzip file, read whole (bounded) and decompressed in memory.
 *
 * @param {string} path
 * @param {{maxDecompressedBytes?: number}} options
 * @param {(chunks: Iterable<Uint8Array>) => T} use
 * @returns {T}
 * @template T
 */
function withFileBytes(path, options, use) {
  const fd = openSync(path, 'r');
  try {
    const first = fileChunks(fd).next();
    const head = first.done ? new Uint8Array(0) : first.value;
    if (!isGzip(head)) return use(fileChunks(fd, head));
    const limit = decompressionLimit(options);
    // A gzip file is not streamed by the sync API, so its compressed size is
    // bounded as well; one this large would decompress past the limit anyway.
    const size = fstatSync(fd).size;
    if (size > limit) throw tooLarge(limit);
    const parts = [head];
    for (const chunk of fileChunks(fd)) parts.push(chunk);
    return use([decompress(Buffer.concat(parts), options)]);
  } finally {
    closeSync(fd);
  }
}
/**
 * R11: in FASTA, a header line should not hold a raw `>` or `@`, because kseq
 * readers start a record at either character. Such a file stays valid and the
 * validator warns. That includes a `;~#` YAML comment line: it is a header line
 * to a FASTA reader like any other, and the toolkit warns about it too. GFA and
 * GFF3 headers are not affected.
 *
 * @param {Array<{text: string, line: number}>} lines the header lines, prefixes removed
 * @param {Container} container
 * @returns {string[]}
 */
function recordMarkerWarnings(lines, container) {
  if (container !== 'fasta') return [];
  const warnings = [];
  for (const { text, line } of lines) {
    const body = text.replace(/^[ \t]*/, '');
    if (body === '' || !(body.includes('>') || body.includes('@'))) continue;
    if (body.startsWith('#')) {
      warnings.push(`R11 warning: the comment on header line ${line} holds a raw '>' or '@'; FASTA readers that start a record at either character read it as one (docs/FORMAT.md R11)`);
      continue;
    }
    const key = /^[^:]*/.exec(body)[0].trim();
    warnings.push(`R11 warning: ${key || 'a header line'} holds a raw '>' or '@'; writers escape it as \\x3E or \\x40 in a double-quoted scalar (docs/FORMAT.md R11)`);
  }
  return warnings;
}

/**
 * The reading of a file whose header block has been scanned.
 *
 * @param {import('./scan.js').ScanResult} scan
 * @param {object} context
 * @param {Container} context.container
 * @param {Set<string>} context.drafts
 * @param {Record<string, string[]>} context.allowed
 * @param {object} context.options the caller's options
 * @param {string[]} context.warnings collected into, so a later throw keeps them
 * @param {FeatureLayer} context.features
 *   the file's own feature layer, for the FHGM lane's K4; `null` when this reading
 *   built none, which the lane reports as K4 `not-checked`
 * @returns {Reading}
 */
function readingFromScan(scan, { container, drafts, allowed, options, warnings, features }) {
  /** @type {string[]} */
  const errors = [];
  const { stated, computed, coveredLength, lines } = scan;
  const text = lines.map(({ text: line }) => line).join('\n');
  const read = loadHeaderYaml(text);
  const metadata = read.metadata;
  warnings.push(...read.warnings);
  if (typeof metadata.checksum !== 'string' || metadata.checksum !== stated) {
    errors.push('the checksum header line must hold the complete checksum value as a single-line scalar that matches the parsed metadata (R5)');
  }
  if (stated !== computed) {
    errors.push(`checksum mismatch: the line states ${stated}, SHA-512/256 of the ${coveredLength} covered bytes is ${computed} (R3, R4)`);
  }
  warnings.push(...recordMarkerWarnings(lines, container));
  const selection = selectSchema(metadata, { drafts: [...drafts] });
  if (!(allowed[container] ?? []).includes(selection.type)) {
    errors.push(`a ${selection.type} header does not belong in a ${container} file, whatever its checksum says (docs/FORMAT.md)`);
  }
  const result = validateRecord(metadata, selection);
  errors.push(...result.errors);
  warnings.push(...result.warnings);
  /** @type {Reading} */
  const reading = {
    valid: errors.length === 0,
    container,
    metadata,
    checksum: { stated, computed: /** @type {string} */ (computed), matches: stated === computed },
    schema: { type: selection.type, release: selection.release, schemaVersion: result.schema.schemaVersion, rule: selection.rule },
    warnings,
    errors,
  };
  // C3, lane-only: a parent link is verified against bytes the caller handed
  // over, never against a file this library went and opened. With no resolver
  // every link is `unchecked`, which C3 says leaves the record valid - an
  // unsupplied parent is not a rejection, and it is never reported as verified.
  if (selection.rule === 'V7' && Array.isArray(metadata.derivedFrom) && metadata.derivedFrom.length > 0) {
    const links = verifyParentLinks(metadata, { type: selection.type, resolveParent: options.parents });
    reading.parentLinks = links;
    errors.push(...links.errors);
    warnings.push(...links.warnings.filter((line) => !line.includes('unreleased draft')));
    if (links.errors.length > 0) reading.valid = false;
  }
  // The FHGM draft lane reports beside the file's own result, never inside it:
  // a verdict on nested records must not become, or alter, the released FHGFF3
  // result of the file that carries them. K4 resolves against the file's own
  // feature rows unless the caller chose a different resolver (`features`) or
  // brought only ids (`geneIds`); `options.fhgm.features: null` closes it.
  if (drafts.has('FHGM') && selection.type === 'FHGFF3') {
    const fhgmOptions = { base: { valid: errors.length === 0 }, ...(options.fhgm ?? {}) };
    if (fhgmOptions.features === undefined && fhgmOptions.geneIds === undefined) {
      // Whether a layer exists is the reader's question, not this function's: the
      // closure says `null` when the container never fed rows to an index, and
      // `features: null` is the lane's own documented "no feature layer" signal -
      // K4 reports `not-checked`, and every other FHGM rule still runs. A lane
      // that cannot evaluate says so; it neither throws nor passes.
      const layer = features();
      if (layer === null) {
        fhgmOptions.features = null;
        warnings.push(`FHGM K4 not-checked: a ${container} file carries no GFF3 feature rows for this reading to resolve a featureId against, so no feature target was checked`);
      } else {
        fhgmOptions.features = layer;
      }
    }
    reading.fhgm = checkFhgmModels(metadata, fhgmOptions);
  }
  return reading;
}

/**
 * The reading of a file that broke a rule before its record could be read.
 *
 * @param {unknown} error
 * @param {Container} container
 * @param {string[]} warnings
 * @returns {Reading}
 */
function readingFromError(error, container, warnings) {
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

/**
 * What every reader needs before it reads a byte: the container, the lane and
 * whether the FHGM lane wants the file's own feature rows.
 *
 * @param {string} caller
 * @param {object} options
 */
function readingContext(caller, options) {
  const container = options.container ?? (options.name !== undefined ? containerOf(options.name) : undefined);
  if (container === undefined) {
    throw new HeaderError(`${caller} needs {container: 'fasta'|'gfa'|'gff3'} or a {name} to infer it from`);
  }
  const drafts = enabledDrafts(options);
  const allowed = drafts.size === 0 ? CONTAINER_TYPES : headerTypesByContainer([...drafts]);
  const fhgm = options.fhgm ?? {};
  // The file's own feature rows are only ever read for an FHGFF3 header, and an
  // FHGFF3 header only belongs in a GFF3 file: a FASTA or GFA body is never fed
  // to the index, whatever lanes are open, so `{ drafts: true }` keeps the
  // memory of a streamed sequence file the size of its header block. This is the
  // one place that predicate lives: a reader that builds no index hands the lane
  // a `null` layer, and `readingFromScan` reports K4 `not-checked` on it, so the
  // producer and the consumer cannot disagree (issue #19).
  const wantsFeatures = container === 'gff3' && drafts.has('FHGM') && fhgm.features === undefined && fhgm.geneIds === undefined;
  return { container, drafts, allowed, wantsFeatures };
}

/**
 * Read a sequence of decompressed chunks synchronously.
 *
 * @param {Iterable<Uint8Array>} chunks
 * @param {ReturnType<typeof readingContext>} context
 * @param {object} options
 * @returns {Reading}
 */
function readChunks(chunks, context, options) {
  const { container } = context;
  /** @type {string[]} */
  const warnings = [];
  try {
    const scanner = new HeaderScanner(container, { versionLine: true, byteOrderMark: true });
    const indexer = context.wantsFeatures ? new FeatureRowIndexer() : null;
    for (const chunk of chunks) {
      if (indexer !== null) indexer.push(chunk);
      scanner.push(chunk);
    }
    const scan = scanner.finish();
    // No cast, and no assumed index: `null` is the answer this reading gives when
    // `wantsFeatures` was false, and the lane turns it into `not-checked`.
    return readingFromScan(scan, { ...context, options, warnings, features: () => (indexer === null ? null : indexer.finish()) });
  } catch (error) {
    return readingFromError(error, container, warnings);
  }
}

/**
 * Read and check the bytes of a FAIR-bioHeaders file.
 *
 * Nothing throws for a non-conforming file: findings come back in `errors`, and
 * an unavailable contract is reported as `unsupported-version` in the message
 * text and never checked against another schema (V4).
 *
 * The bytes are scanned once, without copying them: the header lines are kept
 * and every other byte goes straight into the SHA-512/256 hash. Gzip/BGZF input
 * is decompressed in memory first, up to `maxDecompressedBytes`; past that the
 * reading is an error naming the limit, and the streaming readers
 * (`inspectFileAsync`, `inspectStream`) are the way to read it.
 *
 * With no `drafts` option this is exactly the reading this library produced
 * before the rule-V7 lane existed, byte for byte: `test/default-gate.test.mjs`
 * compares every vector's reading against `test/goldens/default-gate.json`.
 *
 * @param {Uint8Array} data the file's exact bytes, plain or gzip/BGZF
 * @param {object} [options]
 * @param {Container} [options.container] the container; required without `name`
 * @param {string} [options.name] a file name used only to infer the container
 * @param {string[]|true} [options.drafts] the V7 lane: draft type ids to recognise,
 *   or `true` for every draft this build pins. Absent, the lane stays shut.
 * @param {import('./fhgm.js').FhgmOptions} [options.fhgm] FHGM lane options
 *   (`{overlay: true}`, `{predecessors: [...]}`, `{features: ...}` for a K4
 *   resolver); read only when the lane names FHGM. With the lane open and no
 *   resolver chosen, K4 resolves against this file's own feature rows.
 * @param {(link: object) => ({bytes: Uint8Array|null}|null)} [options.parents] the
 *   C3 parent resolver for a V7 reading with `derivedFrom` links
 * @param {number} [options.maxDecompressedBytes] the in-memory decompression limit
 *   (default `LIMITS.decompressedBytes`, 1 GiB)
 * @returns {Reading}
 */
export function inspectBytes(data, options = {}) {
  const context = readingContext('inspectBytes', options);
  let bytes;
  try {
    bytes = decompress(data, options);
  } catch (error) {
    return readingFromError(error, context.container, []);
  }
  // In memory the K4 layer is indexed from the bytes when the lane asks for it.
  return readChunks([bytes], { ...context, wantsFeatures: context.wantsFeatures }, options);
}

/**
 * Read and check a file by path, synchronously.
 *
 * A plain file is read in 1 MiB chunks and never held whole, so its size is not
 * limited. A gzip/BGZF file is decompressed in memory, up to
 * `maxDecompressedBytes`; `inspectFileAsync` streams it instead.
 *
 * Takes every option `inspectBytes` takes - `drafts`, `fhgm`, `parents` and
 * `maxDecompressedBytes` included - and passes them on unchanged; the file name
 * only stands in for `container` when that is not given.
 *
 * @param {string} path
 * @param {Parameters<typeof inspectBytes>[1]} [options] as for `inspectBytes`;
 *   `container` overrides the name-based guess
 * @returns {Reading}
 */
export function inspectFile(path, options = {}) {
  const merged = { ...options, name: path };
  const context = readingContext('inspectFile', merged);
  try {
    return withFileBytes(path, merged, (chunks) => readChunks(chunks, context, merged));
  } catch (error) {
    return readingFromError(error, context.container, []);
  }
}

/**
 * Read and check a stream of bytes, without holding it.
 *
 * Memory stays the size of the header block whatever the size of the input, and
 * gzip/BGZF input is decompressed as it arrives, with no limit on its size. The
 * reading is the one `inspectBytes` gives for the same bytes, including which
 * finding is reported first: a broken gzip stream is reported in preference to a
 * rule broken earlier in its content, as the in-memory reader reports it.
 *
 * @param {AsyncIterable<Uint8Array>} source a Node `Readable`, a web
 *   `ReadableStream`, or any async iterable of byte chunks; plain or gzip/BGZF
 * @param {Parameters<typeof inspectBytes>[1]} [options] as for `inspectBytes`
 *   (`maxDecompressedBytes` does not apply)
 * @returns {Promise<Reading>}
 */
export async function inspectStream(source, options = {}) {
  const context = readingContext('inspectStream', options);
  const { container } = context;
  /** @type {string[]} */
  const warnings = [];
  try {
    const scanner = new HeaderScanner(container, { versionLine: true, byteOrderMark: true });
    const indexer = context.wantsFeatures ? new FeatureRowIndexer() : null;
    /** @type {unknown} */
    let failure = null;
    const transport = { gzip: false };
    for await (const chunk of decompressedChunks(source, transport)) {
      if (failure === null) {
        try {
          if (indexer !== null) indexer.push(chunk);
          scanner.push(chunk);
        } catch (error) {
          if (!(error instanceof HeaderError)) throw error;
          failure = error;
        }
      }
      // A plain stream can stop at its first finding. A gzip stream is read to
      // its end, so a corrupt stream is reported as such, as in memory.
      if (failure !== null && !transport.gzip) break;
    }
    if (failure !== null) throw failure;
    const scan = scanner.finish();
    // No cast, and no assumed index: `null` is the answer this reading gives when
    // `wantsFeatures` was false, and the lane turns it into `not-checked`.
    return readingFromScan(scan, { ...context, options, warnings, features: () => (indexer === null ? null : indexer.finish()) });
  } catch (error) {
    return readingFromError(error, container, warnings);
  }
}

/**
 * Read and check a file by path, as a stream: no size limit, gzip/BGZF
 * included, and memory the size of the header block.
 *
 * @param {string} path
 * @param {Parameters<typeof inspectBytes>[1]} [options] as for `inspectFile`
 * @returns {Promise<Reading>}
 */
export async function inspectFileAsync(path, options = {}) {
  const merged = { ...options, name: path };
  readingContext('inspectFileAsync', merged);
  const stream = createReadStream(path, { highWaterMark: CHUNK });
  try {
    return await inspectStream(stream, merged);
  } finally {
    stream.destroy();
  }
}

/**
 * Remove the header block from a FAIR-bioHeaders file, byte-exactly.
 *
 * Every `;~`/`#~` line of the leading header block goes, with its terminator;
 * ordinary comments, blank lines and all data bytes stay exactly as they were.
 * This is what a strict FASTA reader needs before it will open the file.
 *
 * Stripping needs no contract: it is a byte operation on the header block, so
 * it works on a file whose metadata cites a schema this build does not have —
 * the checksum is not re-verified here, and nothing is re-compressed. The same
 * R2/R5 checks that find the checksum line refuse a malformed header block.
 *
 * @param {Uint8Array} data the file's exact bytes, plain or gzip/BGZF
 * @param {object} options
 * @param {Container} [options.container]
 * @param {string} [options.name]
 * @param {number} [options.maxDecompressedBytes] as for `inspectBytes`
 * @returns {Uint8Array}
 */
export function stripBytes(data, options = {}) {
  const container = stripContainer('stripBytes', options);
  return stripChunks([decompress(data, options)], container);
}

/**
 * @param {string} caller
 * @param {{container?: Container, name?: string}} options
 * @returns {Container}
 */
function stripContainer(caller, options) {
  const container = options.container ?? (options.name !== undefined ? containerOf(options.name) : undefined);
  if (container === undefined) {
    throw new HeaderError(`${caller} needs {container: 'fasta'|'gfa'|'gff3'} or a {name} to infer it from`);
  }
  return container;
}

/**
 * @param {Iterable<Uint8Array>} chunks decompressed bytes
 * @param {Container} container
 * @returns {Uint8Array}
 */
function stripChunks(chunks, container) {
  /** @type {Uint8Array[]} */
  const kept = [];
  let total = 0;
  const scanner = new HeaderScanner(container, {
    hash: false,
    byteOrderMark: true, // R7: a stripped copy is still a sequence file
    onData: (bytes) => {
      kept.push(bytes);
      total += bytes.length;
    },
  });
  for (const chunk of chunks) scanner.push(chunk);
  scanner.finish();
  try {
    return kept.length === 1 ? kept[0] : Buffer.concat(kept, total);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new HeaderError(`the stripped file is ${total} bytes, more than one buffer holds in this Node.js; use stripFileTo, which writes it as a stream`, { rule: 'limits' });
    }
    throw error;
  }
}

/**
 * Strip a file by path, synchronously, returning the stripped bytes.
 *
 * A plain file is read in chunks; the result is still one buffer of the file's
 * size. `stripFileTo` writes the stripped file as a stream instead.
 *
 * @param {string} path
 * @param {object} [options]
 * @param {Container} [options.container]
 * @param {number} [options.maxDecompressedBytes] as for `inspectBytes`
 * @returns {Uint8Array}
 */
export function stripFile(path, options = {}) {
  const container = stripContainer('stripFile', { ...options, name: path });
  return withFileBytes(path, options, (chunks) => stripChunks(chunks, container));
}

/**
 * Strip a file to another file, as a stream: no size limit, gzip/BGZF input
 * included (the output is written uncompressed), and memory the size of the
 * header block.
 *
 * The output appears only when the whole input has been read and its header
 * block found well-formed: it is written to a temporary file beside `output` and
 * renamed into place, and on any error the temporary file is removed and the
 * error rethrown, so a refused or broken input never leaves a partial file.
 *
 * @param {string} input
 * @param {string} output
 * @param {object} [options]
 * @param {Container} [options.container] overrides the name-based guess from `input`
 * @returns {Promise<{bytesWritten: number}>}
 */
export async function stripFileTo(input, output, options = {}) {
  const container = stripContainer('stripFileTo', { ...options, name: input });
  const temporary = `${output}.${process.pid}.${Date.now()}.partial`;
  const handle = await openFile(temporary, 'wx');
  let bytesWritten = 0;
  const stream = createReadStream(input, { highWaterMark: CHUNK });
  try {
    /** @type {Uint8Array[]} */
    let pending = [];
    const scanner = new HeaderScanner(container, { hash: false, byteOrderMark: true, onData: (bytes) => pending.push(bytes) });
    for await (const chunk of decompressedChunks(stream, { gzip: false })) {
      scanner.push(chunk);
      for (const bytes of pending) bytesWritten += await writeAll(handle, bytes);
      pending = [];
    }
    scanner.finish();
    for (const bytes of pending) bytesWritten += await writeAll(handle, bytes);
    await handle.close();
    await rename(temporary, output);
    return { bytesWritten };
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(temporary, { force: true });
    throw error;
  } finally {
    stream.destroy();
  }
}

/**
 * Write every byte of `bytes`. `FileHandle.write` may write fewer bytes than it
 * was given; the unwritten suffix is written again until none is left.
 *
 * @param {import('node:fs/promises').FileHandle} handle
 * @param {Uint8Array} bytes
 * @returns {Promise<number>} the number of bytes written, always `bytes.length`
 */
async function writeAll(handle, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, null);
    if (!(bytesWritten > 0)) throw new Error(`writing the stripped output made no progress after ${offset} of ${bytes.length} bytes`);
    offset += bytesWritten;
  }
  return offset;
}
