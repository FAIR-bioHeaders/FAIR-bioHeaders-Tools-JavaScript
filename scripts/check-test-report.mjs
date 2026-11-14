#!/usr/bin/env node
/**
 * The native acceptance guard: run the suite, then account for it.
 *
 * `npm test` says whether the tests passed. This says whether the suite is still
 * the suite, which is the part a green checkmark cannot show. It runs Node's own
 * test runner with the TAP reporter, reads the report, and fails when:
 *
 * - no test ran at all, or no test file was discovered: a harness that quietly
 *   matches nothing reports success;
 * - a vector of the pinned shared suite has no test - the manifest names it and
 *   nothing exercised it;
 * - a test was skipped for any reason other than the declared not-run set, or a
 *   declared not-run format suddenly "passes" without being declared: both directions
 *   of a silent skip;
 * - any test failed;
 * - the counts in the report and in the manifest disagree.
 *
 *     node scripts/check-test-report.mjs                 # human summary, exit 1 on any hole
 *     node scripts/check-test-report.mjs --json out.json # the same, plus a machine-readable report
 *     node scripts/check-test-report.mjs --files a.test.mjs b.test.mjs
 *
 * Everything here is JavaScript on Node's own test runner. No Python, no foreign
 * runner, no oracle other than the pinned manifest and the assertions in `test/`.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NOT_RUN_FORMATS, RUNNABLE_FORMATS, notRunReason } from '../src/serializations.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUITE = join(ROOT, 'conformance');
const TEST_DIR = join(ROOT, 'test');

const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonPath = jsonAt >= 0 ? resolve(args[jsonAt + 1] ?? 'test-report.json') : null;
const filesAt = args.indexOf('--files');
const explicitFiles = filesAt >= 0 ? args.slice(filesAt + 1).filter((arg) => !arg.startsWith('--')).map((arg) => resolve(ROOT, arg)) : null;

/**
 * Discover the test files the way `node --test` does, so "a file went missing" is
 * a detectable event rather than an invisible one.
 *
 * @returns {string[]}
 */
function discoverTestFiles() {
  if (explicitFiles !== null) return explicitFiles;
  const walk = (dir) => {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(path));
      else if (/\.(test\.)?(mjs|js)$/.test(entry.name) && entry.name.endsWith('.test.mjs')) out.push(path);
    }
    return out.sort();
  };
  return walk(TEST_DIR);
}

/**
 * Parse the TAP output of `node --test` into a flat list of leaf results.
 *
 * Node emits nested TAP, four columns deeper per level, and reports a block after
 * the lines of its children.
 *
 * @param {string} tap
 * @returns {Array<{name: string, ok: boolean, skip: string|null}>}
 */
function parseTap(tap) {
  /** @type {Array<{indent: number, name: string, ok: boolean, skip: string|null}>} */
  const results = [];
  for (const line of tap.split('\n')) {
    const match = /^( *)(ok|not ok) \d+ - (.*)$/.exec(line);
    if (match === null) continue;
    const rest = match[3];
    const skip = /# SKIP(?: (.*))?$/.exec(rest);
    results.push({
      indent: match[1].length,
      name: (skip === null ? rest : rest.slice(0, skip.index)).trim(),
      ok: match[2] === 'ok',
      skip: skip === null ? null : (skip[1] ?? 'skipped'),
    });
  }
  // TAP emits a block's children before the line that reports the block, so a
  // result is a container - a suite, or a test file - exactly when the result
  // above it sits deeper. Only leaves count: a suite line is the sum of its
  // children, and counting both would let a disappearing child hide inside a
  // still-green parent. A line naming a test file is dropped as well, so an empty
  // file cannot appear in the totals as a passing test.
  const deeperAbove = results.map((result, index) => index > 0 && results[index - 1].indent > result.indent);
  return results.filter((result, index) => !deeperAbove[index] && !/\.test\.(mjs|cjs|js)$/.test(result.name));
}

/**
 * @param {string} name
 * @returns {string|null} the vector id a test belongs to, when it does
 */
function vectorIdOf(name) {
  const match = /^([a-z0-9][a-z0-9.-]*) \((?:fasta|gfa|fhp-fasta|fhgff3|jsonld|microdata)(?:, expected (?:valid|invalid))?\)/.exec(name);
  return match === null ? null : match[1];
}

const testFiles = discoverTestFiles();
const manifest = JSON.parse(readFileSync(join(SUITE, 'manifest.json'), 'utf8'));

if (testFiles.length === 0) {
  console.error(`no test files found under ${relative(ROOT, TEST_DIR)}: the suite is empty, which is a failure and not a pass`);
  process.exit(1);
}

console.log(`node ${process.execPath}`);
console.log(`test files discovered: ${testFiles.length} (${testFiles.map((path) => relative(ROOT, path)).join(', ')})`);

const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...testFiles], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const tap = `${run.stdout ?? ''}${run.stderr ?? ''}`;
if (run.error !== undefined && run.error !== null) {
  console.error(`the native test runner could not start: ${run.error.message}`);
  process.exit(1);
}

const leaves = parseTap(tap);
const problems = [];

if (leaves.length === 0) {
  problems.push(`the runner reported ${testFiles.length} file(s) and no leaf test at all: nothing was executed`);
}

const failed = leaves.filter((leaf) => !leaf.ok && leaf.skip === null);
if (failed.length > 0) problems.push(`${failed.length} test(s) failed: ${failed.slice(0, 12).map((leaf) => leaf.name).join('; ')}${failed.length > 12 ? ', …' : ''}`);

// Every vector of the pinned suite must be accounted for exactly once.
const seen = new Map();
for (const leaf of leaves) {
  const id = vectorIdOf(leaf.name);
  if (id === null) continue;
  seen.set(id, [...(seen.get(id) ?? []), leaf]);
}
const byFormat = new Map();
for (const vector of manifest.vectors) byFormat.set(vector.format, (byFormat.get(vector.format) ?? 0) + 1);
const formatCounts = [...byFormat.entries()].map(([format, count]) => `${format} ${count}`).join(', ');

const missing = [];
const duplicated = [];
const MAX_LISTED = 12;
const wrongSkip = [];
const unexpectedlyRun = [];
const declaredSkips = new Set();
for (const vector of manifest.vectors) {
  const rows = seen.get(vector.id) ?? [];
  if (rows.length === 0) {
    missing.push(`${vector.id} (${vector.format}): the pinned manifest names it and no test exercised it`);
    continue;
  }
  if (rows.length > 1) duplicated.push(`${vector.id}: ${rows.length} tests claim this vector`);
  const declared = notRunReason(vector) !== null;
  for (const row of rows) {
    if (declared && row.skip === null) unexpectedlyRun.push(`${vector.id}: reported not-run, but ran without a declared skip (${row.name})`);
    if (!declared && row.skip !== null) wrongSkip.push(`${vector.id} (${vector.format}): skipped with ${JSON.stringify(row.skip)}, and it is not a declared not-run format`);
    if (declared) {
      const reason = notRunReason(vector);
      if (row.skip !== null && !reason.includes(row.skip.slice(0, 40))) {
        wrongSkip.push(`${vector.id}: skipped with a reason that is not the declared one: ${JSON.stringify(row.skip.slice(0, 80))}`);
      }
      declaredSkips.add(vector.id);
    }
  }
}
problems.push(...missing, ...duplicated, ...wrongSkip, ...unexpectedlyRun);

const expectedSkips = manifest.vectors.filter((vector) => notRunReason(vector) !== null).length;
const actualSkips = leaves.filter((leaf) => leaf.skip !== null).length;
if (actualSkips !== expectedSkips) {
  problems.push(`the report holds ${actualSkips} skipped test(s); the declared not-run set holds ${expectedSkips} (${NOT_RUN_FORMATS.join(', ')}; per-format vectors: ${formatCounts})`);
}
if (declaredSkips.size !== expectedSkips) {
  problems.push(`${expectedSkips - declaredSkips.size} declared not-run vector(s) produced no skip line at all`);
}

const report = {
  generatedBy: 'scripts/check-test-report.mjs',
  node: process.version,
  testFiles: testFiles.map((path) => relative(ROOT, path)),
  exitCode: run.status,
  counts: {
    leafTests: leaves.length,
    passed: leaves.filter((leaf) => leaf.ok && leaf.skip === null).length,
    failed: failed.length,
    skipped: actualSkips,
    manifestVectors: manifest.vectors.length,
    runnableFormats: RUNNABLE_FORMATS,
    notRunFormats: NOT_RUN_FORMATS,
    expectedSkips,
  },
  problems,
};

const listed = problems.slice(0, MAX_LISTED);
for (const line of listed) console.error(`hole: ${line}`);
if (problems.length > listed.length) console.error(`hole: … ${problems.length - listed.length} more (the first ${MAX_LISTED} of ${problems.length} are shown)`);
console.log(
  `leaf tests ${report.counts.leafTests}, passed ${report.counts.passed}, failed ${report.counts.failed}, skipped ${report.counts.skipped} (declared not-run ${report.counts.expectedSkips}); `
  + `vectors accounted ${seen.size} of ${manifest.vectors.length}`,
);

if (jsonPath !== null) {
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`report written: ${relative(ROOT, jsonPath)}`);
}

if (problems.length > 0) {
  console.error(`native acceptance: FAIL (${problems.length} problem(s))`);
  process.exitCode = 1;
} else {
  console.log(`native acceptance: OK (${report.counts.leafTests} leaf tests, ${report.counts.manifestVectors} vectors accounted for, ${report.counts.skipped} declared not-run, 0 unexplained skips)`);
}
