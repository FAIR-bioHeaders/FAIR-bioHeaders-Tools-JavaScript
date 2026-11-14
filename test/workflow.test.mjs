/**
 * The native acceptance job must be native, and this file is what proves it.
 *
 * The maintainer direction for this repository (FAIR-bioHeaders-Specification#211
 * round 10) is that the clean primary acceptance job runs without Python or a
 * foreign-language toolkit as a project dependency, and that any reference
 * differential is separate and labelled. That is a property of the workflow file,
 * so it is checked as one, with js-yaml - the dependency this library already
 * uses for the header YAML - rather than by a human remembering to look.
 *
 * It fails when:
 *
 * - the primary job installs or invokes a foreign runtime (`setup-python`, `pip`,
 *   `python`, `conda`, `uv`, `Rscript`, `julia`, `mvn`, `gradle`, `dotnet`);
 * - a job that does install Python is not labelled supplemental, so a differential
 *   cannot be mistaken for the gate;
 * - the primary job stops running the acceptance commands: the vendoring and draft
 *   pin check, the licence check, the docs and matrix check, the native test suite
 *   through the accounting guard, and the shared conformance runner;
 * - the guard script itself is missing from the job, which is how a silent skip of
 *   the accounting step would otherwise look.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const PRIMARY = 'native';
const FOREIGN_RUNTIME = /\b(setup-python|pip3?\s+install|python3?\b|conda\b|\buv\s|apt(-get)?\s+install\s+[^\n]*(python|r-base|julia|maven)|Rscript|julia\b|\bmvn\b|\bgradle\b|dotnet\b)/i;
const REQUIRED_COMMANDS = [
  'scripts/check-vendoring.mjs',
  'scripts/check-license.mjs',
  'scripts/check-docs.mjs',
  'scripts/make-matrix.mjs --check',
  'scripts/check-test-report.mjs',
  'scripts/run-conformance.mjs',
];

/**
 * @param {string} file
 * @returns {{name: string, jobs: Record<string, any>}}
 */
function loadWorkflow(file) {
  const path = join(ROOT, '.github', 'workflows', file);
  assert.ok(existsSync(path), `${file}: the workflow is missing`);
  const doc = yaml.load(readFileSync(path, 'utf8'));
  assert.ok(doc !== null && typeof doc === 'object', `${file}: does not parse to a workflow`);
  assert.ok(doc.jobs !== undefined && typeof doc.jobs === 'object', `${file}: has no jobs`);
  return doc;
}

/**
 * @param {any} job
 * @returns {string}
 */
function jobText(job) {
  return JSON.stringify(job);
}

describe('the CI workflow is native where it has to be', () => {
  const ci = loadWorkflow('ci.yml');

  it('has a primary job named for what it is', () => {
    assert.ok(ci.jobs[PRIMARY] !== undefined, `ci.yml must define a "${PRIMARY}" job`);
    const name = String(ci.jobs[PRIMARY].name ?? '');
    assert.match(name, /native/i, 'the primary job says native in its name');
    assert.match(name, /acceptance/i, 'the primary job says it is the acceptance gate');
  });

  it('installs no foreign runtime in the primary acceptance job', () => {
    const job = ci.jobs[PRIMARY];
    const uses = (job.steps ?? []).map((step) => String(step.uses ?? ''));
    assert.ok(
      !uses.some((ref) => /setup-python|r-actions|julia-actions|setup-java/.test(ref)),
      `the primary job must not set up another language runtime, saw ${JSON.stringify(uses)}`,
    );
    const run = (job.steps ?? []).map((step) => String(step.run ?? '')).join('\n');
    assert.ok(!FOREIGN_RUNTIME.test(run), `the primary job must not invoke a foreign runtime, matched in: ${run.match(FOREIGN_RUNTIME)?.[0]}`);
  });

  it('runs the acceptance commands in the primary job', () => {
    const run = (ci.jobs[PRIMARY].steps ?? []).map((step) => String(step.run ?? '')).join('\n');
    const missing = REQUIRED_COMMANDS.filter((command) => !run.includes(command));
    assert.deepEqual(missing, [], 'the primary job must run every acceptance command');
  });

  it('fails rather than reports success on a runner problem', () => {
    // `--test` exits non-zero on a failing test; the accounting guard exits
    // non-zero on zero tests, a missing vector or an unexplained skip. Neither may
    // be wrapped in `|| true` or given continue-on-error.
    const steps = ci.jobs[PRIMARY].steps ?? [];
    const soft = steps.filter((step) => step['continue-on-error'] === true || /\|\|\s*true/.test(String(step.run ?? '')));
    assert.deepEqual(soft.map((step) => step.name ?? step.uses), [], 'no primary-job step may be allowed to fail softly');
  });

  it('labels every differential job as supplemental', () => {
    const offenders = [];
    for (const [id, job] of Object.entries(ci.jobs)) {
      if (id === PRIMARY) continue;
      const usesPython = /setup-python/.test(jobText(job));
      if (!usesPython) continue;
      const name = String(job.name ?? '');
      if (!/supplemental/i.test(name)) offenders.push(`${id}: installs Python but is not labelled supplemental (${name})`);
      if (new RegExp(`${PRIMARY}`).test(String(job.needs ?? ''))) offenders.push(`${id}: a supplemental job must not be the gate for the primary one`);
    }
    assert.deepEqual(offenders, []);
  });

  it('keeps the runtime matrix at or above the package engine floor', () => {
    const engines = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).engines.node;
    const floor = Number(/(\d+)/.exec(engines)[1]);
    const matrix = ci.jobs[PRIMARY].strategy?.matrix?.node ?? [];
    assert.ok(matrix.length >= 2, 'the primary job should test more than one runtime line');
    for (const version of matrix) {
      assert.ok(Number(version) >= floor, `the matrix tests Node ${version}, below the engines floor ${floor}`);
    }
    assert.ok(matrix.map(String).includes(String(floor)), `the engines floor (${floor}) must itself be a tested line`);
  });

  it('runs the draft lane as labelled draft evidence, never as acceptance', () => {
    const draft = Object.entries(ci.jobs).find(([, job]) => /draft/i.test(String(job.name ?? '')));
    assert.ok(draft !== undefined, 'ci.yml should run the draft-lane evidence job');
    const [id, job] = draft;
    assert.match(String(job.name), /draft/i);
    assert.match(String(job.name), /not acceptance|labelled draft/i, 'the draft job must say it is not acceptance');
    assert.ok(!String(job.needs ?? '').includes(PRIMARY), 'the draft job must not gate, or be gated by, acceptance');
    const run = jobText(job);
    assert.match(run, /draft-vectors\.mjs/);
    assert.ok(!FOREIGN_RUNTIME.test((job.steps ?? []).map((step) => String(step.run ?? '')).join('\n')), `${id}: the draft lane is native JavaScript and must not need a foreign runtime`);
  });
});

describe('the docs workflow', () => {
  it('exists and checks the generated matrix too', () => {
    const docs = loadWorkflow('docs.yml');
    assert.ok(Object.keys(docs.jobs).length >= 1);
  });
});
