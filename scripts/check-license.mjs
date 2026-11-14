#!/usr/bin/env node
/**
 * Check that the licence is stated once, correctly, in both places.
 *
 * The four per-language library repositories were created without a licence, and
 * the first scaffold of one of them declared `License: GPL-3` in its package
 * manifest with no `LICENSE` file at all — a copyleft incompatible with the
 * family's MPL-2.0 policy, merged before anyone checked. This script is the cheap
 * guard against repeating that here:
 *
 * 1. `package.json` says exactly `MPL-2.0`, a valid SPDX id, and the installed
 *    tree reports the same thing;
 * 2. `LICENSE` exists, carries the project's provenance-split sentences, and ends
 *    with the unmodified Mozilla Public License 2.0 text, verified by digest
 *    against the canonical text (recorded below, and re-checked against
 *    mozilla.org unless `--offline` is given), so a silent edit to the licence
 *    body fails;
 * 3. no other licence name appears in the preamble.
 *
 *     node scripts/check-license.mjs [--offline]
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** SHA-256 and size of the canonical MPL-2.0 text as published by Mozilla. */
const CANONICAL_MPL2_SHA256 = '3f3d9e0024b1921b067d6f7f88deb4a60cbe7a78e76c64e3f1d7fc3b779b9d04';
const CANONICAL_MPL2_BYTES = 16726;
const CANONICAL_URL = 'https://www.mozilla.org/media/MPL/2.0/index.txt';

/** Sentences the family licence preamble must preserve (see FAIR-bioHeaders-Specification/LICENSE). */
/**
 * Fragments of the provenance-split terms, matched with whitespace relaxed
 * because the preamble wraps them across lines.
 */
const REQUIRED_PHRASES = [
  ['Historical USDA Agricultural Research Service', 'USDA-ARS'],
  ['remains? public domain within the United States', 'public domain'],
  ['MPL-2.0 for new (?:FAIR BioHeaders )?project contributions from March 2025 onward', 'from March 2025 onward'],
  ['Third-party material retains its own applicable licenses and notices', 'third-party'],
  ['Previously distributed versions retain the permissions under which they were', 'previously distributed'],
  ['most recent modification date alone does not determine the status', 'modification date'],
];

const problems = [];
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

if (pkg.license !== 'MPL-2.0') {
  problems.push(`package.json license is ${JSON.stringify(pkg.license)}, expected the SPDX id "MPL-2.0"`);
}

let body = null;
let preamble = null;
const licensePath = join(ROOT, 'LICENSE');
if (!existsSync(licensePath)) {
  problems.push('LICENSE is missing');
} else {
  const text = readFileSync(licensePath);
  body = text.subarray(text.length - CANONICAL_MPL2_BYTES);
  preamble = text.subarray(0, text.length - CANONICAL_MPL2_BYTES);
  const digest = createHash('sha256').update(body).digest('hex');
  if (digest !== CANONICAL_MPL2_SHA256) {
    problems.push(`the licence body is not the canonical MPL-2.0 text: sha256 ${digest}, expected ${CANONICAL_MPL2_SHA256}`);
  }
  const flat = preamble.toString('utf8').replace(/\s+/g, ' ');
  for (const [pattern, label] of REQUIRED_PHRASES) {
    if (!new RegExp(pattern, 'i').test(flat)) {
      problems.push(`LICENSE preamble does not preserve the ${label} term (expected /${pattern}/)`);
    }
  }
  if (/\bGPL\b|\bAGPL\b|\bLGPL\b|\bApache\b|\bPDDL\b/.test(preamble.toString('utf8'))) {
    problems.push('the LICENSE preamble names a licence other than MPL-2.0; check the intent');
  }
}

// What a registry or a downstream licence scan actually reads.
try {
  const listed = JSON.parse(execFileSync('npm', ['ls', '--depth=0', '--json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const reported = listed.dependencies?.[pkg.name]?.license;
  if (reported !== undefined && reported !== 'MPL-2.0') {
    problems.push(`npm reports the installed package licence as ${JSON.stringify(reported)}, not MPL-2.0`);
  }
} catch (error) {
  console.log(`note: npm ls failed (${String(error.message).split('\n')[0]}); the manifest check still ran`);
}

if (!process.argv.includes('--offline')) {
  try {
    const response = await fetch(CANONICAL_URL);
    if (response.ok) {
      const remote = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
      if (remote !== CANONICAL_MPL2_SHA256) {
        problems.push(`mozilla.org now serves a text with digest ${remote}; the recorded ${CANONICAL_MPL2_SHA256} must not be changed without reviewing the licence body by hand`);
      }
    } else {
      console.log(`note: ${CANONICAL_URL} returned ${response.status}; the recorded digest was used`);
    }
  } catch (error) {
    console.log(`note: could not reach mozilla.org (${error.message}); the recorded digest was used`);
  }
}

if (problems.length === 0) {
  console.log('licence consistent in both places');
  console.log(`  package.json license = ${pkg.license}`);
  console.log(`  LICENSE body = canonical MPL-2.0 (${CANONICAL_MPL2_SHA256.slice(0, 12)}…, ${body?.length} bytes)`);
  console.log(`  provenance-split terms present (${REQUIRED_PHRASES.length} checked)`);
} else {
  console.log(`problems (${problems.length}):`);
  for (const line of problems) console.log(`  ${line}`);
}
process.exitCode = problems.length === 0 ? 0 : 1;
