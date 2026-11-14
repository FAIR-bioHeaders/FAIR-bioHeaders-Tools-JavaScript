#!/usr/bin/env node
/**
 * Run the shared FAIR-bioHeaders conformance vectors against this library.
 *
 * The vectors are FAIR-bioHeaders-Specification's own `conformance/` suite: the
 * acceptance test for any language implementation, reader-neutral by design. No
 * JavaScript-specific suite is defined or needed (FAIR-bioHeaders-Specification
 * issue #52: "Test generated behavior against named shared conformance vectors
 * and record unsupported features rather than silently passing them").
 *
 * Usage:
 *
 *     node scripts/run-conformance.mjs                 # uses ./conformance
 *     node scripts/run-conformance.mjs --suite /path/to/FAIR-bioHeaders-Specification
 *     node scripts/run-conformance.mjs --format fasta --id fasta-lf
 *
 * A format this build does not implement is reported as `not-run` with the
 * reason, never as a pass. `microdata` and `jsonld` are in that class today:
 * the header binding for HTML microdata and the canonical JSON-LD form are
 * separate reader paths (docs/MICRODATA.md, docs/JSONLD.md), and three JSON-LD
 * vectors additionally need a JSON-LD processor.
 *
 * Exit status is 1 when any runnable vector fails.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectBytes, stripBytes } from '../src/reader.js';
import { containerFor, notRunReason } from '../src/serializations.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

// One declaration of what is scored and what is declared not-run, shared with
// `npm test`, the capability matrix and the acceptance guard (src/serializations.js).

function parseArgs(argv) {
  const out = { suite: null, formats: null, ids: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--suite') out.suite = argv[(i += 1)];
    else if (arg === '--format') out.formats = (out.formats ?? []).concat(argv[(i += 1)].split(','));
    else if (arg === '--id') out.ids = (out.ids ?? []).concat(argv[(i += 1)].split(','));
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/run-conformance.mjs [--suite DIR] [--format f[,f...]] [--id id[,id...]]');
      process.exit(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return out;
}

/**
 * @param {string} suite the `conformance` directory
 * @returns {{manifest: object, dir: string}}
 */
function loadSuite(dir) {
  const candidates = [dir, join(dir, 'conformance')].map((path) => resolve(path));
  const found = candidates.find((path) => existsSync(join(path, 'manifest.json')));
  if (found === undefined) {
    console.error(`no conformance/manifest.json under ${candidates.join(' or ')}\n` +
      'clone the shared specification: git clone --branch v0.6.0 --depth 1 ' +
      'https://github.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification');
    process.exit(2);
  }
  return { manifest: JSON.parse(readFileSync(join(found, 'manifest.json'), 'utf8')), dir: found };
}

/**
 * Compare a manifest expectation with a parsed value.
 *
 * "JSON numbers compare by value, so 1 and 1.0 are equal, but strings, numbers
 * and booleans are never equal to each other" (conformance README).
 *
 * @param {unknown} expected
 * @param {unknown} actual
 * @returns {boolean}
 */
function sameValue(expected, actual) {
  if (expected === null) return actual === null;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((item, index) => sameValue(item, actual[index]));
  }
  if (typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false;
    const a = /** @type {Record<string, unknown>} */ (actual);
    const e = /** @type {Record<string, unknown>} */ (expected);
    return Object.keys(e).every((key) => key in a && sameValue(e[key], a[key]));
  }
  return expected === actual;
}

const args = parseArgs(process.argv.slice(2));
const { manifest, dir } = loadSuite(args.suite ?? join(REPO, 'conformance'));
const vectors = manifest.vectors.filter(
  (v) => (args.formats === null || args.formats.includes(v.format)) && (args.ids === null || args.ids.includes(v.id)),
);

/** @type {Map<string, {pass: number, fail: number, notRun: number}>} */
const byFormat = new Map();
/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const notRun = [];

for (const vector of vectors) {
  const counts = byFormat.get(vector.format) ?? { pass: 0, fail: 0, notRun: 0 };
  byFormat.set(vector.format, counts);

  const declared = notRunReason(vector);
  if (declared !== null) {
    counts.notRun += 1;
    notRun.push(`${vector.id} (${vector.format}): ${declared}`);
    continue;
  }

  let outcome;
  try {
    const raw = new Uint8Array(readFileSync(join(dir, vector.file)));
    const container = containerFor(vector.format);
    outcome = inspectBytes(raw, { container });
    if (vector.expected === 'valid') {
      // The strip round trip must return a byte-exact copy of the payload, so a
      // valid vector also exercises strip's byte handling.
      const stripped = stripBytes(raw, { container });
      if (stripped.length >= raw.length && raw.length > 0) {
        outcome.errors.push('strip did not remove any bytes');
        outcome.valid = false;
      }
    }
  } catch (error) {
    outcome = { valid: false, errors: [`threw: ${error && error.message ? error.message : String(error)}`], warnings: [], metadata: {}, checksum: {} };
  }

  const problems = [];
  if (vector.expected === 'valid') {
    if (!outcome.valid) problems.push(`expected valid, got: ${outcome.errors.join('; ')}`);
    if (typeof vector.checksum === 'string' && outcome.checksum.computed !== vector.checksum) {
      problems.push(`expected checksum ${vector.checksum}, computed ${outcome.checksum.computed}`);
    }
    for (const [key, want] of Object.entries(vector.metadata ?? {})) {
      const got = outcome.metadata?.[key];
      if (!sameValue(want, got)) problems.push(`metadata.${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    }
    for (const rule of vector.warnings ?? []) {
      if (!outcome.warnings.some((line) => line.includes(rule))) problems.push(`expected a warning naming ${rule}`);
    }
  } else {
    if (outcome.valid) problems.push(`expected invalid (${vector.rule}: ${vector.reason}), got valid`);
    if (vector.result === 'unsupported-version') {
      const named = `${outcome.errors.join(' ')} ${outcome.warnings.join(' ')}`;
      if (!named.includes('unsupported schema version')) {
        problems.push(`V4 requires the reader to report unsupported-version, got: ${outcome.errors.join('; ')}`);
      }
    }
  }

  if (problems.length === 0) counts.pass += 1;
  else {
    counts.fail += 1;
    failures.push(`${vector.id} [${vector.format}] ${vector.expected}\n    ${problems.join('\n    ')}`);
  }
}

console.log(`suite: ${dir}`);
console.log(`manifest vectors: ${manifest.vectors.length}; selected: ${vectors.length}\n`);
console.log('format      total  pass  fail  not-run');
let totals = { pass: 0, fail: 0, notRun: 0 };
for (const [format, counts] of [...byFormat.entries()].sort()) {
  const total = counts.pass + counts.fail + counts.notRun;
  totals = {
    pass: totals.pass + counts.pass,
    fail: totals.fail + counts.fail,
    notRun: totals.notRun + counts.notRun,
  };
  console.log(
    `${format.padEnd(11)} ${String(total).padStart(5)}  ${String(counts.pass).padStart(4)}  ${String(counts.fail).padStart(4)}  ${String(counts.notRun).padStart(7)}`,
  );
}
console.log(`${'TOTAL'.padEnd(11)} ${String(totals.pass + totals.fail + totals.notRun).padStart(5)}  ${String(totals.pass).padStart(4)}  ${String(totals.fail).padStart(4)}  ${String(totals.notRun).padStart(7)}`);

if (failures.length > 0) {
  console.log(`\nfailures (${failures.length}):`);
  for (const line of failures) console.log(`  ${line}`);
}
if (notRun.length > 0 && args.ids === null) {
  console.log(`\nnot run (${notRun.length}); first few:`);
  for (const line of notRun.slice(0, 4)) console.log(`  ${line}`);
  console.log('  …see docs/CONFORMANCE.md for the full list and reason per vector');
}
process.exitCode = failures.length > 0 ? 1 : 0;
