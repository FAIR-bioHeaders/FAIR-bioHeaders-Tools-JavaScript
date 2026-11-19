/**
 * The minimal GFF3 feature-row index FHGM K4 resolves a `featureId` against.
 *
 * What this module is, precisely: a scanner over the tab-separated feature rows
 * of a GFF3 body that records, for every row carrying an `ID=` attribute, the
 * row's `type` (column 3) and its `ID` value (column 9). Nothing else is read
 * and nothing is judged: no SO-term lookup, no coordinate, parent/child or
 * biology rule, no profile, no escape validation beyond percent-decoding the
 * identifier itself. Full GFF3 feature validation belongs to `gff3-validator`
 * (docs/FORMAT.md and the catalogue in that repository); this index exists
 * because the FHGM draft's K4 needs exactly two facts about each row - which
 * identifier it carries and how many rows carry it - and a reader that cannot
 * get them would otherwise have to declare K4 unrunnable.
 *
 * That is the boundary the capability matrix records: the FHGM lane of this
 * library now resolves a `featureId` against the enclosing file's own rows, and
 * still performs no feature validation. A row this scanner reads is a row K4 can
 * count; whether that row is *correct* is a different question, owned elsewhere.
 *
 * Rules the scanner follows, each one matching what the owning repository's
 * checker (`FHGM-Specification/development/model/validate_fhgm.py`, `gene_targets`)
 * does with the vectors K4 was authored against:
 *
 * - a line ends at LF, at CRLF, or at a lone CR - the terminators the rest of
 *   this library accepts (`src/lines.js`, `src/scan.js`). Counting rows by
 *   terminator rather than by content would make an editor's choice of line
 *   ending decide whether K4 abstains, which is what issue #21's review
 *   blocked: the same file's rows are the same rows either way;
 * - iteration stops at the `##FASTA` line: sequence bytes are not feature rows;
 * - blank lines and every line starting with `#` are skipped, which removes the
 *   FHGFF3 header block (`#~`), the `##gff-version` line, and other directives;
 * - a row must hold exactly nine tab-separated fields. One that does not is a
 *   defect of the feature layer, and this scanner is not the rule that judges
 *   it: it records a problem and keeps scanning. An unusable layer makes K4
 *   `unchecked`, never a rejection of the file and never a pass (rule V7 keeps
 *   draft verdicts beside the released FHGFF3 result, and an unchecked clause
 *   must not move either);
 * - the first `ID=` attribute of a row holds the identifier and no other
 *   does: gff3-validator's `parse_attributes` keeps the first value of a
 *   repeated tag and reports the repeat as GFF-ATT-004, so a second, distinct
 *   `ID=` on one row is a syntax defect, not an addressable identifier, and an
 *   `ID=` with no value is not an identifier at all (`_check_reserved` sets
 *   `attributes.id` only on a truthy value). The index follows both rules
 *   exactly (issue #11, items 2-prime and 3); judging the row's syntax stays
 *   gff3-validator's job;
 * - `ID` values are percent-escaped in GFF3, and an indexed entry keeps the
 *   value as written; decoding is `src/fhgm.js`'s step, shared with the record
 *   side, so K4 compares decoded identifiers on both sides (the rule text in
 *   FHGM-Specification, "resolves to exactly one local `gene` row
 *   (percent-decoded)");
 * - every nine-field feature row is counted, whether or not it carries an ID.
 *   That count - not the number of ID entries - is what tells a caller "this
 *   layer has no rows to resolve against" apart from "its rows carry no
 *   identifiers": the first is absent, which is never scored, the second is
 *   not-found, which is (issue #11, item 1).
 *
 * @module features
 */

/** The row types K4 accepts as a gene row: the SO term name or its accession. */
export const GENE_ROW_TYPES = Object.freeze(['gene', 'SO:0000704']);

const UTF8 = new TextDecoder('utf-8', { fatal: false });
const UTF8_KEEP_BOM = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

/**
 * @param {unknown} type a value from column 3 of a feature row
 * @returns {boolean} whether K4 may treat a row of this type as a gene row
 */
export function isGeneRowType(type) {
  return GENE_ROW_TYPES.includes(type);
}

/**
 * @typedef {object} FeatureRow
 * @property {string} id the `ID=` value as written, percent escapes intact
 * @property {string} type the row's type field (column 3), as written
 * @property {number} line 1-based line number of the row in the source
 */

/**
 * @typedef {object} FeatureIndex
 * @property {FeatureRow[]} rows one entry per addressable `ID=` attribute seen, in file order;
 *   a row contributes at most one, for its first non-empty `ID=` tag
 * @property {string[]} problems why the layer cannot be trusted, empty when it can;
 *   a non-empty list means the caller must not score any rule that depends on it
 * @property {number} featureRows nine-field feature rows scanned, whether or not they
 *   carry an ID; 0 with no problems is what an oracle calls an absent layer
 */

/**
 * Index the `ID`/`type` facts of every feature row of a GFF3 body.
 *
 * Accepts the decompressed file text as a string or as bytes; compressed input
 * is refused with a problem rather than silently mis-scanned, because callers
 * reach this from inside the reader where the bytes are already decompressed,
 * and a gzip stream scanned as text would produce a confidently wrong index.
 *
 * @param {string|Uint8Array} source decompressed GFF3 content
 * @returns {FeatureIndex}
 */
export function indexGff3FeatureRows(source) {
  if (typeof source === 'string') {
    return scanText(source);
  }
  if (source instanceof Uint8Array) {
    if (source.length >= 2 && source[0] === GZIP_MAGIC_0 && source[1] === GZIP_MAGIC_1) {
      return {
        rows: [],
        problems: ['the feature layer was handed to the index still compressed; decompress it (or pass the bytes to inspectBytes, which indexes the decompressed content)'],
        featureRows: 0,
      };
    }
    const indexer = new FeatureRowIndexer();
    indexer.push(source);
    return indexer.finish();
  }
  return { rows: [], problems: [`indexGff3FeatureRows takes decompressed GFF3 text or bytes, found ${source === null ? 'null' : typeof source}`], featureRows: 0 };
}

/**
 * The same index as an incremental reader, for a file that is never held whole:
 * `push` decompressed chunks in order, then `finish`. Lines end at LF, at CRLF,
 * or at a lone CR - the same terminators `src/lines.js` and `src/scan.js`
 * accept - and are decoded one at a time; only the line in progress is buffered,
 * and nothing after `##FASTA` is kept at all. A CRLF cut across a chunk
 * boundary (CR last byte of one push, LF first of the next) is one terminator,
 * not two, and adds no empty line.
 */
export class FeatureRowIndexer {
  constructor() {
    /** @type {FeatureRow[]} */
    this.rows = [];
    /** @type {string[]} */
    this.problems = [];
    /** @type {Uint8Array[]} */
    this.pending = [];
    this.index = 0;
    this.stopped = false;
    this.omitted = 0;
    this.featureRows = 0;
    this.afterCR = false;
  }

  /**
   * @param {Uint8Array} chunk
   */
  push(chunk) {
    let at = 0;
    while (!this.stopped && at < chunk.length) {
      if (this.afterCR) {
        // The previous push ended on a CR; an LF here is that terminator's
        // second byte, consumed with no new line.
        this.afterCR = false;
        if (chunk[at] === 0x0a) {
          at += 1;
          continue;
        }
      }
      const lf = chunk.indexOf(0x0a, at);
      const cr = chunk.indexOf(0x0d, at);
      const end = lf === -1 ? cr : cr === -1 ? lf : Math.min(lf, cr);
      if (end === -1) {
        this.pending.push(chunk.slice(at));
        return;
      }
      this.pending.push(chunk.subarray(at, end));
      this.afterCR = chunk[end] === 0x0d;
      at = end + 1;
      this.flush();
    }
  }

  /**
   * @returns {FeatureIndex}
   */
  finish() {
    if (!this.stopped) this.flush();
    return { rows: this.rows, problems: withOmitted(this.problems, this.omitted), featureRows: this.featureRows };
  }

  flush() {
    const parts = this.pending;
    this.pending = [];
    let bytes;
    if (parts.length === 1) bytes = parts[0];
    else {
      bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
      }
    }
    // A byte order mark is dropped only at the start of the text, as decoding the
    // whole text at once would drop it.
    const text = (this.index === 0 ? UTF8 : UTF8_KEEP_BOM).decode(bytes);
    const outcome = scanLine(text, this.index, this.rows, this.problems);
    if (outcome === STOP) this.stopped = true;
    else if (outcome === OMITTED) this.omitted += 1;
    else if (outcome === FEATURE) this.featureRows += 1;
    this.index += 1;
  }
}

const STOP = Symbol('stop');
const OMITTED = Symbol('omitted');
const FEATURE = Symbol('feature');

/**
 * How many malformed lines are described one by one. A single one already makes
 * the layer untrustworthy, so the rest are only counted: a large malformed file
 * must not grow the index by one message per line.
 */
export const MAX_LISTED_PROBLEMS = 20;

/**
 * @param {string[]} problems
 * @param {number} omitted
 * @returns {string[]}
 */
function withOmitted(problems, omitted) {
  if (omitted === 0) return problems;
  return [...problems, `${omitted} further malformed line${omitted === 1 ? ' is' : 's are'} not listed`];
}

/**
 * @param {string} raw one line, LF removed
 * @param {number} index 0-based line index
 * @param {FeatureRow[]} rows
 * @param {string[]} problems
 * @returns {typeof STOP|typeof OMITTED|typeof FEATURE|undefined}
 */
function scanLine(raw, index, rows, problems) {
  const line = raw.replace(/\r$/, '');
  const where = `line ${index + 1}`;
  if (line === '##FASTA') return STOP;
  if (line.trim() === '' || line.startsWith('#')) return undefined;
  const columns = line.split('\t');
  if (columns.length !== 9) {
    if (problems.length >= MAX_LISTED_PROBLEMS) return OMITTED;
    problems.push(`${where}: a GFF3 feature row holds nine tab-separated fields, this line holds ${columns.length}; the feature index cannot trust this layer`);
    return undefined;
  }
  for (const attribute of columns[8].split(';')) {
    const eq = attribute.indexOf('=');
    if (eq < 0) continue;
    if (attribute.slice(0, eq) !== 'ID') continue;
    // The first ID tag of the row holds the identifier and no other does, and
    // a tag with no value is not an identifier: both are the oracle's reading
    // (gff3-validator `parse_attributes` keeps the first value of a repeated
    // tag; `_check_reserved` sets `attributes.id` only on a truthy value).
    const value = attribute.slice(eq + 1);
    if (value !== '') rows.push({ id: value, type: columns[2], line: index + 1 });
    break;
  }
  return FEATURE;
}

/**
 * @param {string} text
 * @returns {FeatureIndex}
 */
function scanText(text) {
  /** @type {FeatureRow[]} */
  const rows = [];
  /** @type {string[]} */
  const problems = [];
  let omitted = 0;
  let featureRows = 0;
  // LF, CRLF and lone CR all end a line: a row is a row whatever its author's
  // editor wrote, and a terminator this scanner failed to see must never be
  // reportable as "no feature rows" (#21 review, finding 1).
  const lines = text.split(/\r\n|\r|\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const outcome = scanLine(lines[index], index, rows, problems);
    if (outcome === STOP) break;
    if (outcome === OMITTED) omitted += 1;
    else if (outcome === FEATURE) featureRows += 1;
  }
  return { rows, problems: withOmitted(problems, omitted), featureRows };
}
