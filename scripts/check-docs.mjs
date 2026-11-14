#!/usr/bin/env node
/**
 * Check the documentation against the machine-readable facts it restates.
 *
 * `README.md` and `llms.txt` are written for people and for assistants, and both
 * repeat things that live elsewhere: the contract versions, the vector counts, the
 * commands to run. The shared specification guards the same hazard for its own
 * `llms.txt` with `tests/test_llms_txt.py`; this is the equivalent here.
 *
 *     node scripts/check-docs.mjs              # versions, counts, draft guard
 *     node scripts/check-docs.mjs --commands   # every advertised npm script exists
 *
 * Exit status is 1 on any drift, including a draft contract named as if it were
 * released: FHT and FHGM must not acquire a w3id URL, a `schemaVersion` row or a
 * support claim anywhere in this repository.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CURRENT_RELEASE } from '../src/registry.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DOC_FILES = ['README.md', 'llms.txt', 'AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/CAPABILITY.md', 'docs/CONFORMANCE.md', 'docs/USAGE.md', 'skills/fair-bioheaders-javascript/SKILL.md'];

const problems = [];
const notes = [];

/** @type {string[]} files that were read */
const read = [];
for (const file of DOC_FILES) {
  const path = join(ROOT, file);
  if (!existsSync(path)) {
    problems.push(`${file}: missing`);
    continue;
  }
  read.push(file);
}
const text = read.map((file) => readFileSync(join(ROOT, file), 'utf8')).join('\n');

// --- contract versions, from the vendored provenance ----------------------
const provenance = JSON.parse(readFileSync(join(ROOT, 'schemas', 'provenance.json'), 'utf8'));
const current = provenance.releases[provenance.current];
for (const type of ['FHR', 'FHP', 'FHGFF3']) {
  const stated = String(current[type].schemaVersion);
  const release = provenance.current;
  const wantsCitation = new RegExp(`w3id\\.org/fair-bioheaders/${type.toLowerCase()}/${release}`);
  if (!wantsCitation.test(text)) {
    problems.push(`no document cites the current ${type} contract URL https://w3id.org/fair-bioheaders/${type.toLowerCase()}/${release}`);
  }
  const versionRow = new RegExp(`${type}[^\n]*'${stated.replace('.', '\\.')}'`);
  if (!versionRow.test(text)) {
    problems.push(`no document states ${type} schemaVersion '${stated}' (provenance says the current release is ${release})`);
  }
}
notes.push(`contract versions checked against ${provenance.current}: FHR '${current.FHR.schemaVersion}', FHP '${current.FHP.schemaVersion}', FHGFF3 '${current.FHGFF3.schemaVersion}'`);

// --- draft guard ----------------------------------------------------------
for (const draft of ['fht', 'fhgm']) {
  const url = new RegExp(`w3id\\.org/fair-bioheaders/${draft}\\b`, 'i');
  if (url.test(text)) problems.push(`a document names https://w3id.org/fair-bioheaders/${draft}/… — a draft has no w3id alias (rule V7)`);
  if (Object.values(provenance.releases).some((row) => row[draft.toUpperCase()] !== undefined)) {
    problems.push(`schemas/provenance.json lists a ${draft.toUpperCase()} contract`);
  }
}
for (const [type, version] of [['FHT', '1.0'], ['FHGM', '1.0'], ['FHT', '0.1']]) {
  const claim = new RegExp(`${type}[^\n]{0,40}schemaVersion[^\n]{0,8}'${version}'`, 'i');
  if (claim.test(text)) problems.push(`a document states a schemaVersion for the ${type} draft`);
}
const registryTypes = Object.keys(provenance.releases[provenance.current])
  .filter((key) => key !== 'commit')
  .slice()
  .sort();
if (registryTypes.join(',') !== ['FHR', 'FHGFF3', 'FHP'].sort().join(',')) {
  problems.push(`schemas/provenance.json current row lists ${registryTypes.join(', ')}; only released contracts may appear`);
}
notes.push('draft guard: no FHT or FHGM URL, schemaVersion row or registry entry found');

// --- vector counts, from the vendored manifest ---------------------------
const manifest = JSON.parse(readFileSync(join(ROOT, 'conformance', 'manifest.json'), 'utf8'));
const counts = {};
for (const vector of manifest.vectors) counts[vector.format] = (counts[vector.format] ?? 0) + 1;
const runnable = ['fasta', 'gfa', 'fhp-fasta', 'fhgff3'];
const runnableTotal = runnable.reduce((sum, format) => sum + (counts[format] ?? 0), 0);
const notRunTotal = manifest.vectors.length - runnableTotal;
if (!new RegExp(`${manifest.vectors.length}[^\n]{0,80}vector`).test(text)) {
  problems.push(`no document states the suite size (${manifest.vectors.length} vectors)`);
}
if (!text.includes(`${runnableTotal} of ${runnableTotal} runnable`)) {
  problems.push(`no document states "228 of 228 runnable" style results (runnable here is ${runnableTotal})`);
}
for (const format of runnable) {
  if (!new RegExp(`${format}\\s+${counts[format]}\\s+${counts[format]}\\s+0`).test(text)) {
    problems.push(`docs/CONFORMANCE.md must show ${format} ${counts[format]} total and ${counts[format]} pass with 0 fail`);
  }
}
if (!text.includes(String(notRunTotal))) problems.push(`no document states the not-run count (${notRunTotal})`);
notes.push(`vectors: ${manifest.vectors.length} total, ${runnableTotal} runnable, ${notRunTotal} not run (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')})`);

// --- the pinned provenance is what the docs quote -------------------------
const conformance = JSON.parse(readFileSync(join(ROOT, 'conformance', 'provenance.json'), 'utf8'));
if (!text.includes(conformance.source.commit.slice(0, 7))) {
  problems.push(`no document names the pinned conformance commit ${conformance.source.commit}`);
}
if (!text.includes(CURRENT_RELEASE)) problems.push(`no document names the current release ${CURRENT_RELEASE}`);

// --- advertised commands --------------------------------------------------
if (process.argv.includes('--commands')) {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const scripts = new Set(Object.keys(pkg.scripts ?? {}));
  const advertised = new Set();
  for (const match of text.matchAll(/npm (?:run|ci|test)(?::|\s+([a-z][\w:-]*))?/g)) {
    if (match[1]) advertised.add(match[1]);
  }
  for (const script of advertised) {
    if (!scripts.has(script)) problems.push(`documentation advertises \`npm run ${script}\`, package.json has no such script`);
  }
  for (const script of scripts) {
    if (!text.includes(script)) notes.push(`script ${script} is defined but not documented`);
  }
  notes.push(`documented commands checked against ${scripts.size} package.json scripts`);
}

// --- broken relative links inside the repository -------------------------
for (const file of read) {
  const body = readFileSync(join(ROOT, file), 'utf8');
  for (const match of body.matchAll(/\]\((?!https?:)(?!mailto:)([^)#]+)(#[^)]*)?\)/g)) {
    const target = resolve(dirname(join(ROOT, file)), match[1]);
    if (!existsSync(target)) problems.push(`${file}: relative link target does not exist: ${match[1]}`);
  }
}

for (const line of notes) console.log(`note: ${line}`);
if (problems.length === 0) console.log(`docs consistent across ${read.length} files`);
else {
  console.log(`problems (${problems.length}):`);
  for (const line of problems) console.log(`  ${line}`);
}
process.exitCode = problems.length === 0 ? 0 : 1;
