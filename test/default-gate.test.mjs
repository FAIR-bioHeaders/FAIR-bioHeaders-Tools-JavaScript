/**
 * The default gate: what this library does when no draft lane is requested.
 *
 * Rule V7 says the lane "is never the default", and that without the caller's
 * choice the outcome "is exactly what it was before V7 existed". That is a claim
 * about behaviour on bytes, so it is tested as one: every vector of the vendored
 * shared suite is run through the public reading API with no `drafts` option, and
 * each per-vector digest is compared against `test/goldens/default-gate.json` -
 * a file captured from the tree before the lane existed, from the same script
 * that runs here.
 *
 * The golden is a change detector, not an oracle. It says nothing about whether
 * the recorded behaviour is *correct*; correctness belongs to the shared vectors
 * and their manifest expectations (`conformance.test.mjs`). What this file
 * guarantees is narrower and more useful: a draft-lane change cannot quietly
 * move a default reading.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { inspectBytes, stripBytes } from '../src/reader.js';
import { selectSchema, validateRecord } from '../src/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUITE = join(ROOT, 'conformance');
const GOLDEN = join(ROOT, 'test', 'goldens', 'default-gate.json');

const SUPPORTED = { fasta: 'fasta', gfa: 'gfa', 'fhp-fasta': 'fasta', fhgff3: 'gff3' };

/**
 * Canonical JSON: keys in lexicographic order, arrays in document order.
 *
 * @param {unknown} value
 * @returns {string}
 */
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Object.is(value, -0) ? '0' : String(value);
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`);
  return `{${entries.join(',')}}`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function sha(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

/**
 * Recompute the golden document from the current tree.
 *
 * @returns {{aggregate: string, vectors: Array<{id: string, digest: string}>, examples: Array<{name: string, digest: string}>}}
 */
function recompute() {
  const manifest = JSON.parse(readFileSync(join(SUITE, 'manifest.json'), 'utf8'));
  const vectors = [];
  for (const vector of manifest.vectors) {
    if (!(vector.format in SUPPORTED)) {
      vectors.push({ id: vector.id, format: vector.format, digest: sha({ notRun: vector.format }) });
      continue;
    }
    const container = SUPPORTED[vector.format];
    const raw = new Uint8Array(readFileSync(join(SUITE, vector.file)));
    const reading = inspectBytes(raw, { container });
    let strip;
    try {
      strip = createHash('sha256').update(stripBytes(raw, { container })).digest('hex');
    } catch (error) {
      strip = `threw:${error instanceof Error ? error.message : String(error)}`;
    }
    vectors.push({
      id: vector.id,
      format: vector.format,
      digest: sha({
        valid: reading.valid,
        container: reading.container,
        metadata: reading.metadata,
        checksum: reading.checksum,
        schema: reading.schema,
        errors: reading.errors,
        warnings: reading.warnings,
        strip,
      }),
    });
  }
  const examples = [];
  for (const name of ['minimal.fhr.json', 'minimal-predicted.fhp.json', 'minimal-reference.fhgff3.json']) {
    const record = JSON.parse(readFileSync(join(ROOT, 'examples', name), 'utf8'));
    let result;
    try {
      const validated = validateRecord(record, selectSchema(record));
      result = { valid: validated.valid, errors: validated.errors, warnings: validated.warnings, schema: validated.schema };
    } catch (error) {
      result = { threw: error instanceof Error ? `${error.name}:${error.message}` : String(error) };
    }
    examples.push({ name, digest: sha(result) });
  }
  return { aggregate: sha({ vectors, examples }), vectors, examples };
}

describe('default gate (rule V7: no lane requested)', () => {
  const golden = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : null;

  it('has a golden captured from the pre-lane tree', () => {
    assert.ok(golden !== null, 'test/goldens/default-gate.json is missing; regenerate it from the pre-lane tree with scripts/golden-default-off.mjs write');
    assert.equal(golden.goldenVersion, 1);
    assert.ok(golden.description.includes('no draft lane requested'), 'the golden states what it captures');
  });

  it('covers every vector of the pinned shared suite', () => {
    const manifest = JSON.parse(readFileSync(join(SUITE, 'manifest.json'), 'utf8'));
    assert.equal(manifest.vectors.length, 291, 'the shared suite this golden was pinned at holds 291 vectors');
    assert.equal(golden.vectors.length, manifest.vectors.length, 'the golden holds one row per vector');
    assert.equal(golden.counts.vectors, 291);
  });

  it('reads every vector exactly as the pre-lane tree did', () => {
    const now = recompute();
    const byId = new Map(golden.vectors.map((row) => [row.id, row.digest]));
    const differences = [];
    for (const row of now.vectors) {
      if (!byId.has(row.id)) differences.push(`${row.id}: present now, named by no golden row`);
      else if (byId.get(row.id) !== row.digest) differences.push(`${row.id}: default reading changed (golden ${byId.get(row.id).slice(0, 12)}..., now ${row.digest.slice(0, 12)}...)`);
    }
    for (const row of golden.vectors) {
      if (!now.vectors.some((entry) => entry.id === row.id)) differences.push(`${row.id}: named by the golden, produced by no run`);
    }
    assert.deepEqual(differences, [], 'with no drafts option, every vector must read byte-for-byte as it did before the lane existed');
    assert.equal(now.aggregate, golden.aggregate, 'the aggregate digest must match the captured golden');
  });

  it('reads every bundled example exactly as the pre-lane tree did', () => {
    const now = recompute();
    const differences = now.examples
      .map((row, index) => {
        const want = golden.examples[index];
        if (want === undefined || want.name !== row.name) return `${row.name}: no matching golden row`;
        return want.digest === row.digest ? null : `${row.name}: default validation changed`;
      })
      .filter((line) => line !== null);
    assert.deepEqual(differences, []);
  });

  it('reports no draft in a default reading: no V7 rule, no draft warning, no fhgm block', () => {
    const citation = JSON.parse(readFileSync(join(ROOT, 'drafts', 'provenance.json'), 'utf8')).drafts.FHT.citation;
    const reading = inspectBytes(new TextEncoder().encode(`;~schema: ${citation}\n;~checksum: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n>x\nACGT\n`), {
      container: 'fasta',
    });
    assert.notEqual(reading.schema.rule, 'V7', 'the lane must not be reachable without an explicit choice');
    assert.equal(reading.schema.type, 'FHR', 'a draft citation is "any other value" under V5');
    assert.equal(reading.fhgm, undefined, 'no FHGM verdict is computed with the lane shut');
    assert.ok(!reading.warnings.some((line) => line.includes('unreleased draft')), 'no draft warning travels without a draft reading');
    assert.equal(reading.valid, false, 'the record is read as FHR and rejected as FHR, which is exactly what V5 means');
  });
});
