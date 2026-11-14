#!/usr/bin/env node
/**
 * Check the documentation against the machine-readable facts it restates.
 *
 * `README.md` and `llms.txt` are written for people and for assistants, and both
 * repeat things that live elsewhere: the contract versions, the vector counts, the
 * commands to run. The shared specification guards the same hazard for its own
 * `llms.txt` with `tests/test_llms_txt.py`; this is the equivalent here.
 *
 *     node scripts/check-docs.mjs              # versions, counts, draft guard, matrix
 *     node scripts/check-docs.mjs --commands   # every advertised npm script exists
 *
 * Exit status is 1 on any drift, including a draft contract named as if it were
 * released: FHT and FHGM must not acquire a w3id URL, a release-tag citation, a
 * `schemaVersion` row or a support claim anywhere in this repository, and every
 * document that names the V7 lane must name its pin and its opt-in condition.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CURRENT_RELEASE } from '../src/registry.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DOC_FILES = ['README.md', 'llms.txt', 'AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/CAPABILITY.md', 'docs/CONFORMANCE.md', 'docs/USAGE.md', 'docs/MATRIX.md', 'skills/fair-bioheaders-javascript/SKILL.md'];

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
// Rule V7 lets a draft be *recognised* through an explicit lane and forbids it
// taking any release form. The guard therefore checks three things: no release
// shape anywhere (w3id alias, release-tag citation, registry row, published
// schemaVersion), no support claim, and an honest statement of the lane's
// conditionality wherever a pinned draft is named.
const draftProvenance = JSON.parse(readFileSync(join(ROOT, 'drafts', 'provenance.json'), 'utf8'));
const draftTypes = Object.keys(draftProvenance.drafts);
for (const draft of draftTypes.map((type) => type.toLowerCase())) {
  const url = new RegExp(`w3id\\.org/fair-bioheaders/${draft}\\b`, 'i');
  if (url.test(text)) problems.push(`a document names https://w3id.org/fair-bioheaders/${draft}/… — a draft has no w3id alias (rule V7)`);
  const tagUrl = new RegExp(`raw\\.githubusercontent\\.com/FAIR-bioHeaders/[A-Za-z-]*${draft}-Specification/v[0-9]`, 'i');
  if (tagUrl.test(text)) problems.push(`a document cites a release-tag URL for the ${draft.toUpperCase()} draft: V7 recognises a raw-main citation only`);
  if (Object.values(provenance.releases).some((row) => row[draft.toUpperCase()] !== undefined)) {
    problems.push(`schemas/provenance.json lists a ${draft.toUpperCase()} contract`);
  }
  // "supported" and "ships" are the claim words. "released" is not: the honest
  // sentence about a draft is that it has no released contract, and forbidding the
  // word would push the prose into euphemism.
  const supportClaim = new RegExp(`(${draft.toUpperCase()})[^.!\\n]{0,60}\\b(is |are |now )?(supported|ships|shipped)\\b`, 'i');
  const claim = supportClaim.exec(text);
  if (claim !== null) {
    const window = text.slice(claim.index, claim.index + 140);
    if (!/\b(not|no) (yet )?(supported|a released|support claim)/i.test(window) && !/\bnever supported/i.test(window)) {
      problems.push(`a document claims ${draft.toUpperCase()} support: ${JSON.stringify(window.slice(0, 90))}`);
    }
  }
}
for (const [type, version] of [['FHT', '1.0'], ['FHGM', '1.0'], ['FHT', '0.1'], ['FHGM', '0.1']]) {
  const claim = new RegExp(`${type}[^\\n]{0,40}schemaVersion[^\\n]{0,8}'${version}'`, 'i');
  if (claim.test(text)) problems.push(`a document states a schemaVersion for the ${type} draft`);
}
for (const type of draftTypes) {
  const row = draftProvenance.drafts[type];
  if (!text.includes(row.commit) && !text.includes(row.commit.slice(0, 12))) {
    problems.push(`no document names the ${type} draft pin commit ${row.commit}: re-pinning the draft without updating the prose is exactly the drift this guard exists for`);
  }
  if (!text.includes(row.sha256) && !text.includes(row.sha256.slice(0, 12))) {
    problems.push(`no document names the ${type} draft pin digest ${row.sha256.slice(0, 12)}...`);
  }
}
if (!/\{drafts:/.test(text)) problems.push('no document shows how the V7 lane is opened (`{drafts: [...]}`), so the opt-in condition is unstated');
if (!/lane[^.\n]{0,80}(never the default|not the default|opt-in)/i.test(text) && !/(never the default|opt-in)[^.\n]{0,80}lane/i.test(text)) {
  problems.push('no document states that the draft lane is never the default');
}
const registryTypes = Object.keys(provenance.releases[provenance.current])
  .filter((key) => key !== 'commit')
  .slice()
  .sort();
if (registryTypes.join(',') !== ['FHR', 'FHGFF3', 'FHP'].sort().join(',')) {
  problems.push(`schemas/provenance.json current row lists ${registryTypes.join(', ')}; only released contracts may appear`);
}
const draftsRegistryTypes = Object.keys(draftProvenance.drafts).sort();
if (draftsRegistryTypes.join(',') !== ['FHGM', 'FHT'].join(',')) {
  problems.push(`drafts/provenance.json lists ${draftsRegistryTypes.join(', ')}; the V7 lane covers exactly the two drafts, FHT and FHGM`);
}
notes.push(`draft guard: ${draftsRegistryTypes.join('/')} pinned at their commits, no w3id alias, no registry row, no schemaVersion, no support claim`);

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

// --- the generated matrix ------------------------------------------------
const matrixPath = join(ROOT, 'docs', 'MATRIX.md');
if (!existsSync(matrixPath)) {
  problems.push('docs/MATRIX.md is missing: run `npm run matrix`');
} else {
  const matrix = readFileSync(matrixPath, 'utf8');
  const { capabilityRows } = await import('../src/types.js');
  const cells = capabilityRows().length;
  if (!matrix.includes(`${cells} cells`)) {
    problems.push(`docs/MATRIX.md does not state the ${cells} cells the registry renders: run \`npm run matrix\` and commit the result`);
  }
}

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

// --- in-page anchors and relative links inside the repository ------------
const headingsByFile = new Map();
for (const file of read) {
  const body = readFileSync(join(ROOT, file), 'utf8');
  const slugs = new Set();
  for (const match of body.matchAll(/^#{1,6} +(.*)$/gm)) {
    slugs.add(
      match[1]
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9 -]/g, '')
        .replace(/ +/g, '-'),
    );
  }
  headingsByFile.set(file, slugs);
}

// --- broken relative links inside the repository -------------------------
for (const file of read) {
  const body = readFileSync(join(ROOT, file), 'utf8');
  for (const match of body.matchAll(/\]\((?!https?:)(?!mailto:)([^)#]*)(#[^)]*)?\)/g)) {
    const [, targetPath, fragment] = match;
    if (targetPath !== '') {
      const target = resolve(dirname(join(ROOT, file)), targetPath);
      if (!existsSync(target)) problems.push(`${file}: relative link target does not exist: ${targetPath}`);
    }
    if (fragment === undefined) continue;
    // An in-page anchor is a claim that a heading exists. GitHub's slug is the
    // heading lowercased with punctuation dropped and spaces hyphenated, which is
    // what the set above computes.
    const slug = fragment.slice(1);
    const inFile = targetPath === '' ? file : join(dirname(file), targetPath);
    const slugs = headingsByFile.get(inFile.replace(/\\/g, '/'));
    if (slugs === undefined || !slugs.has(slug)) problems.push(`${file}: anchor #${slug} matches no heading in ${inFile}`);
  }
}

for (const line of notes) console.log(`note: ${line}`);
if (problems.length === 0) console.log(`docs consistent across ${read.length} files`);
else {
  console.log(`problems (${problems.length}):`);
  for (const line of problems) console.log(`  ${line}`);
}
process.exitCode = problems.length === 0 ? 0 : 1;
