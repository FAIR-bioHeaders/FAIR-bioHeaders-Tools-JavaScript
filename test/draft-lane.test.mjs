/**
 * The rule-V7 draft lane: its pin, its gate, and its warning.
 *
 * None of this file is about whether FHT is a good contract or when it ships. It
 * is about the four things V7 actually requires of a reader: the bytes are pinned
 * by commit and SHA-256 and re-verified, the lane is only ever opened by an
 * explicit caller decision, every record read through it says so, and a draft
 * takes no release form - which includes the negative case, that a release-shaped
 * URL for a type no registry lists is still just "any other value" under V5.
 *
 * The FHT records here are this repository's own fixtures (`testutil/fixtures.mjs`),
 * not upstream vectors: a record that cites a draft stays in the development
 * repository that owns it. Running the owning repositories' draft suites is
 * separate, labelled evidence - `node scripts/capability/draft-vectors.mjs`.
 */

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { HeaderError } from '../src/errors.js';
import { DRAFT_TYPES, citationIndex, draftEntry, draftSupport, draftWarning, loadDraft, verifyDraftBytes } from '../src/drafts.js';
import { enabledDrafts, selectSchema } from '../src/selection.js';
import { inspectBytes, validateRecord } from '../src/index.js';
import { verifyParentLinks, VERDICTS } from '../src/parent-links.js';
import { buildSequenceFile, fhtRecord } from '../testutil/fixtures.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CITATION = 'https://raw.githubusercontent.com/FAIR-bioHeaders/FHT-Specification/main/fht.json';

describe('the draft pin', () => {
  it('names exactly the two drafts the shared specification leaves unreleased', () => {
    assert.deepEqual([...DRAFT_TYPES], ['FHT', 'FHGM']);
  });

  it('gives every draft a commit and a SHA-256, and no release form at all', () => {
    for (const type of DRAFT_TYPES) {
      const entry = draftEntry(type);
      assert.match(entry.commit, /^[0-9a-f]{40}$/, `${type} must be pinned to a full commit sha`);
      assert.match(entry.sha256, /^[0-9a-f]{64}$/, `${type} must be pinned to a full sha256`);
      assert.equal(entry.status, 'draft', `${type} is a draft`);
      assert.equal(entry.releaseTag, null, `${type} has no release tag`);
      assert.equal(entry.w3id, null, `${type} has no w3id URL`);
      assert.equal(entry.registryRow, null, `${type} has no schemas/versions.json row`);
      assert.match(entry.citation, /^https:\/\/raw\.githubusercontent\.com\/FAIR-bioHeaders\/[A-Za-z-]+\/main\//, `${type} is cited as raw-main of the repository that owns it`);
    }
  });

  it('verifies the vendored bytes against the recorded digests', () => {
    assert.deepEqual(verifyDraftBytes(join(ROOT, 'drafts')), [], 'every pinned draft file must match its digest');
    const recorded = JSON.parse(readFileSync(join(ROOT, 'drafts', 'provenance.json'), 'utf8'));
    for (const type of DRAFT_TYPES) {
      const row = recorded.drafts[type];
      const bytes = readFileSync(join(ROOT, 'drafts', row.file));
      assert.equal(bytes.length, row.bytes, `${row.file} must hold the byte count its provenance records`);
    }
  });

  it('refuses to read a draft whose bytes no longer match the digest it states', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fhr-draft-pin-'));
    try {
      const source = join(ROOT, 'drafts', 'fht-draft.json');
      const copy = join(dir, 'fht-draft.json');
      copyFileSync(source, copy);
      const bytes = readFileSync(copy);
      bytes[bytes.length - 2] = bytes[bytes.length - 2] === 0x0a ? 0x0a : 0x0a; // keep it valid JSON
      writeFileSync(copy, `${bytes.subarray(0, bytes.length - 2).toString('utf8')}\n}\n`);
      const problems = verifyDraftBytes(dir);
      assert.ok(problems.some((row) => row.file === 'fht-draft.json'), 'a moved draft must be reported, not read');
      assert.ok(problems.every((row) => row.actual !== row.expected));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('compiles the pinned contracts on the same 2020-12 configuration as a released one', () => {
    for (const type of DRAFT_TYPES) {
      const loaded = loadDraft(type);
      assert.equal(loaded.schema.$schema, 'https://json-schema.org/draft/2020-12/schema', `${type} must be a draft/2020-12 contract`);
      const validated = validateRecord({}, { type, release: null, rule: 'V7', draft: loaded.entry });
      assert.equal(validated.valid, false, `an empty record cannot satisfy the ${type} draft`);
      assert.ok(validated.errors.some((line) => line.includes('required property')), `${type} must report its required set, not a silent pass`);
    }
  });
});

describe('the lane is a caller decision', () => {
  it('is shut unless the caller says otherwise', () => {
    assert.equal(enabledDrafts({}).size, 0);
    assert.equal(enabledDrafts(undefined).size, 0);
    assert.equal(enabledDrafts({ drafts: null }).size, 0);
    assert.equal(enabledDrafts({ drafts: false }).size, 0);
    assert.equal(enabledDrafts({ drafts: [] }).size, 0);
  });

  it('opens on named types, or on every pin when the caller says true', () => {
    assert.deepEqual([...enabledDrafts({ drafts: ['FHT'] })], ['FHT']);
    assert.deepEqual([...enabledDrafts({ drafts: true })].sort(), ['FHGM', 'FHT']);
  });

  it('refuses a name it has no pin for, rather than silently staying shut', () => {
    assert.throws(() => enabledDrafts({ drafts: ['FHR'] }), (error) => error instanceof HeaderError && error.rule === 'V7');
    assert.throws(() => enabledDrafts({ drafts: ['FHX'] }), /pins no draft contract/);
    assert.throws(() => enabledDrafts({ drafts: 'FHT' }), /must be true or an array/);
  });

  it('selects the draft only for its own raw-main citation', () => {
    const lane = { drafts: ['FHT'] };
    const chosen = selectSchema({ schema: CITATION, schemaVersion: '1.0' }, lane);
    assert.equal(chosen.type, 'FHT');
    assert.equal(chosen.rule, 'V7');
    assert.equal(chosen.release, null, 'a draft reading names no release');
    assert.equal(chosen.draft.sha256, draftEntry('FHT').sha256);
    assert.match(chosen.warning, /is an unreleased draft/);

    assert.equal(selectSchema({ schema: CITATION, schemaVersion: '1.0' }).rule, 'V5', 'with the lane shut the same value is any other value');
    assert.equal(selectSchema({ schema: CITATION, schemaVersion: '1.0' }, { drafts: ['FHGM'] }).rule, 'V5', 'opening FHGM must not open FHT');
  });

  it('keeps a release-shaped URL out of the lane, which is what "no release form" means', () => {
    const lane = { drafts: true };
    const releaseShaped = [
      'https://w3id.org/fair-bioheaders/fht/v9.9.9',
      'https://w3id.org/fair-bioheaders/fht/v0.6.0',
      'https://raw.githubusercontent.com/FAIR-bioHeaders/FHT-Specification/v0.7.0/fht.json',
      'https://raw.githubusercontent.com/FAIR-bioHeaders/FHT-Specification/main/fht.json/',
      'https://raw.githubusercontent.com/FAIR-bioHeaders/FHT-Specification/main/core.yaml',
      'https://raw.githubusercontent.com/FAIR-bioHeaders/FHR-Specification/main/fht.json',
    ];
    for (const value of releaseShaped) {
      const selection = selectSchema({ schema: value, schemaVersion: '1.0' }, lane);
      assert.notEqual(selection.rule, 'V7', `${value} must not be read as a draft`);
      assert.equal(selection.type, 'FHR', `${value} is "any other value" under V5, read as FHR`);
    }
    assert.equal(citationIndex().size, DRAFT_TYPES.length, 'the lane recognises exactly one citation per pinned draft');
  });

  it('does not disturb a released selection', () => {
    for (const value of [
      'https://w3id.org/fair-bioheaders/fhr/v0.6.0',
      'https://raw.githubusercontent.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification/main/fhr.json',
      'https://raw.githubusercontent.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification/v0.4.0/fhp.json',
    ]) {
      const without = selectSchema({ schema: value, schemaVersion: '2.1' });
      const withLane = selectSchema({ schema: value, schemaVersion: '2.1' }, { drafts: true });
      assert.deepEqual(withLane, without, `${value} must select the same contract either way`);
    }
  });
});

describe('a record read through the lane says so', () => {
  const record = fhtRecord();

  it('warns on the reading, naming the draft, the commit and the digest', () => {
    const { bytes } = buildSequenceFile({ ...record, checksum: '' });
    const reading = inspectBytes(bytes, { container: 'fasta', drafts: ['FHT'] });
    assert.equal(reading.schema.rule, 'V7');
    assert.equal(reading.schema.type, 'FHT');
    assert.equal(reading.schema.release, null);
    assert.equal(reading.schema.schemaVersion, null, 'the reading states no schemaVersion of ours');
    const line = reading.warnings.find((entry) => entry.includes('unreleased draft'));
    assert.ok(line, 'the V7 warning must be on the reading');
    assert.ok(line.includes(CITATION), 'the warning names the citation read');
    assert.ok(line.includes(draftEntry('FHT').commit), 'the warning names the pinned commit');
    assert.ok(line.includes(draftEntry('FHT').sha256), 'the warning names the pinned digest');
    assert.ok(line.includes('not a released schema'), 'the warning says what the result is not');
  });

  it('reads a conforming fixture, and rejects a record the draft contract refuses', () => {
    const good = buildSequenceFile(fhtRecord());
    const read = inspectBytes(good.bytes, { container: 'fasta', drafts: ['FHT'] });
    assert.deepEqual(read.errors, [], `a conforming draft record must be accepted: ${read.errors.join('; ')}`);
    assert.equal(read.checksum.matches, true);

    const bad = buildSequenceFile(fhtRecord({ assemblyType: 'not-an-enum-value' }));
    const rejected = inspectBytes(bad.bytes, { container: 'fasta', drafts: ['FHT'] });
    assert.equal(rejected.valid, false, 'the draft contract must be able to refuse');
    assert.ok(rejected.errors.join(' ').includes('assemblyType'), `the refusal should name the field, got ${rejected.errors.join('; ')}`);

    const undated = buildSequenceFile(fhtRecord({ dateCreated: '2022-13-45' }));
    const formatRead = inspectBytes(undated.bytes, { container: 'fasta', drafts: ['FHT'] });
    assert.equal(formatRead.valid, false, 'format must be asserted in the draft lane too, not only for released contracts');
  });

  it('keeps the draft in the container the draft is defined for', () => {
    const asGfa = inspectBytes(new Uint8Array(readFileSync(join(ROOT, 'conformance', 'valid', 'gfa-lf.fhr.gfa'))), { container: 'gfa', drafts: ['FHT'] });
    assert.equal(asGfa.schema.type, 'FHR', 'a GFA file citing the FHR contract stays FHR with the lane open');
    assert.equal(asGfa.valid, true, 'opening the FHT lane must not disturb a released GFA reading');
    // The same FHT record written with the GFA prefix is a container mismatch,
    // and stays one with the lane open: recognition of a draft widens no container.
    const fhtInGfa = buildSequenceFile(fhtRecord(), { prefix: '#~', sequence: 'H\tVN\t1\t0\t24\t+\t0\tACGT\n' });
    const mismatch = inspectBytes(fhtInGfa.bytes, { container: 'gfa', drafts: ['FHT'] });
    assert.equal(mismatch.schema.type, 'FHT', 'the citation still selects the draft');
    assert.ok(mismatch.errors.some((line) => line.includes('does not belong in a gfa file')), 'an FHT header in a GFA file is a container mismatch');
  });

  it('states the lane it opened in draftSupport()', () => {
    const support = draftSupport();
    assert.equal(support.length, 2);
    for (const row of support) {
      assert.equal(row.status, 'draft');
      assert.match(draftWarning(draftEntry(row.type)), new RegExp(row.commit));
    }
  });
});

describe('parent links (FHT draft rule C3)', () => {
  const parent = buildSequenceFile({ ...fhtRecord({ transcriptome: 'Synthetic parent transcript set' }), schemaVersion: '1.0' });

  it('reports checked-pass for a parent that recomputes to the stated value', () => {
    const child = buildSequenceFile(
      fhtRecord({ derivedFrom: [{ headerType: 'FHT', checksum: parent.checksum, relationship: 'filteredFrom' }] }),
    );
    const reading = inspectBytes(child.bytes, {
      container: 'fasta',
      drafts: ['FHT'],
      parents: () => ({ bytes: parent.bytes }),
    });
    assert.equal(reading.valid, true, `a checked-pass link must not reject: ${reading.errors.join('; ')}`);
    assert.equal(reading.parentLinks.links[0].verdict, VERDICTS.checkedPass);
  });

  it('reports checked-fail and rejects when the supplied parent disagrees', () => {
    const stated = `${parent.checksum.slice(0, 40)}AAAA=`;
    const child = buildSequenceFile(fhtRecord({ derivedFrom: [{ headerType: 'FHT', checksum: stated, relationship: 'filteredFrom' }] }));
    const reading = inspectBytes(child.bytes, { container: 'fasta', drafts: ['FHT'], parents: () => ({ bytes: parent.bytes }) });
    assert.equal(reading.valid, false, 'a mismatched parent checksum is an invalid link, not a skipped one');
    assert.equal(reading.parentLinks.links[0].verdict, VERDICTS.checkedFail);
    assert.ok(reading.errors.join(' ').includes('checked-fail'));
  });

  it('reports unchecked when no parent is supplied, and never calls it verified', () => {
    const child = buildSequenceFile(fhtRecord({ derivedFrom: [{ headerType: 'FHT', checksum: parent.checksum, relationship: 'filteredFrom' }] }));
    const reading = inspectBytes(child.bytes, { container: 'fasta', drafts: ['FHT'] });
    assert.equal(reading.parentLinks.links[0].verdict, VERDICTS.unchecked);
    assert.equal(reading.valid, true, 'an unsupplied parent is not a rejection reason');
    assert.ok(reading.warnings.some((line) => line.includes('unchecked')), 'the reading must say the link went unverified');
    const explicit = verifyParentLinks(reading.metadata, { type: 'FHT' });
    assert.equal(explicit.valid, true);
    assert.equal(explicit.links[0].verdict, VERDICTS.unchecked);
  });

  it('judges each link on its own, so one pass does not mask one failure', () => {
    const other = buildSequenceFile(fhtRecord({ transcriptome: 'Synthetic other parent set' }));
    const record = fhtRecord({
      derivedFrom: [
        { headerType: 'FHT', checksum: other.checksum, relationship: 'filteredFrom' },
        { headerType: 'FHT', checksum: parent.checksum, relationship: 'filteredFrom' },
      ],
    });
    // Link 0 states `other`'s checksum but the caller hands over `parent`'s
    // bytes, and link 1 states and gets the same parent: one pass, one failure.
    const result = verifyParentLinks(record, {
      type: 'FHT',
      resolveParent: () => ({ bytes: parent.bytes }),
    });
    assert.deepEqual(result.links.map((row) => row.verdict), [VERDICTS.checkedFail, VERDICTS.checkedPass]);
    assert.equal(result.valid, false);
  });

  it('does not run at all when the caller never opened the lane', () => {
    const child = buildSequenceFile(fhtRecord({ derivedFrom: [{ headerType: 'FHT', checksum: `${parent.checksum.slice(0, 40)}AAAA=`, relationship: 'filteredFrom' }] }));
    const reading = inspectBytes(child.bytes, { container: 'fasta' });
    assert.equal(reading.parentLinks, undefined, 'a default reading recomputes no parent');
    assert.ok(!reading.errors.join(' ').includes('checked-fail'));
  });
});


describe('FHT C1 completeness arithmetic in the selected V7 lane', () => {
  const selection = selectSchema(fhtRecord(), { drafts: ['FHT'] });
  const counts = { lineageDataset: 'insecta_odb10', completeSingle: 7.0,
    completeDuplicated: 1, fragmented: 1, missing: 1, total: 10 };
  const check = (completeness) => validateRecord(fhtRecord({ completeness, checksum: `${'A'.repeat(43)}=` }), selection);
  it('accepts exact component totals including integral floating point values', () => {
    assert.equal(check(counts).valid, true);
  });
  for (const total of [9, 11]) it(`rejects a mismatched total of ${total}`, () => {
    assert.ok(check({ ...counts, total }).errors.some((error) => error.startsWith('C1:')));
  });
  it('refuses serialized counts whose precision would be lost before comparison', () => {
    const fixture = buildSequenceFile(fhtRecord({ completeness: counts }));
    const serialized = new TextDecoder().decode(fixture.bytes)
      .replace('completeSingle: 7', 'completeSingle: 9007199254740993')
      .replace('completeDuplicated: 1', 'completeDuplicated: 0')
      .replace('fragmented: 1', 'fragmented: 0')
      .replace('missing: 1', 'missing: 0')
      .replace('total: 10', 'total: 9007199254740992');
    const result = inspectBytes(new TextEncoder().encode(serialized), { container: 'fasta', drafts: ['FHT'] });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes('C1: completeness counts exceed the safe integer range')));
  });
  it('refuses even equal unsafe parsed counts rather than assert lossless support', () => {
    assert.ok(check({ ...counts, completeSingle: 2 ** 53, completeDuplicated: 0,
      fragmented: 0, missing: 0, total: 2 ** 53 }).errors.some((error) => error.includes('safe integer range')));
  });
  for (const value of [true, 0.5, undefined]) it(`leaves ${String(value)} to schema validation`, () => {
    const input = { ...counts, missing: value };
    if (value === undefined) delete input.missing;
    const result = check(input);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => !error.startsWith('C1:')));
    assert.ok(result.errors.every((error) => !error.startsWith('C1:')));
  });
});
