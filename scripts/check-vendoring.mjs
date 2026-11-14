#!/usr/bin/env node
/**
 * Check the vendored copies in this repository against their recorded provenance.
 *
 * Three trees are vendored from FAIR-bioHeaders-Specification and all must stay
 * byte-exact, because everything else here is measured against them:
 *
 * - `schemas/`: the released contract files the reader selects between;
 * - `conformance/`: the shared vectors that decide acceptance;
 * - `examples/`: the minimal records the tests and capability scripts use.
 *
 * Default mode recomputes every recorded SHA-256 offline and reports drift: a
 * silent change to `schemas/fhp-1.2.json` would alter which files this library
 * calls valid, so provenance drift is a correctness event, not cosmetics.
 *
 *     node scripts/check-vendoring.mjs
 *     node scripts/check-vendoring.mjs --upstream ../FAIR-bioHeaders-Specification
 *
 * With `--upstream`, the copies are compared again against the specification.
 * Contract copies are read from their **recorded tag commit**
 * (`git show <commit>:<path>`), not from the working tree: a checkout carries one
 * release at a time and the copies here belong to seven. Exit status is 1 on any
 * mismatch.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {Buffer|Uint8Array|string} data bytes or text to hash
 * @returns {string}
 */
function hash(data) {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * @param {string} path file to read and hash
 * @returns {string}
 */
function sha256File(path) {
  return hash(readFileSync(path));
}

/**
 * @param {string} repo
 * @param {string} commit
 * @param {string} path
 * @returns {string|null} digest of the file at that revision, or null when the
 *   revision is not present in that checkout
 */
function sha256At(repo, commit, path) {
  try {
    const bytes = execFileSync('git', ['-C', repo, 'show', `${commit}:${path}`], { encoding: null, stdio: ['ignore', 'pipe', 'ignore'] });
    return hash(bytes);
  } catch {
    return null;
  }
}

const problems = [];
let checked = 0;

// --- schemas/ -------------------------------------------------------------
const schemaProvenance = JSON.parse(readFileSync(join(ROOT, 'schemas', 'provenance.json'), 'utf8'));
const recordedSchemaFiles = new Set();
for (const [release, row] of Object.entries(schemaProvenance.releases)) {
  for (const [type, file] of Object.entries(row)) {
    if (type === 'commit') continue;
    checked += 1;
    recordedSchemaFiles.add(file.file);
    const path = join(ROOT, 'schemas', file.file);
    if (!existsSync(path)) {
      problems.push(`schemas/${file.file}: missing (recorded for ${type} ${release})`);
      continue;
    }
    const actual = sha256File(path);
    if (actual !== file.sha256) {
      problems.push(`schemas/${file.file}: sha256 ${actual}, provenance records ${file.sha256} (${type} ${release})`);
    }
  }
}
for (const name of [...recordedSchemaFiles]) {
  if (!existsSync(join(ROOT, 'schemas', name))) problems.push(`schemas/${name}: recorded but absent`);
}

// --- conformance/ ---------------------------------------------------------
const conformanceRoot = join(ROOT, 'conformance');
const conformanceProvenancePath = join(conformanceRoot, 'provenance.json');
let conformance = null;
if (!existsSync(conformanceProvenancePath)) {
  problems.push('conformance/provenance.json: missing');
} else {
  conformance = JSON.parse(readFileSync(conformanceProvenancePath, 'utf8'));
  const recorded = conformance.perFile;
  for (const [name, want] of Object.entries(recorded)) {
    checked += 1;
    const path = join(conformanceRoot, name);
    if (!existsSync(path)) {
      problems.push(`conformance/${name}: missing (recorded in provenance)`);
      continue;
    }
    const actual = sha256File(path);
    if (actual !== want) problems.push(`conformance/${name}: sha256 ${actual}, provenance records ${want}`);
  }
  const combined = hash(
    Object.entries(recorded)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, digest]) => `${name}  ${digest}`)
      .join('\n'),
  );
  if (combined !== conformance.combinedSha256) {
    problems.push(`conformance: combined digest ${combined}, provenance records ${conformance.combinedSha256}`);
  }
  if (sha256File(join(conformanceRoot, 'manifest.json')) !== conformance.manifestSha256) {
    problems.push('conformance/manifest.json does not match its recorded digest');
  }
  const manifest = JSON.parse(readFileSync(join(conformanceRoot, 'manifest.json'), 'utf8'));
  if (manifest.vectors.length !== conformance.vectors) {
    problems.push(`conformance: manifest lists ${manifest.vectors.length} vectors, provenance records ${conformance.vectors}`);
  }
  const named = new Set(manifest.vectors.map((vector) => vector.file));
  for (const name of Object.keys(recorded)) {
    if (name === 'README.md' || name === 'manifest.json') continue;
    if (!named.has(name)) problems.push(`conformance/${name}: present in the tree, named by no vector`);
  }
  for (const name of named) {
    if (!(name in recorded)) problems.push(`conformance/${name}: named by a vector, missing from provenance`);
  }
}

// --- examples/ ------------------------------------------------------------
const examplesProvenancePath = join(ROOT, 'examples', 'provenance.json');
let examples = null;
if (!existsSync(examplesProvenancePath)) {
  problems.push('examples/provenance.json: missing');
} else {
  examples = JSON.parse(readFileSync(examplesProvenancePath, 'utf8'));
  for (const [name, row] of Object.entries(examples.files)) {
    checked += 1;
    const path = join(ROOT, 'examples', name);
    if (!existsSync(path)) {
      problems.push(`examples/${name}: missing (recorded in provenance)`);
      continue;
    }
    const actual = sha256File(path);
    if (actual !== row.sha256) problems.push(`examples/${name}: sha256 ${actual}, provenance records ${row.sha256}`);
  }
}

// --- optional upstream comparison ----------------------------------------
const argIndex = process.argv.indexOf('--upstream');
if (argIndex >= 0) {
  const upstream = resolve(process.argv[argIndex + 1] ?? '');
  if (!upstream || !existsSync(join(upstream, 'conformance', 'manifest.json'))) {
    console.error(`--upstream ${process.argv[argIndex + 1] ?? '(missing argument)'} has no conformance/manifest.json`);
    process.exit(2);
  }
  const isRepo = existsSync(join(upstream, '.git'));
  const readAt = (commit, path) => (isRepo ? sha256At(upstream, commit, path) : existsSync(join(upstream, path)) ? sha256File(join(upstream, path)) : null);

  for (const [release, row] of Object.entries(schemaProvenance.releases)) {
    for (const [type, file] of Object.entries(row)) {
      if (type === 'commit') continue;
      const theirs = readAt(row.commit, file.sourcePath);
      if (theirs === null) continue; // the tag is not in that checkout: nothing to compare
      if (theirs !== file.sha256) {
        problems.push(`upstream drift: ${file.sourcePath} at ${row.commit} differs from schemas/${file.file} (recorded for ${type} ${release})`);
      }
    }
  }
  if (examples !== null) {
    for (const [name, row] of Object.entries(examples.files)) {
      const theirs = readAt(examples.source.commit, row.sourcePath);
      if (theirs !== null && theirs !== row.sha256) problems.push(`upstream drift: examples/${name} differs from ${row.sourcePath} at ${examples.source.commit}`);
    }
  }
  if (conformance !== null) {
    for (const [name, want] of Object.entries(conformance.perFile)) {
      const theirs = readAt(conformance.source.commit, `conformance/${name}`);
      if (theirs === null) problems.push(`upstream drift: conformance/${name} is not readable at ${conformance.source.commit} in ${upstream}`);
      else if (theirs !== want) problems.push(`upstream drift: conformance/${name} differs from ${conformance.source.commit} in ${upstream}`);
    }
  }
  console.log(`compared against ${upstream}${isRepo ? ' using the recorded tag commits' : ' as a plain directory'}`);
}

console.log(`vendored copies checked: ${checked}`);
if (problems.length === 0) console.log('every digest matches its provenance record');
else {
  console.log(`problems (${problems.length}):`);
  for (const line of problems.slice(0, 40)) console.log(`  ${line}`);
  if (problems.length > 40) console.log(`  … ${problems.length - 40} more`);
}
process.exitCode = problems.length === 0 ? 0 : 1;
