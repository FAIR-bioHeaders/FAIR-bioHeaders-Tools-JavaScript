/**
 * Fixture builders for the draft-lane tests.
 *
 * These are this repository's own test fixtures, not upstream vectors: no shared
 * or development vector bytes are vendored here, because a record that cites a
 * draft stays in the development repository that owns it (rule V7). What they are
 * for is proving the lane's mechanics on real bytes - selection, the draft
 * warning, digest verification, container routing, parent-link verdicts.
 *
 * The checksum is computed with `node:crypto` directly rather than through
 * `src/checksum.js`, so a fixture does not confirm its own library's digest: the
 * SHA-512/256 algorithm itself is proved by the shared vectors (98 fasta, 56 gfa,
 * 36 fhp-fasta and 38 fhgff3, plus `scripts/capability/digest.mjs`), and what is
 * proved here is that the lane reads a file whose checksum line is consistent.
 */

import { createHash } from 'node:crypto';

/**
 * @param {string} value
 * @returns {Uint8Array}
 */
function utf8(value) {
  return new TextEncoder().encode(value);
}

/**
 * Assemble a FASTA file whose `;~` header carries `record`.
 *
 * `record.checksum` is filled in when absent: SHA-512/256 over every byte except
 * the checksum line and its terminator (FORMAT.md R3), canonical padded base64
 * (R4). Keys are emitted in the order given, one `;~` line each; a value that is
 * an object or array is emitted as a nested block in the simple `;~` style the
 * FHR-family writers use.
 *
 * @param {Record<string, unknown>} record
 * @param {object} [options]
 * @param {string} [options.sequence] the payload after the header block
 * @param {string} [options.prefix] the header prefix, `;~` by default
 * @returns {Uint8Array}
 */
export function buildSequenceFile(record, options = {}) {
  const prefix = options.prefix ?? ';~';
  const sequence = options.sequence ?? '>seq1 synthetic fixture\nACGTACGTAC\n';
  const body = { ...record };
  delete body.checksum;
  const lines = [];
  for (const [key, value] of Object.entries(body)) {
    if (Array.isArray(value)) {
      lines.push(`${prefix}${key}:`);
      for (const item of value) {
        if (item !== null && typeof item === 'object') {
          const entries = Object.entries(item);
          entries.forEach(([name, inner], index) => {
            const head = index === 0 ? `${prefix}- ` : `${prefix}  `;
            lines.push(`${head}${name}: ${scalar(inner)}`);
          });
        } else {
          lines.push(`${prefix}- ${scalar(item)}`);
        }
      }
    } else if (value !== null && typeof value === 'object') {
      lines.push(`${prefix}${key}:`);
      for (const [name, inner] of Object.entries(value)) lines.push(`${prefix}  ${name}: ${scalar(inner)}`);
    } else {
      lines.push(`${prefix}${key}: ${scalar(value)}`);
    }
  }
  const checksumLineIndex = lines.length; // the checksum line goes last
  const headerLines = [...lines.map((line) => `${line}\n`), `${prefix}checksum: PLACEHOLDER\n`];
  // R3: every byte except the checksum line and its terminator. `before` is the
  // header above it, `after` is the payload below it.
  const before = utf8(headerLines.slice(0, checksumLineIndex).join(''));
  const after = utf8(sequence);
  const coveredBytes = new Uint8Array(before.length + after.length);
  coveredBytes.set(before, 0);
  coveredBytes.set(after, before.length);
  const checksum = createHash('sha512-256').update(coveredBytes).digest('base64');
  const text = [...headerLines.slice(0, checksumLineIndex), `${prefix}checksum: ${checksum}\n`].join('') + sequence;
  return { bytes: utf8(text), checksum };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function scalar(value) {
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const text = String(value);
  // Quote anything a YAML reader could type differently: FORMAT.md R12 forbids a
  // plain scalar whose reading depends on the dialect, and this keeps fixtures
  // portable rather than clever.
  if (/^[-?:,\[\]{}#&*!|>'"%@`]/.test(text) || /[:#]\s/.test(text) || /\s$/.test(text) || text === '') return JSON.stringify(text);
  if (/^(true|false|null|yes|no|on|off|n|~|\d+$|\d+\.\d+)$/i.test(text)) return JSON.stringify(text);
  return text;
}

/**
 * A minimal valid FHT record for the pinned draft contract.
 *
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
export function fhtRecord(overrides = {}) {
  return {
    schema: 'https://raw.githubusercontent.com/FAIR-bioHeaders/FHT-Specification/main/fht.json',
    schemaVersion: '1.0',
    transcriptome: 'Synthetic lane fixture transcript set',
    assemblyType: 'de novo',
    moleculeType: 'mRNA',
    taxon: { name: 'Homo sapiens' },
    version: '1.0.0',
    metadataAuthor: [{ name: 'Synthetic lane fixture author' }],
    dateCreated: '2026-11-14',
    ...overrides,
  };
}

/**
 * A minimal FHGFF3 1.1 header record carrying FHGM model records.
 *
 * No file checksum is meaningful here: these objects go straight to
 * `checkFhgmModels`, which takes the parsed header and never opens a file.
 *
 * @param {object} [options]
 * @param {unknown[]} [options.models] the `x-fhgm-models` value
 * @param {Record<string, unknown>} [options.header] extra header fields
 * @param {string|null} [options.checksum]
 * @returns {Record<string, unknown>}
 */
export function fhgmHeader(options = {}) {
  const models = options.models ?? [fhgmRecord()];
  return {
    schema: 'https://w3id.org/fair-bioheaders/fhgff3/v0.6.0',
    schemaVersion: '1.1',
    annotation: 'Synthetic FHGM lane fixture',
    taxon: { name: 'Drosophila guttifera' },
    metadataAuthor: [{ name: 'Synthetic lane fixture author' }],
    dateCreated: '2026-11-14',
    version: '1',
    genomeReference: { accession: 'SYNTHETIC_ASSEMBLY.1', seqcol_id: 'J3Hvvqu0USaOuxA-3wRFyZ3YPdnSEDCp' },
    'x-fhgm-models': models,
    checksum: options.checksum === null ? undefined : (options.checksum ?? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='),
    ...(options.header ?? {}),
  };
}

/**
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
export function fhgmRecord(overrides = {}) {
  return {
    modelId: 'model-a',
    modelVersion: '1',
    featureId: 'toy-a',
    reference: { genomeReference: { accession: 'SYNTHETIC_ASSEMBLY.1', seqcol_id: 'J3Hvvqu0USaOuxA-3wRFyZ3YPdnSEDCp' } },
    ...overrides,
  };
}

/**
 * Assemble a GFF3 file: `##gff-version 3`, then the FHGFF3 header block with
 * every value on one flow-style line (the serialization the FHGM vectors use),
 * then the supplied feature rows. The root checksum line is written last in the
 * header block and digests every other byte, as R3 requires - computed with
 * `node:crypto` directly, for the reason stated at the top of this file.
 *
 * @param {Record<string, unknown>} record the header fields, checksum filled in
 * @param {object} [options]
 * @param {string[]} [options.rows] feature rows, tab-separated strings
 * @param {string} [options.tail] text after the rows, e.g. a `##FASTA` section
 * @returns {{bytes: Uint8Array, checksum: string}}
 */
export function buildFhgff3File(record, options = {}) {
  const rows = options.rows ?? [];
  const tail = options.tail ?? '';
  const body = { ...record };
  delete body.checksum;
  const lines = ['##gff-version 3\n'];
  for (const [key, value] of Object.entries(body)) lines.push(`#~${key}: ${flow(value)}\n`);
  const before = utf8(lines.join(''));
  const after = utf8(rows.map((row) => `${row}\n`).join('') + tail);
  const coveredBytes = new Uint8Array(before.length + after.length);
  coveredBytes.set(before, 0);
  coveredBytes.set(after, before.length);
  const checksum = createHash('sha512-256').update(coveredBytes).digest('base64');
  const text = lines.join('') + `#~checksum: ${checksum}\n` + rows.map((row) => `${row}\n`).join('') + tail;
  return { bytes: utf8(text), checksum };
}

/**
 * One header value on one line: strings keep the R12-portable quoting of
 * `scalar()`, objects and arrays are written as JSON flow, which is YAML.
 *
 * @param {unknown} value
 * @returns {string}
 */
function flow(value) {
  if (value === null || typeof value === 'object') return JSON.stringify(value);
  return scalar(value);
}
