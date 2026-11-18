#!/usr/bin/env node
/**
 * Differential check of this library's header-YAML reader against the released
 * Python toolkit, on the same scalars.
 *
 * The reference is `bioheaders.load_yaml` plus `bioheaders.check_finite` from
 * the installed `fair-bioheaders` distribution, not a checkout: merged is not
 * released. For each scalar both implementations are asked the same question —
 * does `k: <scalar>` survive the YAML stage, R8/R12/R13 included — and any
 * disagreement is printed. That is the behaviour the shared R12 and R13 vectors
 * exercise, checked far beyond the handful of scalars the suite names.
 *
 * With `--sweep` the named corpus is extended by a deterministic combination
 * sweep (short strings built from the characters the YAML resolvers dispatch on),
 * which is where a hand-written table is most likely to be wrong.
 *
 * Without a Python that can import `bioheaders` the script exits 3 and says so;
 * it never reports a pass it did not compute.
 *
 *     FHR_PYTHON=/path/to/.venvs/converter-0.12.0/bin/python \
 *       node scripts/capability/yaml-portability-differential.mjs [--sweep]
 *
 * Recorded output: `docs/CAPABILITY.md`.
 */

import { execFileSync } from 'node:child_process';

import { HeaderError } from '../../src/errors.js';
import { loadHeaderYaml } from '../../src/yaml.js';

/**
 * The scalars rules R12 and R13 name, the values the shared vectors use, and the
 * neighbours a hand-written resolution table usually gets wrong.
 */
const SCALARS = [
  '010', '017', '0010', '0', '-0', '+0', '10', '0x1f', '0x0', '0b101', '0o17', '1_000', '1:30', '10:30:00', '1:2:3',
  'yes', 'no', 'on', 'off', 'y', 'n', 'Yes', 'NO', 'On', 'OFF', 'Y', 'N', 'true', 'True', 'TRUE', 'false', 'FALSE',
  '1e3', '1.5e3', '1.5e+3', '1.5e-3', '1.0', '2.10', '0.42', '.5', '5.', '-1_0',
  '~', 'null', 'Null', 'NULL', 'nan', 'NaN', '.nan', '.inf', '-.inf', '+.inf', 'inf', 'Infinity',
  '2026-10-11', '2026-10-11T00:00:00Z', '10:30', 'not-masked', 'GCA_000001405.29', 'x-abc', '"a b"', '-', '+', '_', '*',
  '9007199254740993', '-9223372036854775808', '1.7976931348623157e309', 'diptera_odb12.2', 'orcid:0000-0002-1825-0097',
  '!!str x', '&anc  x', '*anc', '<<', '"yes"', "'010'", '"\\x3E"', '"\\x40"', '|-\n  block', '>-\n  folded',
  '2026-10-11 10:30:00', '0.0.0.0', '+.5', '0b', '0o', '0x', ':', '?:', '? a', '.inf.',
  'release.nan', 'build.NaN', 'x.NAN', 'a.inf', 'b-.inf', '-.nan', '+.nan', '.Nan', '1.nan',
];

const python = process.env.FHR_PYTHON ?? 'python3';

/**
 * Deterministic combination sweep: every string of length 1 to 3 over the
 * characters the two resolvers dispatch on (digits, signs, `.`/`_`, the exponent
 * and radix letters, boolean initials, YAML indicators), minus the shapes that
 * would make the *test line* something other than one plain scalar.
 *
 * @returns {string[]}
 */
function sweepScalars() {
  const alphabet = ['0', '1', '8', '9', '-', '+', '.', '_', 'e', 'E', 'x', 'X', 'o', 'b', ':', 'y', 'Y', 'n', 'N', 't', 'T', 'f', 'F', 'r', 'u', 'l', 's', 'S', '~', '=', '<', '!', '&', '*', '|', '>', '%', ',', '?', 'a', 'z', ' ', 'g', 'G', 'd', 'A'];
  const out = new Set();
  const push = (text) => {
    if (text === '' || text.length > 3) return;
    if (text.startsWith(' ') || text.endsWith(' ')) return; // trailing space is stripped by the parser, not resolved
    if (/^[&*!|>%@`]/.test(text)) return; // node properties and reserved indicators: a parse error in both readers
    if (text.includes(': ') || text.endsWith(':')) return; // would turn the test line into a nested mapping
    if (text.includes('#')) return; // comment introduction
    out.add(text);
  };
  for (const a of alphabet) {
    push(a);
    for (const b of alphabet) {
      push(a + b);
      for (const c of alphabet) push(a + b + c);
    }
  }
  return [...out].sort();
}

const CORPUS = process.argv.includes('--sweep') ? [...new Set([...SCALARS, ...sweepScalars()])] : SCALARS;

const script = `
import json, sys
from bioheaders import load_yaml, check_finite, __version__
out = {"version": __version__, "accepts": {}}
for text in json.loads(sys.stdin.read()):
    try:
        # The analogue of this library's loadHeaderYaml: the toolkit enforces R8
        # and R12 while loading and R13 in check_finite, both before validation.
        check_finite(load_yaml("k: " + text))
        out["accepts"][text] = True
    except Exception:
        out["accepts"][text] = False
print(json.dumps(out))
`;

/** @type {{version: string, accepts: Record<string, boolean>}} */
let reference;
try {
  reference = JSON.parse(
    execFileSync(python, ['-c', script], { input: JSON.stringify(CORPUS), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }),
  );
} catch (error) {
  console.error(`${python} cannot import bioheaders: ${String(error.message).split('\n')[0]}`);
  console.error('set FHR_PYTHON to an environment with the released fair-bioheaders installed');
  process.exit(3);
}

/**
 * @param {string} text
 * @returns {boolean} whether this library reads `k: <text>`
 */
function jsAccepts(text) {
  try {
    loadHeaderYaml(`k: ${text}`);
    return true;
  } catch (error) {
    if (error instanceof HeaderError) return false;
    throw error;
  }
}

let differences = 0;
const rows = [];
for (const text of CORPUS) {
  const toolkit = reference.accepts[text];
  const js = jsAccepts(text);
  if (toolkit !== js) differences += 1;
  rows.push(`${toolkit === js ? 'agree ' : 'DIFFER'}  ${JSON.stringify(`k: ${text}`).padEnd(34)} fair-bioheaders ${reference.version}: ${String(toolkit).padEnd(6)} this library: ${js}`);
}
for (const line of rows.filter((text) => text.startsWith('DIFFER'))) console.log(line);
if (differences === 0) console.log('  (no DIFFER rows: every scalar in the corpus is read the same way)');
console.log(`\n${CORPUS.length} scalars compared against fair-bioheaders ${reference.version}, ${differences} disagreements`);
process.exitCode = differences === 0 ? 0 : 1;
