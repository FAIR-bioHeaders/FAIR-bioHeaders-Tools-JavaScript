#!/usr/bin/env node
/**
 * Cross-check this library's checksum, verify and strip results against the
 * released Python toolkit's own command line.
 *
 * The reference is the installed `fair-bioheaders` distribution: its
 * `fhr-fasta-validate`, `fhr-gfa-validate` and `fhr-gff3-validate` commands
 * decide validity, and its `*-strip` commands decide the bytes a stripped file
 * holds. This script compares those outputs with this library's, file by file,
 * and prints every disagreement.
 *
 * Without the toolkit it exits 3 and says so; it never reports a pass it did
 * not compute.
 *
 *     FHR_TOOLKIT_BIN=/path/to/.venvs/converter-0.12.0/bin \
 *       node scripts/capability/toolkit-crosscheck.mjs [path/to/conformance ...]
 *
 * Recorded output: `docs/CAPABILITY.md`.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectFile, stripFile } from '../../src/reader.js';

const BIN = process.env.FHR_TOOLKIT_BIN ?? null;
if (BIN === null || !existsSync(join(BIN, 'fhr-fasta-validate'))) {
  console.error('set FHR_TOOLKIT_BIN to a bin directory with the released fair-bioheaders installed');
  process.exit(3);
}

const suites = process.argv.slice(2);
if (suites.length === 0) {
  console.error('usage: FHR_TOOLKIT_BIN=... node scripts/capability/toolkit-crosscheck.mjs <conformance dir> [...]');
  process.exit(2);
}

const COMMAND = { fasta: 'fhr-fasta', gfa: 'fhr-gfa', 'fhp-fasta': 'fhr-fasta', fhgff3: 'fhr-gff3' };
const CONTAINER = { fasta: 'fasta', gfa: 'gfa', 'fhp-fasta': 'fasta', fhgff3: 'gff3' };
const WORK = mkdtempSync(join(tmpdir(), 'fhr-crosscheck-'));

let compared = 0;
let stripCompared = 0;
const problems = [];
const policyChanges = new Map(JSON.parse(readFileSync(fileURLToPath(new URL('../../reader-policy/retirement-crosswalk.json',import.meta.url)),'utf8')).cases.filter(x=>x.expected==='valid').map(x=>[x.id,x.oldSha256]));
const policyObserved=[];
const expectedPolicy=new Set();

for (const suite of suites) {
  const manifest = JSON.parse(readFileSync(join(suite, 'manifest.json'), 'utf8'));
  for (const vector of manifest.vectors) {
    if (!(vector.format in COMMAND)) continue;
    const path = join(suite, vector.file);
    if (vector.compressed) continue; // the toolkit reads plain and BGZF; this pair is checked by the vectors themselves
    const byteQualified = policyChanges.get(vector.id) === createHash('sha256').update(readFileSync(path)).digest('hex');
    if(byteQualified)expectedPolicy.add(vector.id);
    const prefix = COMMAND[vector.format];
    compared += 1;

    let toolkitSaysValid;
    try {
      execFileSync(join(BIN, `${prefix}-validate`), [path], { stdio: ['ignore', 'pipe', 'pipe'] });
      toolkitSaysValid = true;
    } catch (error) {
      if (error && typeof error.status === 'number') toolkitSaysValid = false;
      else {
        problems.push(`${vector.id}: could not run ${prefix}-validate: ${String(error.message).split('\n')[0]}`);
        continue;
      }
    }
    const reading = inspectFile(path, { container: CONTAINER[vector.format] });
    if (reading.valid !== toolkitSaysValid) {
      if(byteQualified&&toolkitSaysValid&&!reading.valid&&reading.errors.some(x=>x.includes('R4:'))){
        policyObserved.push(vector.id);
      }else problems.push(`${vector.id}: toolkit valid=${toolkitSaysValid}, this library valid=${reading.valid} (${reading.errors.join('; ')})`);
    }

    if (toolkitSaysValid) {
      const out = join(WORK, `${vector.id}.stripped`);
      execFileSync(join(BIN, `${prefix}-strip`), [path, out]);
      const theirs = new Uint8Array(readFileSync(out));
      const ours = stripFile(path, { container: CONTAINER[vector.format] });
      stripCompared += 1;
      if (theirs.length !== ours.length || !theirs.every((byte, index) => byte === ours[index])) {
        problems.push(`${vector.id}: strip differs (toolkit ${theirs.length} bytes, this library ${ours.length} bytes)`);
      }
    }
  }
}

for(const id of expectedPolicy)if(!policyObserved.includes(id))problems.push(`${id}: pinned historical reader no longer exhibits the recorded D9 difference; revise dated differential evidence`);
rmSync(WORK, { recursive: true, force: true });

console.log(`adopted D9 differences against the pinned historical reader (${policyObserved.length}): ${policyObserved.join(', ')}`);
console.log(`validity compared on ${compared} vectors; strip compared on ${stripCompared} valid vectors`);
if (problems.length === 0) console.log('no unexplained disagreements with the pinned historical toolkit; D9 differences are explicit above');
else {
  console.log(`disagreements (${problems.length}):`);
  for (const line of problems) console.log(`  ${line}`);
}
process.exitCode = problems.length === 0 ? 0 : 1;
