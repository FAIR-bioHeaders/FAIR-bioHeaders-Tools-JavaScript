#!/usr/bin/env node
/**
 * Capture the behaviour of the DEFAULT (draft lane off) reading path.
 *
 * Rule V7 says the opt-in lane changes nothing when it is not chosen: "Without
 * that choice, V5 governs such a value and the outcome is exactly what it was
 * before V7 existed." That is a claim about bytes, so it is checked as one: this
 * script runs every vector of the vendored shared suite through the public
 * reading API with no lane option, hashes each result canonically, and writes a
 * golden file. `test/default-gate.test.mjs` recomputes it and fails on any
 * difference, so a change to default behaviour cannot ride in with a draft-lane
 * change.
 *
 * The script uses only the public API (`inspectBytes`, `stripBytes`,
 * `selectSchema`, `validateRecord`), which is what makes a file captured from an
 * earlier commit a statement about that commit's behaviour rather than about
 * this one's source.
 *
 *     node scripts/golden-default-off.mjs write            # write the golden file
 *     node scripts/golden-default-off.mjs print            # print the aggregate digest
 *
 * Exit status is 0; a missing suite is an error, not a silent empty golden.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectBytes, stripBytes } from '../src/reader.js';
import { selectSchema, validateRecord } from '../src/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUITE = join(ROOT, 'conformance');
const GOLDEN = join(ROOT, 'test', 'goldens', 'default-gate.json');

/** Formats this build reads, and the container each one lives in. */
const SUPPORTED = { fasta: 'fasta', gfa: 'gfa', 'fhp-fasta': 'fasta', fhgff3: 'gff3' };

/**
 * Canonical JSON: object keys in lexicographic order, arrays in document order,
 * `undefined` dropped. Two readings hash the same only if every field, error
 * string and warning string is the same.
 *
 * @param {unknown} value
 * @returns {string}
 */
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Object.is(value, -0) ? '0' : String(value);
  if (typeof value === 'bigint') return `${value}n`;
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

const manifest = JSON.parse(readFileSync(join(SUITE, 'manifest.json'), 'utf8'));
if (!existsSync(join(SUITE, 'valid')) || !existsSync(join(SUITE, 'invalid'))) {
  console.error(`no vector directories under ${SUITE}`);
  process.exit(1);
}

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
  const path = join(ROOT, 'examples', name);
  if (!existsSync(path)) {
    console.error(`examples/${name}: missing, the golden needs it`);
    process.exit(1);
  }
  const record = JSON.parse(readFileSync(path, 'utf8'));
  let result;
  try {
    const validated = validateRecord(record, selectSchema(record));
    result = { valid: validated.valid, errors: validated.errors, warnings: validated.warnings, schema: validated.schema };
  } catch (error) {
    result = { threw: error instanceof Error ? `${error.name}:${error.message}` : String(error) };
  }
  examples.push({ name, digest: sha(result) });
}

const document = {
  goldenVersion: 1,
  description:
    'Per-vector digest of the default reading path (no draft lane requested), computed by scripts/golden-default-off.mjs from the public API. test/default-gate.test.mjs refuses any difference: rule V7 keeps the lane from changing default behaviour, and this file is how that is proved rather than asserted.',
  aggregate: sha({ vectors, examples }),
  counts: { vectors: vectors.length, examples: examples.length },
  vectors,
  examples,
};

if (process.argv[2] === 'policy-delta') {
  const prior = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  const allowed = new Set(JSON.parse(readFileSync(join(ROOT,'reader-policy/retirement-crosswalk.json'),'utf8')).cases.map(x=>x.id));
  const old = new Map(prior.vectors.map(x=>[x.id,x.digest]));
  const changes = vectors.filter(x=>old.get(x.id)!==x.digest).map(x=>{
    if(!allowed.has(x.id)) throw new Error('Unclassified default change: '+x.id);
    return {id:x.id,before:old.get(x.id),after:x.digest,reason:'D9 R4 canonical standard nested checksum; exact shared retirement crosswalk'};
  });
  writeFileSync(join(ROOT,'test/goldens/reader-policy-delta.json'),JSON.stringify({
    predecessorCommit:'5b2fbc9', baselineAggregate:prior.aggregate,
    adoptedDecision:'https://github.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification/issues/211#issuecomment-7017854934',
    aggregate:document.aggregate,changes},null,2)+'\n');
} else if (process.argv[2] === 'write') {
  writeFileSync(GOLDEN, `${JSON.stringify(document, null, 2)}\n`);
}
console.log(`aggregate ${document.aggregate}`);
console.log(`vectors ${vectors.length}, examples ${examples.length}`);
