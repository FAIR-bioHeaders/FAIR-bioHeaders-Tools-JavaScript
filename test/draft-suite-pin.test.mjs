/**
 * The suite pin, exposed and enforced.
 *
 * `drafts/provenance.json` states two revisions per draft: the contract bytes this build
 * compiles, and the development suite whose manifest the draft-lane runner executes. The
 * second pair used to be recorded and read by nothing, which let the runner print a
 * revision it had never checked - the draft-lane job cloned the contract commit, while the
 * registry's suite fields describe a later one. These tests cover both halves of the fix:
 * the fields are on the API (not only in the JSON), and the verification refuses a suite
 * whose bytes are not the bytes the pin names, in both directions.
 *
 * Every fixture here is a temporary directory. Nothing writes to `drafts/`, to
 * `drafts/provenance.json`, or to any other repository.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import * as publicApi from '../src/index.js';
import { DRAFT_TYPES, draftEntry, draftSuitePin } from '../src/drafts.js';
import { draftTreeWith, removeDraftTree } from '../testutil/draft-tree.mjs';
import { manifestPathIn, sha256File, verifyAgainst, verifySuitePin } from '../scripts/ci/suite-pin.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(readFileSync(join(ROOT, 'drafts', 'provenance.json'), 'utf8'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * A temporary stand-in for a checkout of a development repository.
 *
 * @param {string} manifest the path, relative to the checkout, to write
 * @param {Buffer|string} bytes what to put there
 */
function checkoutWith(manifest, bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'fhr-suite-pin-'));
  const path = join(dir, manifest);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return dir;
}

/** A stated pin over an arbitrary manifest body, so the match case is computable. */
const pinFor = (bytes, overrides = {}) => ({
  type: 'SYN',
  repository: 'Synthetic-Specification',
  stated: true,
  partial: false,
  commit: 'c'.repeat(40),
  manifest: 'conformance/manifest.json',
  sha256: digest(bytes),
  vectors: null,
  ...overrides,
});

describe('the suite pin on the API', () => {
  it('is reachable from the public entry point', () => {
    for (const name of ['draftEntry', 'draftSuitePin', 'draftSupport']) {
      assert.equal(typeof publicApi[name], 'function', `src/index.js must export ${name}()`);
    }
    assert.deepEqual(publicApi.draftSuitePin('FHT'), draftSuitePin('FHT'), 'the public view is the same pin view the tooling verifies against');
  });

  it('is present and non-null for every draft entry that declares one', () => {
    const declaring = DRAFT_TYPES.filter((type) => registry.drafts[type].suiteManifestSha256 !== undefined);
    assert.ok(declaring.length > 0, 'at least one draft must declare a suite pin, or this test proves nothing');
    for (const type of declaring) {
      const entry = draftEntry(type);
      const row = registry.drafts[type];
      assert.equal(typeof entry.suiteCommit, 'string', `${type}: suiteCommit must reach the API as a string`);
      assert.equal(typeof entry.suiteManifest, 'string', `${type}: suiteManifest must reach the API as a string`);
      assert.equal(typeof entry.suiteManifestSha256, 'string', `${type}: suiteManifestSha256 must reach the API as a string`);
      assert.match(entry.suiteCommit, /^[0-9a-f]{40}$/, `${type}: suiteCommit must be a full commit sha`);
      assert.match(entry.suiteManifestSha256, /^[0-9a-f]{64}$/, `${type}: suiteManifestSha256 must be a full sha256`);
      assert.equal(entry.suiteCommit, row.suiteCommit, `${type}: the API value is the registry value`);
      assert.equal(entry.suiteManifest, row.suiteManifest, `${type}: the API value is the registry value`);
      assert.equal(entry.suiteManifestSha256, row.suiteManifestSha256, `${type}: the API value is the registry value`);
      assert.equal(entry.suiteManifestBytes, row.suiteManifestBytes, `${type}: the byte count the registry states`);
      assert.equal(entry.suiteVectors, row.suiteVectors, `${type}: the vector count the registry states`);
      assert.deepEqual([...entry.suiteRules], [...row.suiteRules], `${type}: the rule labels the registry states`);
      assert.notEqual(entry.suiteCommit, entry.suiteManifestSha256, `${type}: a commit and a digest cannot be the same string`);
      assert.equal(entry.suiteManifestSha256.length, 64);
      // The suite manifest is a claim about another repository's tree, so it must not be
      // cited as a release form of the draft (rule V7).
      assert.doesNotMatch(entry.suiteManifest, /^https?:/, `${type}: suiteManifest is a path, not a URL`);
    }
  });

  it('is null, not missing, for a draft that declares none', async () => {
    // This build states a suite pin for both drafts, so the absence has to be
    // synthesised: a fixture copy whose registry has the FHGM suite fields taken out.
    // Asserting against the live registry here would be an empty loop that passes.
    const tree = draftTreeWith((registry) => {
      for (const field of ['suiteCommit', 'suiteManifest', 'suiteManifestSha256', 'suiteManifestBytes', 'suiteVectors', 'suiteRules']) {
        delete registry.drafts.FHGM[field];
      }
    });
    try {
      const { draftEntry, draftSuitePin: pinView, DRAFT_TYPES: types } = await tree.load('src/drafts.js');
      const undeclared = types.filter((type) => tree.registry.drafts[type].suiteManifestSha256 === undefined);
      assert.deepEqual(undeclared, ['FHGM'], 'the fixture states a suite pin for FHT and none for FHGM');
      for (const type of undeclared) {
        const entry = draftEntry(type);
        for (const field of ['suiteCommit', 'suiteManifest', 'suiteManifestSha256', 'suiteManifestBytes', 'suiteVectors', 'suiteRules']) {
          assert.ok(field in entry, `${type}.${field}: the key must exist so a consumer cannot mistake absence for a value`);
          assert.equal(entry[field], null, `${type}.${field}: no pin is stated, so the API must say null`);
        }
        assert.equal(pinView(type).stated, false, `${type}: the pin view says so too`);
        assert.equal(pinView(type).partial, false, `${type}: and it is an absence, not a half-written pin`);
      }
    } finally {
      removeDraftTree(tree);
    }
  });

  it('separates the FHT suite revision from the FHT contract revision', () => {
    const pin = draftSuitePin('FHT');
    const entry = draftEntry('FHT');
    assert.equal(pin.stated, true);
    assert.equal(pin.repository, 'FHT-Specification');
    assert.equal(pin.manifest, 'conformance/manifest.json');
    assert.equal(pin.commit, 'be9bcc825f55db92852fd882ffba4c1c214f53db');
    assert.equal(pin.sha256, '9fd8c0b2a4638d5ddc0bf9b5d1e96c66778b26bcf8f93975aafb707d8f2b702c');
    assert.equal(pin.vectors, 72);
    assert.equal(pin.bytes, 65615);
    assert.deepEqual([...pin.rules], ['C1', 'C2', 'C3']);
    assert.notEqual(pin.commit, entry.commit, 'the two revisions are different fields; where a draft pins the same commit for both, the registry repeats it on purpose');
    assert.equal(entry.suiteCommit, pin.commit);
  });

  it('separates the FHGM suite revision from the FHGM contract revision too', () => {
    // FHGM used to state no suite pin at all, so this row is the proof that the re-pin
    // of 2026-11-16 states one, and states it apart from the contract it did not move.
    const pin = draftSuitePin('FHGM');
    const entry = draftEntry('FHGM');
    assert.equal(pin.stated, true, 'FHGM states a suite pin now, so a draft-lane count can name a revision');
    assert.equal(pin.partial, false);
    assert.equal(pin.repository, 'FHGM-Specification');
    assert.equal(pin.manifest, 'development/conformance/manifest.json');
    assert.equal(pin.commit, 'c503ecf38deaba289e8384124ee5e2b8e81b86f1');
    assert.equal(pin.sha256, '0d2790151c4a29551e9b92fb6b3c3c62ea062f2889ffbd00b3c425e7b6da3458');
    assert.equal(pin.vectors, 43);
    assert.equal(pin.bytes, 51114);
    assert.deepEqual([...pin.rules], ['B1', 'K1', 'K2', 'K3', 'K4', 'K5', 'K6']);
    assert.notEqual(pin.commit, entry.commit, 'the record contract stayed at its own pin while the suite moved');
    assert.equal(entry.overlay.commit, pin.commit, 'the transport overlay was re-vendored from the suite revision, which is where the draft job leaves the checkout');
    assert.notEqual(entry.overlay.commit, entry.commit, 'so the overlay and the record contract are named by different commits, on purpose');
  });

  it('refuses a half-stated pin, because a subset of a pin checks nothing', () => {
    const partial = draftSuitePin('SYNTHETIC-TYPE-WITH-NO-ROW');
    assert.equal(partial.stated, false);
    assert.equal(partial.type, 'SYNTHETIC-TYPE-WITH-NO-ROW');
    const half = verifyAgainst({ type: 'SYN', repository: 'R', stated: false, partial: true, commit: 'a'.repeat(40), manifest: null, sha256: null, vectors: null }, ROOT);
    assert.equal(half.state, 'partial');
    assert.match(half.message, /incomplete suite pin/);
  });
});

describe('verifyAgainst', () => {
  it('accepts the matching bytes and refuses one byte of difference', () => {
    const clean = Buffer.from('{"vectors":[{"id":"a"}]}\n', 'utf8');
    const dirty = Buffer.from('{"vectors":[{"id":"b"}]}\n', 'utf8');
    assert.notEqual(digest(clean), digest(dirty), 'the fixture is only a control if the two bodies really differ');
    const pin = pinFor(clean);

    const matched = checkoutWith(pin.manifest, clean);
    const drifted = checkoutWith(pin.manifest, dirty);
    try {
      const ok = verifyAgainst(pin, matched);
      assert.equal(ok.state, 'verified');
      assert.equal(ok.actual, pin.sha256);
      assert.match(ok.message, /suite manifest verified/);

      const bad = verifyAgainst(pin, drifted);
      assert.equal(bad.state, 'drift');
      assert.equal(bad.actual, digest(dirty), 'the reported digest is computed from the bytes on disk');
      assert.equal(bad.expected, pin.sha256);
      assert.match(bad.message, /is not the suite this build's draft evidence names/);
      assert.match(bad.message, new RegExp(pin.sha256.slice(0, 16)), 'the message names the expected digest');
      assert.match(bad.message, new RegExp(digest(dirty).slice(0, 16)), 'and the actual one');
    } finally {
      rmSync(matched, { recursive: true, force: true });
      rmSync(drifted, { recursive: true, force: true });
    }
  });

  it('does not verify a claimed pin with blank or malformed provenance', () => {
    const bytes = Buffer.from('{"vectors":[]}\n');
    const dir = checkoutWith('conformance/manifest.json', bytes);
    try {
      for (const overrides of [{ commit: '' }, { commit: 7 }, { commit: 'c'.repeat(40) + '\n' }, { manifest: ' ' }, { sha256: '' }]) {
        assert.equal(verifyAgainst(pinFor(bytes, overrides), dir).state, 'partial');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('cross-checks the recorded vector count against the manifest it just digested', () => {
    const bytes = Buffer.from('{"vectors":[{"id":"a"},{"id":"b"}]}\n', 'utf8');
    const pin = pinFor(bytes, { vectors: 9 });
    const dir = checkoutWith(pin.manifest, bytes);
    try {
      const result = verifyAgainst(pin, dir);
      assert.equal(result.state, 'drift');
      assert.match(result.message, /manifest digest matches but it holds 2 vectors while drafts\/provenance.json records 9/);
      assert.match(result.message, /cannot both be true/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('says absent rather than guessing when the checkout holds no manifest', () => {
    const pin = pinFor(Buffer.from('{}\n'));
    const dir = mkdtempSync(join(tmpdir(), 'fhr-suite-empty-'));
    try {
      const result = verifyAgainst(pin, dir);
      assert.equal(result.state, 'absent');
      assert.match(result.message, /holds no conformance\/manifest\.json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('will not resolve a pinned manifest path outside the checkout', () => {
    const escaped = manifestPathIn({ manifest: '../../etc/passwd' }, '/tmp/checkout');
    assert.equal(escaped.path, null);
    assert.match(String(escaped.problem), /resolves outside the checkout/);
    const inside = manifestPathIn({ manifest: 'conformance/manifest.json' }, '/tmp/checkout');
    assert.equal(inside.path, resolve('/tmp/checkout/conformance/manifest.json'));
    assert.equal(inside.problem, null);
    const empty = manifestPathIn({ manifest: null }, '/tmp/checkout');
    assert.equal(empty.path, null);
    assert.match(String(empty.problem), /states no manifest path/);
  });
});

describe('verifySuitePin against this build\'s own registry', () => {
  it('refuses a FHT checkout whose manifest is not the one pinned, and says both digests', () => {
    // Not a fixture of the pin: the real shape of the mistake. Every FHT manifest this
    // repository has ever named digests differently from the current pin - the contract
    // revision 226f923c holds a 65-vector pre-rename file (54216 B, d9025104675e69b5…),
    // the suite revision this pin replaced on 2026-11-16 held a 66-vector one (56250 B,
    // 9b07179497bdc724…), and the pin describes 65615 B at 9fd8c0b2a4638d5d… from
    // be9bcc82. Any manifest that is not those exact bytes is refused, so a stale checkout
    // cannot be scored and reported as the pinned suite.
    const dir = checkoutWith('conformance/manifest.json', Buffer.from('{"vectors":[]}\n', 'utf8'));
    try {
      const result = verifySuitePin('FHT', dir);
      assert.equal(result.state, 'drift');
      assert.equal(result.expected, draftSuitePin('FHT').sha256);
      assert.match(result.message, new RegExp(draftSuitePin('FHT').sha256.slice(0, 16)), 'the refusal names the digest it wanted');
      assert.doesNotMatch(result.message, /verified/, 'and never reads as a verification');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names a draft with no stated pin as unpinned, never as verified', async () => {
    // Synthesised for the same reason as the null-surface test above: with both drafts
    // pinned, filtering the live registry for an unpinned draft returns nothing and the
    // loop would pass by saying nothing.
    const tree = draftTreeWith((registry) => {
      for (const field of ['suiteCommit', 'suiteManifest', 'suiteManifestSha256']) delete registry.drafts.FHGM[field];
    });
    try {
      const { verifySuitePin: verifyIn } = await tree.load('scripts/ci/suite-pin.mjs');
      const { DRAFT_TYPES: types, draftSuitePin: pinIn } = await tree.load('src/drafts.js');
      const undeclared = types.filter((each) => !pinIn(each).stated);
      assert.deepEqual(undeclared, ['FHGM'], 'the fixture leaves exactly one draft unpinned');
      for (const type of undeclared) {
        const result = verifyIn(type, tree.dir);
        assert.equal(result.state, 'unpinned');
        assert.match(result.message, /revision is unknown/);
      }
    } finally {
      removeDraftTree(tree);
    }
  });

  it('hashes files the same way the rest of the repository digests them', () => {
    const path = join(ROOT, 'drafts', 'provenance.json');
    assert.equal(sha256File(path), digest(readFileSync(path)));
  });
});

describe('the draft-lane runner enforces the suite pin', () => {
  /**
   * @param {string[]} args
   */
  const run = (args) => spawnSync(process.execPath, ['scripts/capability/draft-vectors.mjs', ...args], { cwd: ROOT, encoding: 'utf8' });

  it('exits 2 and scores nothing when the FHT suite is not the pinned one', () => {
    const dir = checkoutWith(draftSuitePin('FHT').manifest, Buffer.from('{"vectors":[]}\n', 'utf8'));
    try {
      const result = run(['--fht', dir]);
      assert.equal(result.status, 2, `expected exit 2, got ${result.status}\n${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /REFUSED/);
      assert.match(result.stdout, /is not the suite this build's draft evidence names/);
      assert.match(result.stdout, new RegExp(draftSuitePin('FHT').sha256.slice(0, 16)), 'the refusal names the digest it wanted');
      assert.doesNotMatch(result.stdout, /FHT: \d+ pass/, 'a refused suite must not produce a pass count');
      assert.match(result.stdout, /TOTAL draft-lane evidence: 0 pass, 0 fail, 0 not-run/);
      assert.match(result.stderr, /1 suite\(s\) refused/);
      assert.match(result.stderr, /re-pin deliberately/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const type of ['FHT', 'FHGM']) {
    it(`refuses an absent ${type} suite pin before any suite is scored`, () => {
      const tree = draftTreeWith((registry) => {
        for (const field of ['suiteCommit', 'suiteManifest', 'suiteManifestSha256']) delete registry.drafts[type][field];
      });
      const manifest = { vectors: [{ id: 'synthetic-a', file: 'missing.gff3' }] };
      const dir = checkoutWith('development/conformance/manifest.json', `${JSON.stringify(manifest)}\n`);
      try {
        const result = spawnSync(process.execPath, [join(tree.dir, 'scripts/capability/draft-vectors.mjs'), '--fht', dir, '--fhgm', dir], { cwd: tree.dir, encoding: 'utf8' });
        assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
        assert.match(result.stderr, /NOTHING SCORED/);
        assert.match(result.stderr, new RegExp(`${type}: no suite pin`));
        assert.doesNotMatch(result.stdout, /(?:FHT|FHGM): \d+ pass/);
        assert.doesNotMatch(result.stdout, /TOTAL draft-lane evidence/);
        assert.doesNotMatch(result.stdout, /manifest vectors:/);
        if (type === 'FHT') {
          const checked = spawnSync(process.execPath, [join(tree.dir, 'scripts/ci/suite-pin.mjs'), '--check', dir], { cwd: tree.dir, encoding: 'utf8' });
          assert.equal(checked.status, 1, checked.stdout);
          assert.match(checked.stdout, /missing suite pin; scoring is refused/);
          // A symlinked CLI entry must execute the same refusal, not exit 0 silently.
          const linkedBuild = join(dir, 'linked-build');
          symlinkSync(tree.dir, linkedBuild, 'dir');
          const linked = spawnSync(process.execPath, [join(linkedBuild, 'scripts/ci/suite-pin.mjs'), '--check', dir], { cwd: tree.dir, encoding: 'utf8' });
          assert.equal(linked.status, 1, linked.stdout);
          assert.match(linked.stdout, /missing suite pin; scoring is refused/);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
        removeDraftTree(tree);
      }
    });
  }

  it('refuses each incomplete suite-pin field before scoring', () => {
    for (const missing of ['suiteCommit', 'suiteManifest', 'suiteManifestSha256']) {
      const tree = draftTreeWith((registry) => { delete registry.drafts.FHGM[missing]; });
      try {
        const result = spawnSync(process.execPath, [join(tree.dir, 'scripts/capability/draft-vectors.mjs'), '--fhgm', tree.dir], { cwd: tree.dir, encoding: 'utf8' });
        assert.equal(result.status, 2, `${missing}: ${result.stdout}\n${result.stderr}`);
        assert.match(result.stderr, /NOTHING SCORED/);
        assert.match(result.stderr, /FHGM: incomplete suite pin/);
        assert.doesNotMatch(result.stdout, /TOTAL draft-lane evidence|manifest vectors:/);
      } finally {
        removeDraftTree(tree);
      }
    }
  });

  it('refuses empty, non-string and malformed suite members before any scoring', async () => {
    for (const [field, value] of [
      ['suiteCommit', ''], ['suiteCommit', ' '], ['suiteCommit', 7],
      ['suiteCommit', 'c'.repeat(40) + '\n'], ['suiteManifest', ''],
      ['suiteManifest', {}], ['suiteManifestSha256', ''],
      ['suiteManifestSha256', 'a'.repeat(64) + '\n'],
    ]) {
      const tree = draftTreeWith((registry) => { registry.drafts.FHGM[field] = value; });
      try {
        const { draftSuitePin: view } = await tree.load('src/drafts.js');
        assert.equal(view('FHGM').stated, false);
        assert.equal(view('FHGM').partial, true);
        const result = spawnSync(process.execPath, [join(tree.dir, 'scripts/capability/draft-vectors.mjs'), '--fhgm', tree.dir], { cwd: tree.dir, encoding: 'utf8' });
        assert.equal(result.status, 2, `${field}: ${result.stdout}\n${result.stderr}`);
        assert.match(result.stderr, /NOTHING SCORED/);
        assert.doesNotMatch(result.stdout, /TOTAL draft-lane evidence|manifest vectors:/);
      } finally {
        removeDraftTree(tree);
      }
    }
  });

  it('does not report success when no supplied suite path exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fhr-absent-suite-'));
    rmSync(dir, { recursive: true, force: true });
    const result = run(['--fht', dir]);
    assert.equal(result.status, 3, result.stdout + result.stderr);
    assert.match(result.stderr, /NOTHING SCORED/);
    assert.doesNotMatch(result.stdout, /TOTAL draft-lane evidence/);
  });

  it('reads the pin through src/drafts.js, so the registry stays the single source', () => {
    // If the tooling went back to literals, editing the registry would stop changing
    // behaviour and the pin would be inert again. The literals to look for are derived
    // from the registry itself, so this control moves with the pins instead of naming the
    // last set - a hardcoded list of old digests stops testing anything the moment a
    // re-pin lands, which is exactly when the check is needed.
    const runner = readFileSync(join(ROOT, 'scripts', 'capability', 'draft-vectors.mjs'), 'utf8');
    const guard = readFileSync(join(ROOT, 'scripts', 'ci', 'suite-pin.mjs'), 'utf8');
    const glue = readFileSync(join(ROOT, 'scripts', 'ci', 'draft-pins.mjs'), 'utf8');
    const pinned = [];
    for (const type of DRAFT_TYPES) {
      const entry = draftEntry(type);
      pinned.push(entry.commit, entry.sha256, entry.suiteCommit, entry.suiteManifestSha256, entry.overlay?.commit, entry.overlay?.sha256);
    }
    const literals = [...new Set(pinned.filter((value) => typeof value === 'string' && value !== ''))];
    assert.ok(literals.length >= 6, `the registry must offer something for this control to refuse (${literals.length} pinned strings found)`);
    for (const [name, source] of [['draft-vectors.mjs', runner], ['suite-pin.mjs', guard], ['draft-pins.mjs', glue]]) {
      assert.match(source, /from '.*src\/drafts\.js'/, `${name}: must import the draft registry view`);
      for (const value of literals) {
        assert.ok(!source.includes(value.slice(0, 12)), `${name}: no pinned commit or digest (${value.slice(0, 12)}…) may be hardcoded in the tooling`);
      }
    }
    assert.match(guard, /draftSuitePin/, 'the guard asks src/drafts.js which pin is stated');
    assert.match(glue, /suite-commit=/, 'the CI glue publishes the suite revision as an output, not the contract revision under one name');
    assert.match(runner, /verifySuitePin/, 'the runner verifies before it scores');
  });

  it('cannot move the shared ledger: the shared suite holds no draft vector', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'conformance', 'manifest.json'), 'utf8'));
    const provenance = JSON.parse(readFileSync(join(ROOT, 'conformance', 'provenance.json'), 'utf8'));
    assert.equal(manifest.vectors.length, provenance.vectors, 'the shared count is the vendored suite\'s own, and no draft run adds to it');
    assert.equal(manifest.vectors.filter((vector) => /^fht|^fhgm/.test(String(vector.format))).length, 0);
  });

  it('refuses to score anything when its own vendored draft bytes disagree with the registry', () => {
    // Without this guard a tampered `drafts/fhgm-model-draft.json` still produced a
    // number: the per-reading digest refusal is caught inside the vector loop and becomes
    // "this file is invalid", so the run exited 1 having printed `FHGM: 4 pass, 39 fail` -
    // four rows right for the wrong reason. Demonstrated on 2026-11-16 by flipping one byte
    // of the real vendored file. Done here to a temporary copy of the build, so the
    // repository's own `drafts/` is never touched.
    const tree = draftTreeWith();
    const target = join(tree.dir, 'drafts', 'fhgm-model-draft.json');
    const original = readFileSync(join(ROOT, 'drafts', 'fhgm-model-draft.json'));
    const tampered = Buffer.from(original);
    tampered[tampered.length - 3] = tampered[tampered.length - 3] === 0x39 ? 0x38 : 0x39;
    writeFileSync(target, tampered);
    const checkout = checkoutWith('development/conformance/manifest.json', Buffer.from('{"vectors":[]}\n', 'utf8'));
    try {
      // Non-vacuity first: a mutation that changed no byte would prove nothing.
      assert.ok(!tampered.equals(original), 'the fixture must actually differ from the pinned bytes');
      assert.notEqual(digest(tampered), digest(original), 'and it must move the digest');
      const result = spawnSync(process.execPath, [join(tree.dir, 'scripts', 'capability', 'draft-vectors.mjs'), '--fhgm', checkout], { cwd: tree.dir, encoding: 'utf8' });
      assert.equal(result.status, 2, `expected exit 2, got ${result.status}\n${result.stdout}\n${result.stderr}`);
      assert.match(result.stderr, /NOTHING SCORED/);
      assert.match(result.stderr, /FHGM contract \(drafts\/fhgm-model-draft\.json\): sha256 [0-9a-f]{64}, recorded [0-9a-f]{64}/);
      assert.doesNotMatch(result.stdout, /FHGM: \d+ pass/, 'no pass count may be printed for bytes the registry rejects');
      assert.doesNotMatch(result.stdout, /TOTAL draft-lane evidence/, 'and no total either');
      assert.match(result.stdout, /nothing below is a released-contract result/, 'the banner still prints, so the refusal is legible as a lane run that stopped');
    } finally {
      rmSync(checkout, { recursive: true, force: true });
      removeDraftTree(tree);
    }
  });
});

describe('the draft-lane runner refuses to score a layer it cannot judge', () => {
  it('leaves a `layers.gff3: reject` expectation not-run, and does not intercept `accept`', async () => {
    // Exercise layer abstention with an explicitly pinned synthetic manifest;
    // removing its pin would now test provenance refusal before reaching any vector.
    const manifest = {
      vectors: [
        { id: 'accept-expectation', file: 'vectors/missing.fhgff3.gff3', layers: { gff3: 'accept' }, expected: 'valid', rule: 'K2' },
        { id: 'reject-expectation', file: 'vectors/missing.fhgff3.gff3', layers: { gff3: 'reject' }, expected: 'invalid', rule: 'K4' },
      ],
    };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
    const tree = draftTreeWith((reg) => {
      Object.assign(reg.drafts.FHGM, {
        suiteCommit: 'c'.repeat(40),
        suiteManifest: 'development/conformance/manifest.json',
        suiteManifestSha256: digest(manifestBytes),
        suiteManifestBytes: manifestBytes.length,
        suiteVectors: manifest.vectors.length,
      });
    });
    const dir = checkoutWith('development/conformance/manifest.json', `${JSON.stringify(manifest)}\n`);
    try {
      const result = spawnSync(process.execPath, [join(tree.dir, 'scripts', 'capability', 'draft-vectors.mjs'), '--fhgm', dir], { cwd: tree.dir, encoding: 'utf8' });
      assert.equal(result.status, 0, `nothing was scored, so nothing failed:\n${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /FHGM: 0 pass, 0 fail, 2 not-run/, 'neither expectation becomes a pass');
      assert.match(result.stdout, /not-run reject-expectation \[FHGM\]: layers\.gff3 = "reject"/, 'the reject expectation is refused by name and by value');
      assert.match(result.stdout, /gff3-validator/, 'with the owner of the layer it cannot judge');
      assert.match(result.stdout, /not-run accept-expectation \[FHGM\]: unreadable path/, 'the accept expectation is not intercepted: it reaches the file check');
      assert.doesNotMatch(result.stdout, /layers\.gff3 = "accept"/, 'and `accept` is never a reason to refuse a vector');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      removeDraftTree(tree);
    }
  });
});
