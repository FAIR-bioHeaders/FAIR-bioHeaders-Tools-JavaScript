#!/usr/bin/env node
/**
 * Draft-pin freshness: are the revisions this build pinned still what the owning
 * repository publishes on its default branch?
 *
 * Advisory, and it gates nothing. The lane reads the vendored bytes under `drafts/`,
 * whose SHA-256 `src/drafts.js` re-verifies on every load, so a moved upstream changes
 * nothing about what this library does. What it changes is whether this repository's
 * description of the draft is still current - which is a thing to notice on a schedule,
 * not a thing to block released-contract acceptance with. Nothing here re-pins
 * anything: re-pinning is the deliberate act of changing the bytes, the commit and the
 * digest in the same commit as the prose that quotes them (`CONTRIBUTING.md`, "Changing
 * the draft lane").
 *
 *     node scripts/ci/draft-pin-freshness.mjs
 *     node scripts/ci/draft-pin-freshness.mjs --json draft-freshness.json
 *
 * This is not `scripts/ci/draft-pins.mjs --check`, and both are needed. That one reads a
 * local checkout of the owning repository at the pinned commit and confirms those bytes
 * are the bytes the pin names. This one asks the different question - what does the
 * default branch hold *now* - and answers it over HTTPS.
 *
 * Exit status:
 *   0  every pinned target matches live raw main, so the pins are current;
 *   1  at least one target has moved: re-pin deliberately. The readings this build
 *      reports are still valid evidence about the bytes they name;
 *   2  a check was unusable - the local copies do not match their own recorded digests,
 *      or a probe control failed - so no target is called current or drifted.
 *
 * Three details are not incidental:
 *
 * - the local copies are digested first. If `drafts/*.json` no longer equal the digests
 *   `drafts/provenance.json` states, every expectation below is meaningless, and saying
 *   "unusable" beats producing a confident answer;
 * - a nonsense path is fetched from each repository first and must return 404. Without
 *   that, a portal page or a soft-200 error document would produce a digest that differs
 *   from the pin, and the drift would be an artefact of a broken check rather than a fact
 *   about the draft;
 * - redirects are not followed. A digest taken after following a redirect describes
 *   whatever the redirect landed on, not the URL this build cites, which is how a renamed
 *   repository could make a dead citation look alive.
 *
 * Native JavaScript on `fetch` and `node:crypto`: no foreign runtime, and no dependency
 * outside this repository's own source.
 */

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DRAFT_DIR, DRAFT_TYPES, draftEntry, provenanceAsWritten, verifyDraftBytes } from '../../src/drafts.js';

/** The default-branch segment every pinned citation in this build uses. */
const RAW_MAIN_SEGMENT = '/main/';

/** A path no repository publishes, fetched once per repository before anything is judged. */
export const CONTROL_FILE = 'no-such-file-draft-pin-freshness-control.json';

/**
 * Every digest this build states for a draft, as a URL to probe plus what it expects.
 *
 * The FHT contract, the FHGM contract and the FHGM transport overlay are the three
 * pinned files under `drafts/`. A fourth kind of pin exists in the registry - the
 * owning repository's development-suite manifest, whose digest the draft-lane evidence
 * is a claim about - and it is included whenever the registry states it.
 *
 * `suiteManifest` and `suiteManifestSha256` are read from the registry as written, not
 * from `draftEntry()`: that view carries what the lane needs to compile a contract, and
 * a suite manifest is nothing the lane compiles.
 *
 * @param {string} type
 * @returns {Array<{type: string, part: string, repository: string, path: string, url: string, expected: string, commit: string|null, bytes: number|null}>}
 */
export function pinTargets(type) {
  const entry = draftEntry(type);
  if (entry === undefined) return [];
  const row = provenanceAsWritten().drafts[type] ?? {};
  const targets = [
    {
      type,
      part: 'contract',
      repository: entry.repository,
      path: entry.sourcePath,
      url: entry.citation,
      expected: entry.sha256,
      commit: entry.commit,
      bytes: entry.bytes ?? null,
    },
  ];
  if (typeof row.suiteManifest === 'string' && typeof row.suiteManifestSha256 === 'string') {
    targets.push({
      type,
      part: 'suite-manifest',
      repository: entry.repository,
      path: row.suiteManifest,
      url: `https://raw.githubusercontent.com/FAIR-bioHeaders/${entry.repository}${RAW_MAIN_SEGMENT}${row.suiteManifest}`,
      expected: row.suiteManifestSha256,
      commit: typeof row.suiteCommit === 'string' ? row.suiteCommit : (row.commit ?? null),
      bytes: typeof row.suiteManifestBytes === 'number' ? row.suiteManifestBytes : null,
    });
  }
  if (entry.overlay !== undefined) {
    targets.push({
      type,
      part: 'transport-overlay',
      repository: entry.repository,
      path: entry.overlay.sourcePath,
      url: entry.overlay.citation,
      expected: entry.overlay.sha256,
      commit: entry.overlay.commit,
      bytes: entry.overlay.bytes ?? null,
    });
  }
  return targets;
}

/**
 * The nonsense path for one repository, derived from the URL this build actually cites
 * rather than from a second hardcoded host, so the control probes the same endpoint.
 *
 * @param {string} url
 * @returns {string|null}
 */
export function controlUrlFor(url) {
  const at = url.indexOf(RAW_MAIN_SEGMENT);
  return at < 0 ? null : url.slice(0, at + RAW_MAIN_SEGMENT.length) + CONTROL_FILE;
}

/**
 * What one probe result means against one pin.
 *
 * @param {{expected: string, url: string, path: string, type: string, part: string, commit: string|null}} target
 * @param {{status: number, redirected: boolean, bytes: number|null, digest: string|null, error: string|null}} probe
 * @returns {{state: 'match'|'drift'|'unreachable'|'invalid-probe', message: string}}
 */
export function classify(target, probe) {
  const label = `${target.type} ${target.part}`;
  if (probe.error !== null) return { state: 'unreachable', message: `${label}: the request to ${target.url} failed: ${probe.error}` };
  if (probe.redirected) {
    return { state: 'invalid-probe', message: `${label}: ${target.url} answered ${probe.status}, a redirect. Its target was not fetched: a digest taken after following it would describe the redirect's destination, not the URL this build cites` };
  }
  if (probe.status === 404) {
    return { state: 'drift', message: `${label}: ${target.path} is not on the default branch at all (404), while this build pins ${target.expected.slice(0, 16)}…${target.commit === null ? '' : ` from ${target.commit.slice(0, 12)}`}. The path moved, or the default branch is no longer named main` };
  }
  if (probe.status !== 200) {
    return { state: 'invalid-probe', message: `${label}: ${target.url} answered ${probe.status}, which is not an answer about this file. Nothing was compared` };
  }
  if (probe.digest === null) {
    return { state: 'invalid-probe', message: `${label}: ${target.url} answered 200 with ${probe.bytes} bytes, so there is no digest to compare. An empty or truncated response is not the file` };
  }
  if (probe.digest === target.expected) {
    return { state: 'match', message: `${label}: live main ${probe.digest.slice(0, 16)}… (${probe.bytes} bytes) equals the pin this build states` };
  }
  return {
    state: 'drift',
    message: `${label}: live main holds ${probe.digest.slice(0, 16)}… (${probe.bytes} bytes); this build pins ${target.expected.slice(0, 16)}…${target.commit === null ? '' : ` at ${target.commit.slice(0, 12)}`}. The draft moved and this build was not re-pinned. The reading stays evidence about the pinned bytes; re-pin deliberately, in the commit that changes the prose that quotes it`,
  };
}

/**
 * The URL of the same path at the pinned commit, for corroborating a 404 on main.
 *
 * @param {{url: string, commit: string|null}} target
 * @returns {string|null}
 */
export function commitUrlFor(target) {
  if (typeof target.commit !== 'string' || target.commit.length === 0) return null;
  const at = target.url.indexOf(RAW_MAIN_SEGMENT);
  return at < 0 ? null : `${target.url.slice(0, at)}/${target.commit}/${target.url.slice(at + RAW_MAIN_SEGMENT.length)}`;
}

/**
 * A 404 on main has two very different causes, and only one of them is a moved draft:
 * the file may have left main, or the path may simply not exist any more because the
 * repository was renamed, made private or restructured. Fetching the same path at the
 * pinned commit tells them apart, because the commit is immutable.
 *
 * @param {object} target
 * @param {{message: string}} drift the 404 verdict it replaces
 * @param {{status: number, redirected: boolean, digest: string|null, bytes: number|null, error: string|null}} probeResult
 * @returns {{state: 'match'|'drift'|'unreachable'|'invalid-probe', message: string}}
 */
export function corroborate(target, drift, probeResult) {
  const label = `${target.type} ${target.part}`;
  if (probeResult.error !== null) return { state: 'invalid-probe', message: `${label}: main answered 404 and the pinned commit could not be checked (${probeResult.error}), so this says nothing about the draft` };
  if (probeResult.redirected) return { state: 'invalid-probe', message: `${label}: main answered 404 and the commit URL redirected, so the endpoint is not answering about this path` };
  if (probeResult.status === 200 && probeResult.digest !== null) {
    const agrees = probeResult.digest === target.expected;
    return {
      state: 'drift',
      message: `${drift.message}; corroborated at the pinned commit, which still serves these bytes (${probeResult.digest.slice(0, 16)}…${agrees ? ', equal to the pin' : ', NOT equal to the pin - this build\'s own commit and digest disagree'})`,
    };
  }
  return {
    state: 'invalid-probe',
    message: `${label}: neither main nor the pinned commit serves ${target.path} (${probeResult.status}). A moved draft and a renamed or unavailable repository look the same from here, so no verdict is given`,
  };
}

/**
 * The whole comparison against an injected probe, so the decision logic is testable
 * without a network and the reporting cannot disagree with the fetching.
 *
 * @param {(url: string) => Promise<{status: number, redirected: boolean, bytes: number|null, digest: string|null, error: string|null}>} probe
 * @param {string[]} [types] the draft types to ask about
 * @param {string} [dir] where the pinned draft bytes live, so the local pre-check can be
 *   exercised against a copy instead of the vendored tree
 * @returns {Promise<{local: {ok: boolean, problems: unknown[]}, controls: Array<{url: string, status: number|'error', ok: boolean, note: string}>, rows: Array<object>, counts: Record<string, number>, ok: boolean, fatal: string|null}>}
 */
export async function evaluatePins(probe, types = DRAFT_TYPES, dir = DRAFT_DIR) {
  return compareTargets(probe, types.flatMap((type) => pinTargets(type)), dir);
}

/**
 * The comparison for an explicit target list. Separated from `evaluatePins` so a caller
 * - a test, or a live demonstration that the drift branch really fires - can supply
 *   targets without going through the registry.
 *
 * @param {Function} probe
 * @param {Array<object>} targets
 * @param {string} [dir]
 */
export async function compareTargets(probe, targets, dir = DRAFT_DIR) {
  // Step 1: the local claim. If the shipped bytes are not the pinned bytes, a statement
  // about "the pin" has no referent.
  const problems = verifyDraftBytes(dir);
  if (problems.length > 0) {
    return {
      local: { ok: false, problems },
      controls: [],
      rows: [],
      counts: {},
      ok: false,
      fatal: `this build's own drafts/ copies do not match drafts/provenance.json (${problems.map((problem) => `${problem.file}: ${problem.actual === null ? 'missing' : 'digest differs'}`).join(', ')}); nothing is reported about live main`,
    };
  }

  const controls = [];
  for (const url of [...new Set(targets.map((target) => controlUrlFor(target.url)).filter((url) => url !== null))]) {
    const result = await probe(url);
    const ok = result.status === 404 && !result.redirected && result.error === null;
    controls.push({
      url,
      status: result.error === null ? result.status : 'error',
      ok,
      note: ok
        ? 'a path this repository does not publish returns 404 from this endpoint, so a 200 below is an answer about the file'
        : `expected 404, saw ${result.error === null ? (result.redirected ? `redirect ${result.status}` : result.status) : result.error}: every verdict below would be meaningless`,
    });
  }
  const failed = controls.filter((control) => !control.ok);
  if (failed.length > 0) {
    return {
      local: { ok: true, problems: [] },
      controls,
      rows: [],
      counts: {},
      ok: false,
      fatal: `the probe control failed (${failed.map((control) => control.url).join(', ')}); no target is reported as current or as drifted`,
    };
  }

  /** @type {Array<object>} */
  const rows = [];
  for (const target of targets) {
    const result = await probe(target.url);
    let verdict = classify(target, result);
    let corroboratedAt = null;
    if (verdict.state === 'drift' && result.status === 404) {
      const url = commitUrlFor(target);
      if (url !== null) {
        const atCommit = await probe(url);
        corroboratedAt = url;
        verdict = corroborate(target, verdict, atCommit);
      }
    }
    rows.push({
      ...target,
      ...verdict,
      status: result.error === null ? (result.redirected ? 'redirect' : result.status) : 'error',
      liveDigest: result.digest,
      liveBytes: result.bytes,
      corroboratedAt,
    });
  }
  const counts = {};
  for (const row of rows) counts[row.state] = (counts[row.state] ?? 0) + 1;
  const fatal = rows.some((row) => row.state === 'invalid-probe' || row.state === 'unreachable')
    ? 'one or more probes were not usable, so those pins are neither confirmed current nor reported as drifted'
    : null;
  return { local: { ok: true, problems: [] }, controls, rows, counts, ok: fatal === null && (counts.drift ?? 0) === 0, fatal };
}

/**
 * The default probe: no redirect following, whole body read, SHA-256 of the exact bytes.
 *
 * @param {string} url
 */
async function fetchProbe(url) {
  try {
    const response = await fetch(url, { redirect: 'manual' });
    if (response.type === 'opaqueredirect' || [301, 302, 303, 307, 308].includes(response.status)) {
      return { status: response.status, redirected: true, bytes: null, digest: null, error: null };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      status: response.status,
      redirected: false,
      bytes: buffer.byteLength,
      digest: buffer.byteLength === 0 ? null : createHash('sha256').update(buffer).digest('hex'),
      error: null,
    };
  } catch (error) {
    return { status: 0, redirected: false, bytes: null, digest: null, error: error instanceof Error ? error.message : String(error) };
  }
}

const LABEL = { match: 'MATCH  ', drift: 'DRIFT  ', 'invalid-probe': 'INVALID', unreachable: 'ERROR  ' };

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`;
if (isMain) {
  const report = await evaluatePins(fetchProbe);
  console.log('draft-pin freshness - advisory. This build reads drafts/ bytes pinned by commit and SHA-256;');
  console.log('this compares those digests with what each owning repository publishes on its default branch.');
  console.log('a DRIFT is a signal to re-pin deliberately. It changes nothing about a reading, and it repairs nothing here.\n');
  console.log(`local check: ${report.local.ok ? 'every drafts/ copy matches the digest this build states' : 'FAILED - see the reason below'}`);
  if (report.controls.length > 0) {
    console.log('controls (a probe that cannot fail cannot pass):');
    for (const control of report.controls) console.log(`  ${control.ok ? 'ok   ' : 'FAIL '} ${control.url} -> ${control.status}; ${control.note}`);
  }
  console.log('');
  for (const row of report.rows) console.log(`${LABEL[row.state] ?? row.state} ${row.message}`);
  const summary = Object.entries(report.counts).map(([state, count]) => `${state} ${count}`).join(', ');
  console.log(`\n${report.rows.length} pinned target(s) compared: ${summary === '' ? 'nothing compared' : summary}`);

  const jsonAt = process.argv.indexOf('--json');
  if (jsonAt >= 0) {
    const path = resolve(process.argv[jsonAt + 1] ?? 'draft-freshness.json');
    writeFileSync(path, `${JSON.stringify({ generatedBy: 'scripts/ci/draft-pin-freshness.mjs', advisory: true, autoRepin: false, ...report }, null, 2)}\n`);
    console.log(`report written: ${path}`);
  }

  const inActions = process.env.GITHUB_ACTIONS === 'true';
  if (report.fatal !== null) {
    console.error(`\n${report.fatal}`);
    if (inActions) console.error('::error title=Draft-pin freshness inconclusive::the probe was not usable, so no pin was judged');
    process.exitCode = 2;
  } else if (!report.ok) {
    console.error('\na pinned draft is not what the owning repository publishes on its default branch. Re-pin deliberately (this repository\'s #2); this job is advisory, so CI does not gate on it.');
    if (inActions) {
      const first = report.rows.find((row) => row.state === 'drift');
      console.error(`::warning title=Stale draft pin (${first.type} ${first.part})::live main ${first.liveDigest ?? 'unavailable'}; this build pins ${first.expected} at ${first.commit ?? 'unknown'}. Advisory only: nothing was re-pinned.`);
    }
    process.exitCode = 1;
  } else {
    console.log('\nevery pin this build states is still what the owning repository publishes on its default branch');
  }
}
