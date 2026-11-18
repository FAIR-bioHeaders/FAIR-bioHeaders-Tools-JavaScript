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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

for (const suite of suites) {
  const manifest = JSON.parse(readFileSync(join(suite, 'manifest.json'), 'utf8'));
  for (const vector of manifest.vectors) {
    if (!(vector.format in COMMAND)) continue;
    const path = join(suite, vector.file);
    if (vector.compressed) continue; // the toolkit reads plain and BGZF; this pair is checked by the vectors themselves
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
      problems.push(`${vector.id}: toolkit valid=${toolkitSaysValid}, this library valid=${reading.valid} (${reading.errors.join('; ')})`);
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

rmSync(WORK, { recursive: true, force: true });

console.log(`validity compared on ${compared} vectors; strip compared on ${stripCompared} valid vectors`);
if (problems.length === 0) console.log('no disagreements with the released toolkit');
else {
  console.log(`disagreements (${problems.length}):`);
  for (const line of problems) console.log(`  ${line}`);
}
process.exitCode = problems.length === 0 ? 0 : 1;
