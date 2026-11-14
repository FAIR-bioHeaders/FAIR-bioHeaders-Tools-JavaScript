#!/usr/bin/env node
/**
 * Capability study (ii): SHA-512/256 in Node `crypto`, proved against the
 * checksums the shared conformance suite states.
 *
 * `docs/FORMAT.md` R4 requires the SHA-512/256 algorithm — not SHA-512 truncated
 * by hand, not SHA-256 — encoded as canonical padded base64 of its 32-byte
 * digest and compared as an exact string. Node's OpenSSL-backed `crypto` exposes
 * it as `sha512-256`, so no dependency is needed and nothing has to be
 * re-implemented in JavaScript.
 *
 *     node scripts/capability/digest.mjs [path/to/conformance ...]
 *
 * Exit status 0 only when every recomputed digest matches. Recorded output:
 * `docs/CAPABILITY.md`.
 */

import { createHash, getHashes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { computeChecksum } from '../../src/checksum.js';

const SUITES = process.argv.slice(2);
const CONTAINER = { fasta: 'fasta', gfa: 'gfa', 'fhp-fasta': 'fasta', fhgff3: 'gff3' };

console.log(`node ${process.version}`);
console.log(`crypto.getHashes() lists sha512-256: ${getHashes().includes('sha512-256')}`);

if (SUITES.length === 0) {
  console.log('\nno conformance suite given; pass the path: node scripts/capability/digest.mjs <conformance dir>');
  process.exit(3);
}

let failures = 0;
for (const suite of SUITES.map((path) => resolve(path))) {
  if (!existsSync(join(suite, 'manifest.json'))) {
    console.error(`${suite}: no manifest.json`);
    process.exit(3);
  }
  const manifest = JSON.parse(readFileSync(join(suite, 'manifest.json'), 'utf8'));
  let valid = 0;
  const mismatched = [];
  for (const vector of manifest.vectors) {
    if (vector.expected !== 'valid' || !(vector.format in CONTAINER) || typeof vector.checksum !== 'string') continue;
    let bytes = new Uint8Array(readFileSync(join(suite, vector.file)));
    if (vector.compressed) bytes = new Uint8Array(gunzipSync(bytes)); // R1: compression is transport
    const { stated, computed } = computeChecksum(bytes, CONTAINER[vector.format]);
    valid += 1;
    if (!(stated === computed && computed === vector.checksum)) {
      mismatched.push(`${vector.id}: manifest ${vector.checksum}, line ${stated}, computed ${computed}`);
    }
  }
  let tampered = 0;
  const accidentallyMatching = [];
  for (const vector of manifest.vectors) {
    if (vector.expected !== 'invalid' || !(vector.format in CONTAINER) || !['R1', 'R3', 'R4'].includes(vector.rule)) continue;
    let bytes = new Uint8Array(readFileSync(join(suite, vector.file)));
    if (vector.compressed) bytes = new Uint8Array(gunzipSync(bytes));
    let stated;
    let computed;
    try {
      ({ stated, computed } = computeChecksum(bytes, CONTAINER[vector.format]));
    } catch (error) {
      // A malformed checksum line is its own rejection: the R5 grammar fires
      // before any comparison, which is the outcome the vector asks for.
      tampered += 1;
      continue;
    }
    tampered += 1;
    if (stated === computed) accidentallyMatching.push(vector.id);
  }
  console.log(`\n${suite}`);
  console.log(`  valid sequence vectors recomputed: ${valid}; mismatches: ${mismatched.length === 0 ? 0 : mismatched.length}`);
  for (const line of mismatched) console.log(`    ${line}`);
  console.log(`  R1/R3/R4 tamper vectors recomputed: ${tampered}; stated==computed (must be 0): ${accidentallyMatching.length}`);
  for (const line of accidentallyMatching) console.log(`    ${line}`);
  failures += mismatched.length + accidentallyMatching.length;

  if (existsSync(join(suite, 'valid/fasta-lf.fhr.fasta'))) {
    const bytes = new Uint8Array(readFileSync(join(suite, 'valid/fasta-lf.fhr.fasta')));
    const { stated, computed, covered } = computeChecksum(bytes, 'fasta');
    console.log('  fasta-lf.fhr.fasta, one file four readings:');
    console.log(`    covered bytes            ${covered.length}`);
    console.log(`    node sha512-256 base64   ${computed}`);
    console.log(`    stated on the checksum line ${stated}`);
    console.log(`    sha512 truncated to 32 bytes by hand ${createHash('sha512').update(covered).digest().subarray(0, 32).toString('base64')} (R4 says this is not it)`);
    console.log(`    sha256                   ${createHash('sha256').update(covered).digest('base64')} (also not it)`);
    if (stated !== computed) failures += 1;
  }
}
console.log(`\n${failures === 0 ? 'all digests match' : `${failures} mismatches`}`);
process.exitCode = failures === 0 ? 0 : 1;
