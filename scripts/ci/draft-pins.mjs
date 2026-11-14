#!/usr/bin/env node
/**
 * CI glue for the draft-lane job: read the pins this build carries, and check the
 * draft bytes of a checked-out development repository against them.
 *
 * The substantive checks live here rather than in inline shell, so they can be
 * run - and their failure messages read - the same way locally:
 *
 *     node scripts/ci/draft-pins.mjs --github-output
 *     node scripts/ci/draft-pins.mjs --check .upstream/FHT-Specification .upstream/FHGM-Specification
 *     node scripts/ci/draft-pins.mjs
 *
 * `--check` compares the file at the given checkout against the pinned digest and
 * exits 1 on drift. It does not fetch anything and does not care which branch the
 * checkout is on: the job checks out the pinned commit, and this confirms it.
 */

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DRAFT_TYPES, draftEntry } from '../../src/drafts.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where each draft contract sits, relative to a checkout of its owning repository. */
function pathInCheckout(type) {
  return draftEntry(type).sourcePath;
}

const args = process.argv.slice(2);

if (args.includes('--github-output')) {
  const lines = [];
  for (const type of DRAFT_TYPES) {
    const entry = draftEntry(type);
    const key = type.toLowerCase();
    lines.push(`${key}-commit=${entry.commit}`);
    lines.push(`${key}-repo=${entry.repository}`);
    lines.push(`${key}-path=${entry.sourcePath}`);
    lines.push(`${key}-sha256=${entry.sha256}`);
  }
  const output = process.env.GITHUB_OUTPUT;
  console.log(lines.join('\n'));
  if (output) {
    // Appending rather than writing: a step may already have put keys in the file.
    appendFileSync(output, `${lines.join('\n')}\n`);
  }
  process.exitCode = 0;
} else if (args[0] === '--check') {
  const targets = args.slice(1);
  if (targets.length !== DRAFT_TYPES.length) {
    console.error(`--check wants one checkout path per pinned draft (${DRAFT_TYPES.join(', ')}), got ${targets.length}`);
    process.exit(2);
  }
  let drift = 0;
  DRAFT_TYPES.forEach((type, index) => {
    const entry = draftEntry(type);
    const path = join(resolve(targets[index]), pathInCheckout(type));
    if (!existsSync(path)) {
      console.error(`${type}: ${path} is not in that checkout`);
      drift += 1;
      return;
    }
    const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
    const same = actual === entry.sha256;
    console.log(`${type}: pinned ${entry.sha256.slice(0, 16)}… at ${entry.commit.slice(0, 12)}, checkout ${actual.slice(0, 16)}… ${same ? 'MATCH' : 'DRIFT'}`);
    if (!same) drift += 1;
  });
  if (drift > 0) {
    console.error(`${drift} draft pin(s) do not match the checked-out bytes: the lane would read something other than what it names`);
    process.exit(1);
  }
  console.log('every checked-out draft byte string matches the pin this build states');
} else {
  for (const type of DRAFT_TYPES) {
    const entry = draftEntry(type);
    console.log(`${type}\t${entry.repository}\t${entry.commit}\t${entry.sha256}\t${entry.sourcePath}`);
  }
}
