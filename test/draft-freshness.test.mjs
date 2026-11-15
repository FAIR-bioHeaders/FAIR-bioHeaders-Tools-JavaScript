/**
 * The draft-pin freshness comparison, tested without a network.
 *
 * `scripts/ci/draft-pin-freshness.mjs` is advisory in CI - it gates nothing - so its whole
 * value is the correctness of its decision logic. Four properties are checked here against
 * an injected probe rather than against GitHub:
 *
 * - a probe that cannot fail cannot pass: when the nonsense-path control does not return
 *   404, no target is judged at all;
 * - the local claim is checked first: if `drafts/` no longer matches the digests
 *   `drafts/provenance.json` states, every expectation about "the pin" has no referent, and
 *   the run says so without making a request;
 * - a redirect, a non-200 and an empty 200 are an unusable probe, never a match and never
 *   drift, because each is the endpoint failing rather than the draft moving;
 * - only exact digest equality is a match, and a drift names both digests without claiming
 *   that anything was repaired.
 *
 * The live run is the separate, documented thing: `node scripts/ci/draft-pin-freshness.mjs`
 * with network access, whose output a status comment quotes. A test here must not depend on
 * it, because a moved draft would then break the suite of a repository that does not read
 * those bytes at run time.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { classify, commitUrlFor, controlUrlFor, corroborate, evaluatePins, pinTargets } from '../scripts/ci/draft-pin-freshness.mjs';
import { DRAFT_TYPES, draftEntry, draftProvenance } from '../src/drafts.js';

/** SHA-256 the way the script computes it, so a probe answer is a real digest. */
const digest = (text) => createHash('sha256').update(text).digest('hex');

const target = (overrides = {}) => ({
  type: 'FHT',
  part: 'contract',
  repository: 'FHT-Specification',
  path: 'fht.json',
  url: 'https://raw.githubusercontent.com/FAIR-bioHeaders/FHT-Specification/main/fht.json',
  expected: 'a'.repeat(64),
  commit: 'b'.repeat(40),
  bytes: 29430,
  ...overrides,
});

const probeResult = (overrides = {}) => ({
  status: 200,
  redirected: false,
  bytes: 12,
  digest: 'a'.repeat(64),
  error: null,
  ...overrides,
});

/** The answers that make every pinned target read as current, plus a 404 control each. */
function currentAnswers(types = DRAFT_TYPES) {
  const answers = {};
  for (const type of types) {
    for (const row of pinTargets(type)) {
      answers[row.url] = probeResult({ digest: row.expected, bytes: row.bytes });
      const control = controlUrlFor(row.url);
      if (control !== null) answers[control] = probeResult({ status: 404, digest: null, bytes: null });
    }
  }
  return answers;
}

const injected = (answers) => async (url) => answers[url] ?? probeResult({ status: 404, digest: null, bytes: null });

describe('classify', () => {
  it('says match only on an exact digest equality', () => {
    assert.equal(classify(target(), probeResult()).state, 'match');
    assert.equal(classify(target(), probeResult({ digest: 'c'.repeat(64) })).state, 'drift');
    // One hex character of difference is a different file, and must not round to a match.
    assert.equal(classify(target(), probeResult({ digest: `${'a'.repeat(63)}b` })).state, 'drift');
  });

  it('names both digests when it reports drift, and says what the reading still is', () => {
    const verdict = classify(target(), probeResult({ digest: 'e'.repeat(64), bytes: 30000 }));
    assert.equal(verdict.state, 'drift');
    assert.match(verdict.message, /live main holds e{16}… \(30000 bytes\)/);
    assert.match(verdict.message, /this build pins a{16}… at b{12}/);
    assert.match(verdict.message, /evidence about the pinned bytes/);
    assert.match(verdict.message, /re-pin deliberately/i);
    assert.doesNotMatch(verdict.message, /repinned|has been updated|repaired/i, 'the check never claims to have repaired anything');
  });

  it('refuses to read a redirect as either a match or a drift', () => {
    const verdict = classify(target(), probeResult({ redirected: true, status: 301, digest: null, bytes: null }));
    assert.equal(verdict.state, 'invalid-probe');
    assert.match(verdict.message, /describe the redirect's destination/);
  });

  it('refuses a soft-200 and an empty 200, and calls a transport failure unreachable', () => {
    assert.equal(classify(target(), probeResult({ status: 203, digest: 'a'.repeat(64) })).state, 'invalid-probe');
    assert.equal(classify(target(), probeResult({ status: 500, digest: null, bytes: 0 })).state, 'invalid-probe');
    assert.equal(classify(target(), probeResult({ status: 200, digest: null, bytes: 0 })).state, 'invalid-probe', 'a 200 with no bytes is not the file');
    assert.equal(classify(target(), probeResult({ status: 0, digest: null, bytes: null, error: 'socket hang up' })).state, 'unreachable');
  });

  it('reports a vanished path as drift, with the cause left open', () => {
    const verdict = classify(target(), probeResult({ status: 404, digest: null, bytes: null }));
    assert.equal(verdict.state, 'drift');
    assert.match(verdict.message, /is not on the default branch at all \(404\)/);
    assert.match(verdict.message, /The path moved, or the default branch is no longer named main/);
  });
});

describe('corroborate', () => {
  const drift404 = classify(target(), probeResult({ status: 404, digest: null, bytes: null }));

  it('keeps the drift when the pinned commit still serves the pinned bytes', () => {
    const verdict = corroborate(target(), drift404, probeResult({ digest: 'a'.repeat(64), bytes: 29430 }));
    assert.equal(verdict.state, 'drift');
    assert.match(verdict.message, /corroborated at the pinned commit/);
    assert.match(verdict.message, /equal to the pin/);
  });

  it("says plainly when a build's own commit and digest disagree", () => {
    const verdict = corroborate(target(), drift404, probeResult({ digest: 'c'.repeat(64), bytes: 29430 }));
    assert.equal(verdict.state, 'drift');
    assert.match(verdict.message, /NOT equal to the pin/);
  });

  it('withholds the verdict when neither main nor the commit serves the path', () => {
    const verdict = corroborate(target(), drift404, probeResult({ status: 404, digest: null, bytes: null }));
    assert.equal(verdict.state, 'invalid-probe', 'a renamed or private repository is not evidence about a draft');
    assert.match(verdict.message, /no verdict is given/);
  });
});

describe('controlUrlFor and commitUrlFor', () => {
  it('derive from the URL this build cites, not from a second hardcoded host', () => {
    assert.equal(
      controlUrlFor(target().url),
      'https://raw.githubusercontent.com/FAIR-bioHeaders/FHT-Specification/main/no-such-file-draft-pin-freshness-control.json',
    );
    assert.equal(commitUrlFor(target()), `https://raw.githubusercontent.com/FAIR-bioHeaders/FHT-Specification/${'b'.repeat(40)}/fht.json`);
    assert.equal(controlUrlFor('https://example.org/whatever.json'), null, 'a URL with no /main/ segment gets no control');
    assert.equal(commitUrlFor(target({ commit: null })), null, 'a target with no commit gets no corroboration');
  });
});

describe('pinTargets', () => {
  it('covers every digest this build states for a draft', () => {
    const parts = Object.fromEntries(DRAFT_TYPES.map((type) => [type, pinTargets(type).map((row) => row.part)]));
    assert.deepEqual(parts, { FHT: ['contract', 'suite-manifest'], FHGM: ['contract', 'transport-overlay'] });

    for (const type of DRAFT_TYPES) {
      const entry = draftEntry(type);
      const contract = pinTargets(type).find((row) => row.part === 'contract');
      assert.equal(contract.url, entry.citation, `${type}: the contract target is the cited raw-main URL`);
      assert.equal(contract.expected, entry.sha256, `${type}: and its expected digest is the pinned one`);
      assert.equal(contract.commit, entry.commit);
    }

    const overlay = pinTargets('FHGM').find((row) => row.part === 'transport-overlay');
    assert.equal(overlay.expected, draftEntry('FHGM').overlay.sha256, 'the FHGM transport overlay is a pinned target too');
    assert.equal(overlay.url, draftEntry('FHGM').overlay.citation);

    const suite = pinTargets('FHT').find((row) => row.part === 'suite-manifest');
    const row = draftProvenance.drafts.FHT;
    assert.equal(suite.url, `https://raw.githubusercontent.com/FAIR-bioHeaders/${row.repository}/main/${row.suiteManifest}`);
    assert.equal(suite.expected, row.suiteManifestSha256, 'the suite manifest is judged against the digest the registry records');
    assert.equal(suite.commit, row.suiteCommit, 'and attributed to the suite revision, not the contract revision');
  });

  it('states no release form for a draft anywhere in the target list', () => {
    for (const type of DRAFT_TYPES) {
      for (const row of pinTargets(type)) {
        assert.doesNotMatch(row.url, /w3id\.org|\/v\d+\.\d+/, `${type} ${row.part}: ${row.url} is release-shaped, and a draft has no release form (rule V7)`);
      }
    }
  });
});

describe('evaluatePins', () => {
  it('refuses to answer at all when the control does not return 404', async () => {
    // A captive portal, or an endpoint that soft-200s everything: without the control this
    // reads as "every pin has drifted"; with it, it reads as "the check is broken".
    const everything = async () => probeResult({ digest: digest('login page'), bytes: 10 });
    const report = await evaluatePins(everything);
    assert.match(String(report.fatal), /probe control failed/);
    assert.deepEqual(report.rows, [], 'no pin is judged when the control did not answer 404');
    assert.equal(report.ok, false);
    assert.equal(report.controls.every((control) => control.ok), false);
    assert.equal(report.controls.length, 2, 'one control per owning repository');
  });

  it('runs the local pre-check first and stops there when it fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fhr-freshness-pin-'));
    try {
      for (const type of DRAFT_TYPES) {
        const entry = draftEntry(type);
        copyFileSync(entry.path, join(dir, entry.file));
        if (entry.overlay !== undefined) copyFileSync(entry.overlay.path, join(dir, entry.overlay.file));
      }
      const clean = await evaluatePins(injected(currentAnswers()), DRAFT_TYPES, dir);
      assert.equal(clean.local.ok, true, 'and on the committed bytes the local check passes');
      assert.deepEqual(clean.counts, { match: 4 });

      // One byte appended to one vendored copy: the digests this build states are now
      // false about its own tree, so no statement about live main can mean anything.
      const victim = draftEntry('FHGM');
      writeFileSync(join(dir, victim.file), `${readFileSync(join(dir, victim.file), 'utf8')} `);
      let called = 0;
      const counting = async () => {
        called += 1;
        return probeResult({ status: 404, digest: null, bytes: null });
      };
      const report = await evaluatePins(counting, DRAFT_TYPES, dir);
      assert.equal(report.local.ok, false);
      assert.match(String(report.fatal), /do not match drafts\/provenance\.json/);
      assert.deepEqual(report.rows, []);
      assert.equal(report.controls.length, 0, 'no request went out at all');
      assert.equal(called, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports every target current when live main still matches', async () => {
    const report = await evaluatePins(injected(currentAnswers()));
    assert.equal(report.fatal, null);
    assert.equal(report.ok, true);
    assert.equal(report.rows.length, 4, 'FHT contract + suite manifest, FHGM contract + transport overlay');
    assert.deepEqual(report.counts, { match: 4 });
    for (const row of report.rows) assert.equal(row.state, 'match', `${row.type} ${row.part}: ${row.message}`);
    assert.equal(report.rows.every((row) => row.state !== 'drift'), true);
  });

  it('flags one moved target without touching the others', async () => {
    const answers = currentAnswers();
    const overlay = pinTargets('FHGM').find((row) => row.part === 'transport-overlay');
    answers[overlay.url] = probeResult({ digest: digest('the overlay moved'), bytes: 1400 });
    const report = await evaluatePins(injected(answers));
    assert.equal(report.ok, false);
    assert.equal(report.fatal, null, 'a real drift is a finding, not a broken check');
    assert.deepEqual(report.counts, { match: 3, drift: 1 });
    const drifted = report.rows.find((row) => row.state === 'drift');
    assert.deepEqual([drifted.type, drifted.part], ['FHGM', 'transport-overlay']);
    for (const row of report.rows.filter((each) => each.state !== 'drift')) {
      assert.equal(row.state, 'match', `${row.type} ${row.part} was judged on someone else's drift`);
    }
  });

  it('turns an unusable probe into a fatal, never a pass', async () => {
    const answers = currentAnswers();
    const fht = pinTargets('FHT').find((row) => row.part === 'contract');
    answers[fht.url] = probeResult({ redirected: true, status: 302, digest: null, bytes: null });
    const report = await evaluatePins(injected(answers));
    assert.match(String(report.fatal), /not usable/);
    assert.equal(report.ok, false);
    assert.deepEqual(report.counts, { match: 3, 'invalid-probe': 1 });
  });

  it('corroborates a 404 against the pinned commit inside the run', async () => {
    const answers = currentAnswers();
    const fht = pinTargets('FHT').find((row) => row.part === 'contract');
    answers[fht.url] = probeResult({ status: 404, digest: null, bytes: null });
    answers[commitUrlFor(fht)] = probeResult({ digest: fht.expected, bytes: fht.bytes });
    const moved = await evaluatePins(injected(answers));
    const row = moved.rows.find((each) => each.type === 'FHT' && each.part === 'contract');
    assert.equal(row.state, 'drift');
    assert.match(row.message, /corroborated at the pinned commit/);

    const dead = currentAnswers();
    dead[fht.url] = probeResult({ status: 404, digest: null, bytes: null });
    dead[commitUrlFor(fht)] = probeResult({ status: 404, digest: null, bytes: null });
    const report = await evaluatePins(injected(dead));
    const other = report.rows.find((each) => each.type === 'FHT' && each.part === 'contract');
    assert.equal(other.state, 'invalid-probe');
    assert.match(String(report.fatal), /not usable/, 'an inconclusive probe is reported as inconclusive');
  });

  it('asks only the URLs the registry itself states', async () => {
    const asked = [];
    const spy = async (url) => {
      asked.push(url);
      const answers = currentAnswers();
      return answers[url] ?? probeResult({ status: 404, digest: null, bytes: null });
    };
    const report = await evaluatePins(spy);
    assert.equal(report.ok, true);
    const expected = new Set();
    for (const type of DRAFT_TYPES) {
      for (const row of pinTargets(type)) {
        expected.add(row.url);
        expected.add(controlUrlFor(row.url));
      }
    }
    assert.deepEqual(
      asked.filter((url) => !expected.has(url)),
      [],
      'the run fetched something the registry never named',
    );
    for (const url of expected) assert.ok(asked.includes(url), `${url} was never probed`);
    assert.ok(asked.some((url) => /no-such-file-draft-pin-freshness-control\.json$/.test(url)), 'the nonsense-path control is part of every run');
  });
});
