#!/usr/bin/env node
/**
 * The suite pin, verified against a checkout: the one owner of "is this the development
 * suite this build's draft-lane evidence is a claim about?".
 *
 * `drafts/provenance.json` states two revisions per draft and they are different claims.
 * `commit` pins the contract bytes this library compiles, and `scripts/ci/draft-pins.mjs
 * --check` confirms a checkout holds them. `suiteCommit`, `suiteManifest` and
 * `suiteManifestSha256` pin the owning repository's development conformance suite whose
 * manifest `scripts/capability/draft-vectors.mjs` executes. This module is what checks the
 * second pair. Before it existed, the suite fields were recorded and read by nothing, so
 * the draft-lane run printed the contract pin in its header while scoring whatever suite
 * happened to be in the directory it was pointed at.
 *
 * Division of labour, one owner per concern:
 *
 * | concern | owner | gating |
 * | --- | --- | --- |
 * | are the contract bytes in this checkout the bytes the pin names? | `scripts/ci/draft-pins.mjs --check` | yes, inside the labelled draft job |
 * | is the suite about to be executed the suite the pin names? | this module, through `scripts/capability/draft-vectors.mjs` | yes: a mismatch is exit 2 and nothing is scored |
 * | does the owning repository's **live default branch** still publish those bytes? | `scripts/ci/draft-pin-freshness.mjs` (#6) | no: advisory, because a draft legitimately moves |
 *
 * Nothing here fetches, and nothing here re-pins. A drift is a report, and re-pinning
 * stays the deliberate act `CONTRIBUTING.md` describes.
 *
 *     node scripts/ci/suite-pin.mjs --check <FHT checkout> [<FHGM checkout>]
 *
 * Exit status: 0 every stated suite pin verified; 1 a pin is stated and the bytes differ,
 * or a pin is stated only in part; 2 the arguments are unusable.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { DRAFT_TYPES, draftSuitePin } from '../../src/drafts.js';

/**
 * Digest one file the way the registry digests everything else.
 *
 * @param {string} path
 * @returns {string}
 */
export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Where a draft's suite manifest sits inside a checkout of its owning repository.
 *
 * The path comes from the registry (`suiteManifest`), never from a guess, and it is
 * resolved *inside* the checkout: a registry value that tried to escape it is refused
 * rather than followed.
 *
 * @param {{manifest: string|null}} pin
 * @param {string} repoPath
 * @returns {{path: string|null, problem: string|null}}
 */
export function manifestPathIn(pin, repoPath) {
  if (typeof pin.manifest !== 'string' || pin.manifest === '') return { path: null, problem: 'the pin states no manifest path' };
  const target = resolve(repoPath, pin.manifest);
  const root = resolve(repoPath);
  if (target !== root && !target.startsWith(root + require_sep())) {
    return { path: null, problem: `the pinned manifest path ${pin.manifest} resolves outside the checkout` };
  }
  return { path: target, problem: null };
}

/** Platform separator, kept in one place so the containment test is explicit. */
function require_sep() {
  return process.platform === 'win32' ? '\\' : '/';
}

/**
 * Verify one draft's suite pin against a checkout, using the pin the registry states.
 *
 * @param {string} type
 * @param {string} repoPath a checkout of the repository that owns the draft
 * @returns {ReturnType<typeof verifyAgainst>}
 */
export function verifySuitePin(type, repoPath) {
  return verifyAgainst(draftSuitePin(type), repoPath);
}

/**
 * Verify a checkout against one stated pin, in the shape `draftSuitePin()` returns.
 *
 * Apart from `verifySuitePin` so both directions of the comparison - bytes that match,
 * and bytes one character off - can be exercised without editing the registry or
 * injecting anything into the production path.
 *
 * @param {{type: string, repository: string|null, stated: boolean, partial: boolean, commit: string|null, manifest: string|null, sha256: string|null, vectors: number|null}} pin
 * @param {string} repoPath
 * @returns {{type: string, state: 'verified'|'drift'|'absent'|'unpinned'|'partial', path: string|null, expected: string|null, actual: string|null, message: string}}
 */
export function verifyAgainst(pin, repoPath) {
  const { type } = pin;
  if (pin.partial) {
    return {
      type,
      state: 'partial',
      path: null,
      expected: pin.sha256,
      actual: null,
      message: `${type}: drafts/provenance.json states an incomplete suite pin (commit ${pin.commit ?? 'none'}, manifest ${pin.manifest ?? 'none'}, sha256 ${pin.sha256 ?? 'none'}); a pin must state its commit, its manifest and its digest together, because a subset of them checks nothing`,
    };
  }
  if (!pin.stated) {
    return {
      type,
      state: 'unpinned',
      path: null,
      expected: null,
      actual: null,
      message: `${type}: no suite pin is stated, so nothing here can say which revision of the ${pin.repository ?? type} development suite a run scored. The contract pin still holds; the suite revision is unknown`,
    };
  }
  const { path, problem } = manifestPathIn(pin, repoPath);
  if (problem !== null) return { type, state: 'absent', path: null, expected: pin.sha256, actual: null, message: `${type}: ${problem}` };
  if (!existsSync(path)) {
    return { type, state: 'absent', path, expected: pin.sha256, actual: null, message: `${type}: ${path} holds no ${pin.manifest}; this checkout cannot be the suite pinned at ${pin.commit}` };
  }
  const actual = sha256File(path);
  if (actual !== pin.sha256) {
    return {
      type,
      state: 'drift',
      path,
      expected: pin.sha256,
      actual,
      message: `${type}: the suite manifest at ${path} digests to ${actual}, while drafts/provenance.json records ${pin.sha256} for ${pin.repository} ${pin.commit} (${pin.manifest}${pin.vectors === null ? '' : `, ${pin.vectors} vectors`}). This is not the suite this build's draft evidence names, so nothing is scored against it (rule V7)`,
    };
  }
  let counts = '';
  if (pin.vectors !== null) {
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (manifest.vectors.length !== pin.vectors) {
      return {
        type,
        state: 'drift',
        path,
        expected: pin.sha256,
        actual,
        message: `${type}: the manifest digest matches but it holds ${manifest.vectors.length} vectors while drafts/provenance.json records ${pin.vectors} for ${pin.commit}; the registry's count claim and its digest claim cannot both be true`,
      };
    }
    counts = `, ${pin.vectors} vectors`;
  }
  return {
    type,
    state: 'verified',
    path,
    expected: pin.sha256,
    actual,
    message: `${type}: suite manifest verified - ${pin.repository} ${pin.commit}, ${pin.manifest}${counts}, sha256 ${actual}`,
  };
}

/**
 * Verify every draft's suite pin against the checkouts a caller supplies.
 *
 * @param {Array<{type: string, path: string}>} checkouts one per draft type given
 * @returns {Array<ReturnType<typeof verifySuitePin>>}
 */
export function verifySuitePins(checkouts) {
  return checkouts.map(({ type, path }) => verifySuitePin(type, path));
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`;
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv[0] !== '--check') {
    console.error('usage: node scripts/ci/suite-pin.mjs --check <FHT checkout> [<FHGM checkout>]');
    process.exitCode = 2;
  } else {
    const targets = argv.slice(1);
    if (targets.length === 0 || targets.length > DRAFT_TYPES.length) {
      console.error(`--check wants one checkout path per draft type (${DRAFT_TYPES.join(', ')}), got ${targets.length}`);
      process.exitCode = 2;
    } else {
      // Positional, in registry order, the same convention `draft-pins.mjs --check` uses.
      const results = verifySuitePins(targets.map((path, index) => ({ type: DRAFT_TYPES[index], path: resolve(path) })));
      for (const result of results) console.log(`${result.type} ${result.state.toUpperCase().padEnd(8)} ${result.message}`);
      const blocking = results.filter((result) => result.state !== 'verified' && result.state !== 'unpinned');
      const unpinned = results.filter((result) => result.state === 'unpinned');
      if (unpinned.length > 0) console.log(`${unpinned.map((result) => result.type).join(', ')}: reported as unpinned, not as verified`);
      process.exitCode = blocking.length > 0 ? 1 : 0;
    }
  }
}
