#!/usr/bin/env node
/**
 * Draft-lane evidence: run the development suites of the two draft types through
 * this library's rule-V7 lane, natively, and report what each vector says.
 *
 * This is **not** acceptance, and it never will be. Acceptance is
 * FAIR-bioHeaders-Specification's shared suite - the 291 vectors vendored in
 * `conformance/`, reported by `npm run conformance` - and FHT and FHGM have no
 * part in it because no release registers them. V7 keeps a draft record in its
 * own development repository, so nothing here is vendored either: this script
 * reads a checkout the caller points at and labels every line as draft.
 *
 * What it measures is whether the lane behaves: does the pinned draft get read,
 * does every record read that way carry the V7 warning, does a release-shaped URL
 * for an unregistered type stay V5, does a checked-fail parent link drive a
 * rejection while an unsupplied one does not, and do the FHGM model rules report
 * beside the FHGFF3 result instead of inside it.
 *
 * Before it scores anything it verifies the **suite** pin (`drafts/provenance.json`'s
 * `suiteCommit` / `suiteManifest` / `suiteManifestSha256`, checked by
 * `scripts/ci/suite-pin.mjs`). A suite whose manifest does not digest to the recorded
 * value is refused, not scored: an evidence table naming a revision nobody checked is
 * how a draft claim goes quietly stale. A draft whose registry row states no suite pin
 * is run and reported as `UNPINNED`, with the revision named as unknown, never as
 * verified.
 *
 *     node scripts/capability/draft-vectors.mjs \
 *       --fht  /path/to/FHT-Specification \
 *       --fhgm /path/to/FHGM-Specification
 *
 * Exit status:
 *   0  every runnable draft vector agreed with this build's lane;
 *   1  at least one agreed to disagree - the lane is wrong somewhere;
 *   2  a given argument is unusable, or a supplied suite is not the suite this build
 *      pins (its manifest digest differs from `suiteManifestSha256`);
 *   3  no suite given, or a given path holds no suite. Nothing is reported as
 *      passed, because nothing ran.
 *
 * A vector whose verdict depends on FHGM K4 is scored when this build can reach
 * a K4 verdict for it - the lane resolves the `featureId` against the file's own
 * feature rows by default. It stays not-run, with the state that produced the
 * gap as the reason, when K4 comes back `not-checked` or `unchecked`: a layer
 * that was absent or untrustworthy is never scored as a pass and never scored as
 * a rejection either.
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { computeChecksum, digest } from '../../src/checksum.js';
import { HeaderError } from '../../src/errors.js';
import { draftEntry } from '../../src/drafts.js';
import { verifySuitePin } from '../ci/suite-pin.mjs';
import { decompress, inspectBytes } from '../../src/reader.js';
import { selectSchema } from '../../src/selection.js';
import { validateRecord } from '../../src/validate.js';
import { VERDICTS } from '../../src/parent-links.js';

/** Rules whose verdicts this build can still be unable to reach, per type. */
const NOT_RUN_RULES = {
  FHGM: {
    K4: 'K4 resolves a featureId against the GFF3 feature layer; the layer this reading reached was absent or untrustworthy, so no expectation that depends on K4 is scored',
  },
};

/**
 * Compare a manifest expectation with a parsed value: numbers compare by value,
 * and a string is never equal to a number (shared conformance README).
 *
 * @param {unknown} expected
 * @param {unknown} actual
 * @returns {boolean}
 */
function sameValue(expected, actual) {
  if (expected === null) return actual === null;
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((item, index) => sameValue(item, actual[index]));
  }
  if (typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false;
    const a = /** @type {Record<string, unknown>} */ (actual);
    const e = /** @type {Record<string, unknown>} */ (expected);
    return Object.keys(e).every((key) => key in a && sameValue(e[key], a[key]));
  }
  return expected === actual;
}

function parseArgs(argv) {
  /** @type {{fht: string|null, fhgm: string|null}} */
  const out = { fht: null, fhgm: null, verbose: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--fht') out.fht = resolve(argv[(i += 1)] ?? '');
    else if (arg === '--fhgm') out.fhgm = resolve(argv[(i += 1)] ?? '');
    else if (arg === '--verbose' || arg === '-v') out.verbose = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/capability/draft-vectors.mjs [--fht DIR] [--fhgm DIR] [--verbose]');
      process.exit(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return out;
}

/**
 * Resolve a suite-relative path inside the reach a suite is allowed.
 *
 * @param {string} from where the manifest's paths resolve from
 * @param {string} guard the directory no resolved path may leave
 * @param {string} path a path as the manifest states it
 * @returns {string|null} the absolute path, or null when it escapes `guard`
 */
function resolveWithin(from, guard, path) {
  if (typeof path !== 'string' || path === '' || isAbsolute(path)) return null;
  const target = resolve(from, path);
  const rel = relative(guard, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return target;
}

/**
 * Where a suite's paths resolve from, and how far they may reach.
 *
 * The FHT suite resolves inside `conformance/` and its C3 rule says so outright:
 * a parentLink path that escapes the suite is rejected without being read. The
 * FHGM suite resolves from `development/conformance/` and its own manifest names
 * bytes one level up, under `development/examples/`, so its reach is the
 * `development/` directory - no further.
 */
function layoutFor(type, repoPath) {
  if (type === 'FHT') {
    const suite = join(repoPath, 'conformance');
    return { type, suite, manifest: join(suite, 'manifest.json'), base: suite, guard: suite };
  }
  const suite = join(repoPath, 'development', 'conformance');
  return { type, suite, manifest: join(suite, 'manifest.json'), base: suite, guard: join(repoPath, 'development') };
}

/**
 * @param {string} path
 * @returns {Uint8Array}
 */
function bytesOf(path) {
  return new Uint8Array(readFileSync(path));
}

/**
 * The state of a file's own root checksum line, as the FHT suite's `selfChecksum`
 * field defines it: `matches`, `broken`, or `unreachable` when the line cannot be
 * located or compared at all.
 *
 * A file rejected by R6 or R7 never reaches the line, so its covered bytes are
 * taken directly: the line is locatable and comparable even where another rule
 * has already doomed the file, and the suite records that distinction on purpose
 * (the anti-accident rule: passing a vector by failing the comparison is not
 * evidence).
 *
 * @param {Uint8Array} raw file bytes, compressed or not
 * @param {'fasta'|'gfa'|'gff3'} container
 * @returns {'matches'|'broken'|'unreachable'}
 */
function selfChecksumState(raw, container) {
  let data;
  try {
    data = decompress(raw);
  } catch {
    return 'unreachable';
  }
  try {
    const { stated, computed } = computeChecksum(data, container);
    return stated === computed ? 'matches' : 'broken';
  } catch (error) {
    if (!(error instanceof HeaderError)) throw error;
    if (error.rule !== 'R6' && error.rule !== 'R7') return 'unreachable';
  }
  const lines = [];
  let start = 0;
  while (start < data.length) {
    let end = start;
    while (end < data.length && data[end] !== 0x0a && data[end] !== 0x0d) end += 1;
    if (end < data.length) end += data[end] === 0x0d && data[end + 1] === 0x0a ? 2 : 1;
    lines.push({ start, end });
    start = end;
  }
  const prefix = container === 'fasta' ? ';~' : '#~';
  const decode = new TextDecoder('utf-8', { fatal: false });
  const content = lines
    .map(({ start: from, end: to }) => decode.decode(data.subarray(from, to)))
    .filter((line) => line.startsWith(prefix) && line.slice(prefix.length).trim() !== '' && !/^[ \t]*(#|%)/.test(line.slice(prefix.length)));
  if (content.length === 0) return 'unreachable';
  const indent = (line) => /^[ \t]*/.exec(line)[0].length;
  const root = Math.min(...content.map((line) => indent(line.slice(prefix.length))));
  const candidates = lines.filter(({ start: from, end: to }) => {
    const line = decode.decode(data.subarray(from, to));
    if (!line.startsWith(prefix)) return false;
    const body = line.slice(prefix.length);
    return indent(body) === root && /^[ \t]*checksum[ \t]*:/.test(body);
  });
  if (candidates.length !== 1) return 'unreachable';
  const [candidate] = candidates;
  const body = decode.decode(data.subarray(candidate.start + prefix.length, candidate.end)).replace(/[\r\n]+$/, '');
  const value = /^[ \t]*checksum[ \t]*:[ \t]*(.+?)[ \t]*$/.exec(body)?.[1] ?? '';
  const quoted = value.length > 1 && ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"')));
  if (!/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/.test(quoted ? value.slice(1, -1) : value)) return 'unreachable';
  const covered = new Uint8Array(data.length - (candidate.end - candidate.start));
  let at = 0;
  for (const { start: from, end: to } of lines) {
    if (from === candidate.start) continue;
    covered.set(data.subarray(from, to), at);
    at += to - from;
  }
  return digest(covered) === (quoted ? value.slice(1, -1) : value) ? 'matches' : 'broken';
}

/**
 * One FHT draft vector through the lane.
 *
 * @param {object} vector
 * @param {{type: string, suite: string, manifest: string, base: string, guard: string}} layout the suite's paths and reach
 * @returns {{id: string, outcome: string, problems: string[], note: string}}
 */
function runFhtVector(vector, layout) {
  const { base: from, guard } = layout;
  const path = resolveWithin(from, guard, vector.file);
  if (path === null || !existsSync(path)) return { id: vector.id, outcome: 'not-run', problems: [], note: `unreadable path ${vector.file}` };
  const raw = bytesOf(path);
  const rows = Array.isArray(vector.parentLink) ? vector.parentLink : [];
  const reading = inspectBytes(raw, {
    container: 'fasta',
    drafts: ['FHT'],
    parents: rows.length === 0 ? undefined : (link, index) => {
      const named = rows[index];
      if (named === undefined || typeof named.file !== 'string') return null;
      const parentPath = resolveWithin(from, guard, named.file);
      if (parentPath === null || !existsSync(parentPath)) return null; // unchecked: no parent supplied
      return { bytes: bytesOf(parentPath) };
    },
  });

  const problems = [];
  const reachedContract = reading.schema.rule !== '';
  const draftWarned = reading.warnings.some((line) => line.includes('is an unreleased draft'));

  if (reachedContract) {
    if (reading.schema.rule === 'V7') {
      if (!draftWarned) problems.push('a record read through the lane must carry the V7 draft warning, and this one does not');
      if (reading.schema.release !== null) problems.push(`a draft reading names no release, got ${JSON.stringify(reading.schema.release)}`);
      if (reading.schema.schemaVersion !== null) problems.push(`a draft reading states no schemaVersion, got ${JSON.stringify(reading.schema.schemaVersion)}`);
    } else {
      // C2 and V7 agree here: a citation that is not the pinned raw-main URL
      // never selects FHT, so the draft warning must be absent, not merely unused.
      if (draftWarned) problems.push(`the reading selected ${reading.schema.rule}, yet the draft warning is present: the lane reached a record it should not have`);
    }
  }

  if (vector.expected === 'valid') {
    if (!reading.valid) problems.push(`expected valid, got: ${reading.errors.join('; ')}`);
  } else if (reading.valid) {
    problems.push(`expected invalid (${vector.rule ?? (vector.rules ?? []).join('+')}), got valid`);
  }
  if (typeof vector.checksum === 'string' && reading.checksum.computed !== '' && reading.checksum.computed !== vector.checksum) {
    problems.push(`expected checksum ${vector.checksum}, computed ${reading.checksum.computed}`);
  }
  for (const [key, want] of Object.entries(vector.metadata ?? {})) {
    const got = reading.metadata?.[key];
    if (!sameValue(want, got)) problems.push(`metadata.${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  for (const rule of vector.warnings ?? []) {
    if (!reading.warnings.some((line) => line.includes(rule))) problems.push(`expected a warning naming ${rule}`);
  }
  if (vector.selfChecksum !== undefined) {
    const got = selfChecksumState(raw, 'fasta');
    if (got !== vector.selfChecksum) problems.push(`selfChecksum: expected ${vector.selfChecksum}, got ${got}`);
  }
  rows.forEach((want, index) => {
    const got = reading.parentLinks?.links[index];
    if (got === undefined) {
      problems.push(`parentLink[${index}]: the record states no derivedFrom entry to judge`);
      return;
    }
    if (got.verdict !== want.result) problems.push(`parentLink[${index}]: expected ${want.result}, got ${got.verdict} (${got.detail ?? 'no detail'})`);
  });
  if (rows.some((want) => want.result === VERDICTS.checkedFail) && reading.parentLinks?.valid !== false) {
    problems.push('a checked-fail link must drive the rejection');
  }
  if (rows.length > 0 && rows.every((want) => want.result === VERDICTS.unchecked) && reading.valid === false) {
    problems.push(`an unchecked link must not reject the record: ${reading.errors.join('; ')}`);
  }
  return { id: vector.id, outcome: problems.length === 0 ? 'pass' : 'fail', problems, note: reachedContract ? reading.schema.rule : 'rejected before selection' };
}

/**
 * One FHGM draft vector. The file is routed as FHGFF3 under V1 to V3; the lane
 * judges the nested records and reports beside that result (rule B1).
 *
 * @param {object} vector
 * @param {{type: string, suite: string, manifest: string, base: string, guard: string}} layout the suite's paths and reach
 * @returns {{id: string, outcome: string, problems: string[], note: string}}
 */
function runFhgmVector(vector, layout) {
  const { base: from, guard } = layout;
  const cited = [vector.rule ?? null, ...(vector.rules ?? [])].filter((rule) => typeof rule === 'string');
  const dependsOnK4 = cited.includes('K4') || (vector.layers?.model === 'reject' && typeof vector.reason === 'string' && vector.reason.includes('gene row'));
  const path = resolveWithin(from, guard, vector.file);
  if (path === null || !existsSync(path)) return { id: vector.id, outcome: 'not-run', problems: [], note: `unreadable path ${vector.file}` };
  const raw = bytesOf(path);

  const predecessors = [];
  for (const prior of vector.context?.predecessors ?? []) {
    const priorPath = resolveWithin(from, guard, prior);
    if (priorPath === null || !existsSync(priorPath)) continue; // not supplied: K6 leaves the claim unresolvable
    const priorReading = inspectBytes(bytesOf(priorPath), { container: 'gff3' });
    if (typeof priorReading.metadata?.checksum === 'string') predecessors.push({ checksum: priorReading.metadata.checksum, header: priorReading.metadata });
  }

  const base = inspectBytes(raw, { container: 'gff3', drafts: ['FHGM'], fhgm: { predecessors } });
  const fhgm = base.fhgm;
  // layers.base is the released FHGFF3 *schema* over the parsed header, checked
  // apart from the checksum: a tampered file has an acceptable header and a stale
  // digest, and conflating the two would let a checksum defect masquerade as a
  // schema one.
  const contract = validateRecord(base.metadata, selectSchema(base.metadata));
  if (fhgm === undefined) return { id: vector.id, outcome: 'fail', problems: ['the FHGM lane did not report on an FHGFF3 file'], note: 'missing result' };
  // The honesty gate: a vector whose expectation needs K4 is only scored when K4
  // reached a verdict against rows this reading actually got. `not-checked` and
  // `unchecked` mean the feature layer was absent or untrustworthy, and an
  // unscoreable expectation stays not-run with that state as the reason.
  if (dependsOnK4 && fhgm.rules.K4 !== 'pass' && fhgm.rules.K4 !== 'reject') {
    return { id: vector.id, outcome: 'not-run', problems: [], note: `K4 ${fhgm.rules.K4}: ${NOT_RUN_RULES.FHGM.K4}` };
  }

  const problems = [];
  const layers = vector.layers ?? {};
  if (layers.checksum === 'verify' && !base.checksum.matches) problems.push(`layers.checksum says verify, the recomputation disagrees: ${base.errors.join('; ')}`);
  if (layers.checksum === 'stale' && base.checksum.matches) problems.push('layers.checksum says stale, the recomputation agrees');
  if (layers.base === 'accept' && !contract.valid) problems.push(`layers.base says accept, the released FHGFF3 contract rejects the header: ${contract.errors.join('; ')}`);
  if (layers.base === 'reject' && contract.valid) problems.push('layers.base says reject, the released FHGFF3 contract accepted the header');
  if (layers.model === 'pass' && !(fhgm.valid || fhgm.status === 'absent')) problems.push(`layers.model says pass, the draft checker rejected: ${fhgm.errors.join('; ')}`);
  if (layers.model === 'reject') {
    if (fhgm.valid && base.valid) problems.push(`layers.model says reject (${vector.reason ?? ''}), nothing rejected this file`);
    else if (typeof vector.rule === 'string') {
      // The recorded `reason` is the upstream checker's own message text, not a
      // norm this library is asked to reproduce; the comparable claim is the rule
      // id, so the finding must name the same rule.
      const text = `${base.errors.join('\n')}\n${contract.errors.join('\n')}\n${fhgm.errors.join('\n')}`;
      const attributed = text.includes(vector.rule) || (vector.rule === 'B1' && (fhgm.status === 'not-checked' || !base.checksum.matches || !contract.valid));
      if (!attributed) problems.push(`rejected, but no finding attributes the rejection to ${vector.rule}: ${text.replace(/\n/g, ' | ').slice(0, 240)}`);
    }
  }
  // The lane's own discipline, independent of any single vector: a draft verdict
  // never changes the released FHGFF3 result, and never travels without its warning.
  if (base.fhgm !== undefined && base.schema.type !== 'FHGFF3') problems.push(`the FHGM block appeared on a ${base.schema.type} reading`);
  if (fhgm.status === 'checked' && !fhgm.warnings.some((line) => line.includes('unreleased draft'))) problems.push('the FHGM verdict travelled without the V7 draft warning');
  return {
    id: vector.id,
    outcome: problems.length === 0 ? 'pass' : 'fail',
    problems,
    note: `base=${base.valid ? 'accept' : 'reject'},checksum=${base.checksum.matches ? 'verify' : 'stale'},model=${fhgm.status === 'checked' ? (fhgm.valid ? 'pass' : 'reject') : fhgm.status}`,
  };
}

/**
 * Run one draft suite and print its table.
 *
 * The suite pin is verified first, and a mismatch refuses the run rather than scoring
 * it: the numbers in the evidence table are a claim about `suiteCommit`, so they have to
 * be checked against the bytes being read before anything is counted.
 *
 * @param {'FHT'|'FHGM'} type
 * @param {string} repoPath a checkout of the owning development repository
 * @returns {{pass: number, fail: number, notRun: number, refused: boolean, unpinned: boolean}}
 */
let VERBOSE = false;

/** @type {string[]} */
const refusals = [];

function runSuite(type, repoPath) {
  const entry = draftEntry(type);
  const layout = layoutFor(type, repoPath);
  const pin = verifySuitePin(type, repoPath);
  console.log(`\n=== ${type} draft suite ===`);
  console.log(`contract pinned: ${entry.repository} ${entry.commit.slice(0, 12)}, sha256 ${entry.sha256.slice(0, 12)}… (the bytes this build compiles)`);
  if (pin.state === 'unpinned') {
    console.log(`suite:         UNPINNED - ${pin.message}`);
  } else if (pin.state !== 'verified') {
    console.log(`suite:         REFUSED - ${pin.message}`);
    refusals.push(pin.message);
    return { pass: 0, fail: 0, notRun: 0, refused: true, unpinned: false };
  } else {
    console.log(`suite:         ${pin.message.replace(/^[A-Z]+: /, '')}`);
    // The guard and the reader must be looking at the same file. `layoutFor()` is where
    // this runner's paths come from; the registry says where the pin's path comes from.
    // If those two ever disagree, the verified manifest is not the one being scored.
    if (resolve(pin.path) !== resolve(layout.manifest)) {
      const message = `${type}: the manifest this build verifies (${pin.path}) is not the one this runner reads (${layout.manifest}); one of the two is wrong and neither claim can be reported`;
      console.log(`suite:         REFUSED - ${message}`);
      refusals.push(message);
      return { pass: 0, fail: 0, notRun: 0, refused: true, unpinned: false };
    }
  }
  if (!existsSync(layout.manifest)) {
    console.log(`${type}: no manifest.json at ${layout.manifest} - not run, nothing claimed`);
    return { pass: 0, fail: 0, notRun: 0, refused: false, unpinned: pin.state === 'unpinned' };
  }
  const manifest = JSON.parse(readFileSync(layout.manifest, 'utf8'));
  console.log(`manifest vectors: ${manifest.vectors.length} (a draft suite, separate from the shared 291)`);
  let pass = 0;
  let fail = 0;
  let notRun = 0;
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const skipped = [];
  for (const vector of manifest.vectors) {
    const result = type === 'FHT' ? runFhtVector(vector, layout) : runFhgmVector(vector, layout);
    if (VERBOSE) console.log(`  ${result.outcome.padEnd(7)} ${vector.id.padEnd(44)} ${result.note}`);
    if (result.outcome === 'pass') pass += 1;
    else if (result.outcome === 'not-run') {
      notRun += 1;
      skipped.push(`  not-run ${vector.id} [${type}]: ${result.note}`);
    } else {
      fail += 1;
      failures.push(`  ${vector.id} [${type}] ${vector.expected} (${result.note})\n    ${result.problems.join('\n    ')}`);
    }
  }
  const revision = pin.state === 'verified' ? ` (suite ${entry.suiteCommit.slice(0, 12)})` : ' (suite revision unpinned: this build states no pin for it)';
  console.log(`${type}: ${pass} pass, ${fail} fail, ${notRun} not-run${revision}`);
  if (skipped.length > 0) {
    console.log('not run, with the reason:');
    for (const line of skipped) console.log(line);
  }
  if (failures.length > 0) {
    console.log('failures:');
    for (const line of failures) console.log(line);
  }
  return { pass, fail, notRun, refused: false, unpinned: pin.state === 'unpinned' };
}

const args = parseArgs(process.argv.slice(2));
if (args.fht === null && args.fhgm === null) {
  console.log(
    'no draft suite given: this is supplemental draft-lane evidence, and it never runs blind.\n'
    + 'pass --fht /path/to/FHT-Specification and/or --fhgm /path/to/FHGM-Specification,\n'
    + 'e.g. git clone https://github.com/FAIR-bioHeaders/FHT-Specification',
  );
  process.exit(3);
}

VERBOSE = args.verbose;
console.log(`node ${process.version}`);
console.log('draft-lane evidence only. The shared acceptance run is `npm run conformance`;');
console.log('nothing below is a released-contract result, and no FHT or FHGM support is claimed.');

let totals = { pass: 0, fail: 0, notRun: 0 };
const unpinned = [];
for (const [type, path] of [['FHT', args.fht], ['FHGM', args.fhgm]]) {
  if (path === null) continue;
  if (!existsSync(path)) {
    console.log(`\n=== ${type}: ${path} does not exist - not run, nothing claimed ===`);
    continue;
  }
  const result = runSuite(/** @type {'FHT'|'FHGM'} */ (type), path);
  totals = { pass: totals.pass + result.pass, fail: totals.fail + result.fail, notRun: totals.notRun + result.notRun };
  if (result.unpinned) unpinned.push(type);
}

console.log(`\nTOTAL draft-lane evidence: ${totals.pass} pass, ${totals.fail} fail, ${totals.notRun} not-run (labelled draft; never counted with the shared 291)`);
if (unpinned.length > 0) {
  console.log(`unpinned suite(s): ${unpinned.join(', ')} - that suite's revision is not stated in drafts/provenance.json, so the count above names no revision for it`);
}
if (refusals.length > 0) {
  console.error(`\n${refusals.length} suite(s) refused, nothing scored against them:`);
  for (const line of refusals) console.error(`  ${line}`);
  console.error('a refused suite means the checkout is not the revision this build pins. Verify it with');
  console.error('`node scripts/ci/suite-pin.mjs --check <checkout>`; re-pin deliberately, never here.');
  process.exitCode = 2;
} else {
  process.exitCode = totals.fail > 0 ? 1 : 0;
}
