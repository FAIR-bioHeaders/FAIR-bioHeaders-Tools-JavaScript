/**
 * The FHGM draft lane: records inside an FHGFF3 header, judged beside the file.
 *
 * FHGM is not a header type, and the two properties that follow from that are the
 * point of this file:
 *
 * 1. the released FHGFF3 result of the file is untouched by any FHGM verdict, in
 *    either direction; and
 * 2. the only history a predecessor pointer may resolve against is what the caller
 *    supplied - never a file this library went and opened on its own.
 *
 * The records here are this repository's own fixtures (`testutil/fixtures.mjs`).
 * The owning repository's draft suite is run separately and labelled separately:
 * `node scripts/capability/draft-vectors.mjs --fhgm <checkout>`.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { MODELS_KEY, VERDICTS, admitsExtensionFields, checkFhgmModels, fhgmRuleCoverage } from '../src/fhgm.js';
import { indexGff3FeatureRows } from '../src/features.js';
import { inspectBytes, inspectStream } from '../src/reader.js';
import { draftEntry } from '../src/drafts.js';
import { buildFhgff3File, buildRawFasta, fhgmHeader, fhgmRecord } from '../testutil/fixtures.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {Record<string, unknown>} header
 * @param {object} [options]
 * @returns {object} the fhgm block
 */
function judge(header, options = {}) {
  const result = checkFhgmModels(header, { base: { valid: true }, ...options });
  return result;
}

describe('K1 transport', () => {
  it('admits extension fields from FHGFF3 1.1 upward, and no lower', () => {
    assert.equal(admitsExtensionFields('1.0'), false);
    assert.equal(admitsExtensionFields('1.1'), true);
    assert.equal(admitsExtensionFields('1.2'), true);
    assert.equal(admitsExtensionFields('2.0'), true);
    assert.equal(admitsExtensionFields('1'), false);
    assert.equal(admitsExtensionFields('01.1'), false);
  });

  it('refuses a 1.0 header carrying records', () => {
    const result = judge(fhgmHeader({ header: { schemaVersion: '1.0' } }));
    assert.equal(result.valid, false);
    assert.equal(result.rules.K1, 'reject');
    assert.match(result.errors.join(' '), /R15 admits extension fields only from FHGFF3 1.1/);
  });

  it('refuses an empty or malformed record array', () => {
    for (const models of [[], 'not-an-array', ['a string'], {}, 0]) {
      const result = judge(fhgmHeader({ models }));
      assert.equal(result.valid, false, `${JSON.stringify(models)} is not one or more records`);
      assert.equal(result.rules.K1, 'reject');
    }
  });

  it('reports a header with no records as absent, not as a rejection and not as a verdict', () => {
    const header = fhgmHeader();
    delete header[MODELS_KEY];
    const result = judge(header);
    assert.equal(result.status, 'absent');
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('applies the pinned overlay only when asked, and the re-pinned overlay admits every pairing the draft publishes', () => {
    // FHGM-Specification#17 (maintainer dual-base decision, 2026-11-15) rewrote the
    // overlay from a single v0.5.0/1.1 pin into a closed anyOf of two branch pairings.
    // FHGM-Specification#26 widened the v0.6.0 branch: the release accepts 1.1 records
    // per the shared docs/SCHEMA-VERSIONS.md, so the v0.6.0 citation set now pairs with
    // schemaVersion 1.2 *or* 1.1, and its URI set gained the raw tag URL under the
    // FHR-Specification historical repository name. The 2026-11-18 re-pin vendored
    // those bytes (533b3120…, 3191 B), and `test/fhgm.test.mjs` moves with them: the
    // earlier version of this test asserted that v0.6.0-citation-stating-1.1 was a
    // contradiction, and the suite's new `v0.6.0-citation-stating-1.1` and
    // `fhr-specification-alias-v0.6.0` vectors now pin the opposite reading. What stays
    // refused is a citation and a stated version that contradict each other - a v0.5.0
    // citation stating 1.2 - and never a fallback to the other branch.
    const currentRelease = judge(fhgmHeader({ header: { schema: 'https://w3id.org/fair-bioheaders/fhgff3/v0.6.0', schemaVersion: '1.2' } }));
    assert.equal(currentRelease.valid, true, 'the R15 reading admits extension fields from 1.1, so a 1.2 header transports');
    const onNewer = judge(fhgmHeader({ header: { schema: 'https://w3id.org/fair-bioheaders/fhgff3/v0.6.0', schemaVersion: '1.2' } }), { overlay: true });
    assert.equal(onNewer.rules.K1, 'pass', 'the re-pinned overlay admits the v0.6.0/1.2 pairing');
    assert.equal(onNewer.valid, true, onNewer.errors.join(' '));
    const onOlder = judge(fhgmHeader({ header: { schema: 'https://w3id.org/fair-bioheaders/fhgff3/v0.5.0', schemaVersion: '1.1' } }), { overlay: true });
    assert.equal(onOlder.valid, true, 'the overlay admits the v0.5.0/1.1 pairing it named before');
    const onNewerStating11 = judge(fhgmHeader({ header: { schema: 'https://w3id.org/fair-bioheaders/fhgff3/v0.6.0', schemaVersion: '1.1' } }), { overlay: true });
    assert.equal(onNewerStating11.rules.K1, 'pass', 'the re-pinned overlay admits a v0.6.0 citation stating 1.1, the pairing FHGM-Specification#26 added');
    assert.equal(onNewerStating11.valid, true, onNewerStating11.errors.join(' '));
    const onAlias = judge(fhgmHeader({ header: { schema: 'https://raw.githubusercontent.com/FAIR-bioHeaders/FHR-Specification/v0.6.0/fhgff3.json', schemaVersion: '1.2' } }), { overlay: true });
    assert.equal(onAlias.rules.K1, 'pass', 'the v0.6.0 raw tag URL under the FHR-Specification alias name is the same release identity');
    const crossed = judge(fhgmHeader({ header: { schema: 'https://w3id.org/fair-bioheaders/fhgff3/v0.5.0', schemaVersion: '1.2' } }), { overlay: true });
    assert.equal(crossed.rules.K1, 'reject', 'a v0.5.0 citation stating 1.2 remains a contradiction, not a pairing');
    assert.match(crossed.errors.join(' '), /K1 overlay/, 'and the refusal is attributed to the overlay');
    const plain = judge(fhgmHeader({ header: { schema: 'https://w3id.org/fair-bioheaders/fhgff3/v0.5.0', schemaVersion: '1.2' } }));
    assert.equal(plain.rules.K1, 'pass', 'the R15 reading alone cannot see the contradiction: it reads the stated version, not the citation');
    const tooOld = judge(fhgmHeader({ header: { schema: 'https://w3id.org/fair-bioheaders/fhgff3/v0.4.0', schemaVersion: '1.0' } }), { overlay: true });
    assert.equal(tooOld.rules.K1, 'reject', 'FHGFF3 1.0 cannot carry an extension key at all (R15), so no overlay question is reached');
    assert.match(tooOld.errors.join(' '), /R15 admits extension fields only from FHGFF3 1.1/);
  });
});

describe('K2 the record contract, K3 uniqueness, K5 reference agreement', () => {
  it('names the record contract, not a hand-written field list', () => {
    const missing = judge(fhgmHeader({ models: [{ modelId: 'm', modelVersion: '1', featureId: 'g1' }] }));
    assert.equal(missing.rules.K2, 'reject');
    assert.match(missing.errors.join(' '), /must have required property 'reference'/);

    const typed = judge(fhgmHeader({ models: [fhgmRecord({ modelVersion: 2 })] }));
    assert.equal(typed.rules.K2, 'reject');
    // 2026-11-18 wording note: under the re-pinned contract `modelVersion` is the shared
    // `text` definition, so a number surfaces through that composite (`must NOT be valid
    // (not)`) rather than the old flat `must be string`. What the test is about is
    // unchanged and still proven: the finding cites the record contract's instance path,
    // not a hand-written field list in this library.
    assert.match(typed.errors.join(' '), /x-fhgm-models\/modelVersion/);

    const closed = judge(fhgmHeader({ models: [fhgmRecord({ notAField: 'x' })] }));
    assert.equal(closed.rules.K2, 'reject');
    assert.match(closed.errors.join(' '), /additionalProperties/);
  });

  it('rejects a shared modelId as ambiguous', () => {
    const result = judge(fhgmHeader({ models: [fhgmRecord(), fhgmRecord({ modelVersion: '2' })] }));
    assert.equal(result.rules.K3, 'reject');
    assert.match(result.errors.join(' '), /Ambiguous model ID "model-a"/);
  });

  it('rejects a reference that contradicts the file genome link', () => {
    const result = judge(fhgmHeader({ models: [fhgmRecord({ reference: { genomeReference: { accession: 'OTHER_ASSEMBLY.9', seqcol_id: 'J3Hvvqu0USaOuxA-3wRFyZ3YPdnSEDCp' } } })] }));
    assert.equal(result.rules.K5, 'reject');
    assert.match(result.errors.join(' '), /contradicts the file genome link/);
  });

  it('rejects a reference with no form comparable with the file link, and accepts one that shares a form', () => {
    const fileOnly = fhgmHeader({
      header: { genomeReference: undefined },
      models: [fhgmRecord({ reference: { genomeReference: { accession: 'SYNTHETIC_ASSEMBLY.1', seqcol_id: 'J3Hvvqu0USaOuxA-3wRFyZ3YPdnSEDCp' } } })],
    });
    assert.equal(judge(fileOnly).rules.K5, 'reject', 'the file states an annotates link only, so a record that states accession+digest has nothing comparable');

    const shared = judge(fhgmHeader({ models: [fhgmRecord({ reference: { annotates: 'jG4CUYjd/YCAkgKl4Qk8SZq1DsL5bJxHN9SwceJ6B0g=' } })], header: { derivedFrom: [{ headerType: 'FHR', relationship: 'annotates', checksum: 'jG4CUYjd/YCAkgKl4Qk8SZq1DsL5bJxHN9SwceJ6B0g=' }] } }));
    assert.equal(shared.valid, true, `an annotates link matching the file's parent link is comparable: ${shared.errors.join('; ')}`);
  });

  it('runs K4 against a feature layer, and says which state it reached', () => {
    const without = judge(fhgmHeader());
    assert.equal(without.rules.K4, 'not-checked', 'no resolver at the direct call means no verdict, stated rather than silently skipped');
    assert.equal(without.records[0].featureTarget, null);

    const resolved = judge(fhgmHeader({ models: [fhgmRecord({ featureId: 'toy-a' })] }), { geneIds: ['toy-a'] });
    assert.equal(resolved.valid, true, `a record featureId that matches one decoded gene row passes: ${resolved.errors.join('; ')}`);
    assert.equal(resolved.rules.K4, 'pass');
    assert.equal(resolved.records[0].featureTarget.verdict, 'pass');

    const rawPercentInRecord = judge(fhgmHeader({ models: [fhgmRecord({ featureId: 'toy%2Da' })] }), { geneIds: ['toy-a'] });
    assert.equal(rawPercentInRecord.rules.K4, 'reject', 'the record featureId is a plain YAML string, not percent-decoded on the record side');

    const missing = judge(fhgmHeader({ models: [fhgmRecord({ featureId: 'absent' })] }), { geneIds: ['toy-a'] });
    assert.equal(missing.rules.K4, 'reject');
    assert.match(missing.errors.join(' '), /must target one local gene row/);
  });

  it('K4 counts rows and weighs their types: two rows or one transcript row rejects', () => {
    const dup = judge(fhgmHeader(), { features: [{ id: 'toy-a', type: 'gene' }, { id: 'toy-a', type: 'gene' }] });
    assert.equal(dup.rules.K4, 'reject', 'exactly one row is the rule; two sharing the ID resolve to no target');
    assert.match(dup.errors.join(' '), /not exactly one row/);

    const transcript = judge(fhgmHeader({ models: [fhgmRecord({ featureId: 'toy-a-rna' })] }), { features: [{ id: 'toy-a-rna', type: 'lncRNA' }] });
    assert.equal(transcript.rules.K4, 'reject', 'v0.1 declares no transcript target');
    assert.match(transcript.errors.join(' '), /not a gene row/);

    const accession = judge(fhgmHeader(), { features: [{ id: 'toy-a', type: 'SO:0000704' }] });
    assert.equal(accession.rules.K4, 'pass', 'the SO accession for gene is the same row type by name');

    const counted = judge(fhgmHeader(), { geneIds: ['toy-a', 'toy-a'] });
    assert.equal(counted.rules.K4, 'reject', 'the geneIds shorthand counts a repeated id as two rows');
  });

  it('K4 reads GFF3 content through the injected resolver, raw record featureId against percent-decoded row ID', () => {
    const gff3 = ['##gff-version 3', 'toy\tpilot\tgene\t10\t30\t.\t+\t.\tID=toy%2Da', '##FASTA', 'toy\tpilot\tgene\t1\t1\t.\t+\t.\tID=toy-a'].join('\n');
    const escaped = judge(fhgmHeader({ models: [fhgmRecord({ featureId: 'toy-a' })] }), { features: gff3 });
    assert.equal(escaped.rules.K4, 'pass', 'the row is ID=toy%2Da, the record names toy-a, and the second gene row sits after ##FASTA and is not indexed');
    const sameEscape = judge(fhgmHeader({ models: [fhgmRecord({ featureId: 'toy%2Da' })] }), { features: gff3 });
    assert.equal(sameEscape.rules.K4, 'reject', 'the record side is not percent-decoded: a record naming literal toy%2Da does not resolve to the row written ID=toy%2Da');

    const broken = judge(fhgmHeader(), { features: 'toy\tpilot\tgene\t10\t30\t.\t+\t.\n' });
    assert.equal(broken.rules.K4, 'unchecked', 'a row without nine fields makes the layer untrustworthy');
    assert.equal(broken.valid, true, 'an unchecked layer rejects nothing: K4 claims neither a pass nor a finding');
    assert.equal(broken.records[0].featureTarget.verdict, 'unchecked');
    assert.match(broken.records[0].featureTarget.detail, /nine/);

    const closed = judge(fhgmHeader(), { features: null });
    assert.equal(closed.rules.K4, 'not-checked', 'features: null says there is no layer, and nothing is inferred');
  });
});

describe('K6 predecessor verdicts', () => {
  const priorHeader = fhgmHeader({ models: [fhgmRecord({ modelVersion: '1' })], checksum: 'mLL01gudzlxP9lVjGu2XwxFI72RpAXMTEv5q2S9e4UM=' });
  const pointer = { annotationChecksum: priorHeader.checksum, modelId: 'model-a', modelVersion: '1' };

  it('resolves only against a supplied snapshot', () => {
    const current = fhgmHeader({ models: [fhgmRecord({ modelVersion: '2', predecessor: pointer })] });
    const withHistory = judge(current, { predecessors: [{ checksum: priorHeader.checksum, header: priorHeader }] });
    assert.equal(withHistory.valid, true, withHistory.errors.join('; '));
    assert.equal(withHistory.records[0].predecessor.verdict, VERDICTS.resolvable);

    const withoutHistory = judge(current);
    assert.equal(withoutHistory.valid, false, 'a pointer with no supplied history is unresolvable, which is a rejection');
    assert.match(withoutHistory.errors.join(' '), /the predecessor snapshot is the current file or was not supplied/);
  });

  it('rejects a pointer that names another model, records the wrong version, or reuses one', () => {
    const history = [{ checksum: priorHeader.checksum, header: priorHeader }];
    const neighbour = judge(fhgmHeader({ models: [fhgmRecord({ modelVersion: '2', predecessor: { ...pointer, modelId: 'model-b' } })] }), { predecessors: history });
    assert.match(neighbour.errors.join(' '), /the pointer names another model ID/);

    const wrong = judge(fhgmHeader({ models: [fhgmRecord({ modelVersion: '2', predecessor: { ...pointer, modelVersion: '9' } })] }), { predecessors: history });
    assert.match(wrong.errors.join(' '), /the predecessor records version "1", not "9"/);

    const reused = judge(fhgmHeader({ models: [fhgmRecord({ modelVersion: '1', predecessor: pointer })] }), { predecessors: history });
    assert.match(reused.errors.join(' '), /the revision reuses the predecessor model version/);
  });

  it('reports ambiguity when the pointed record already has a recorded successor', () => {
    const v1 = fhgmHeader({ models: [fhgmRecord({ modelVersion: '1' })], checksum: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' });
    const v2 = fhgmHeader({ models: [fhgmRecord({ modelVersion: '2', predecessor: { annotationChecksum: v1.checksum, modelId: 'model-a', modelVersion: '1' } })], checksum: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=' });
    const claimer = fhgmHeader({ models: [fhgmRecord({ modelVersion: '3', predecessor: { annotationChecksum: v1.checksum, modelId: 'model-a', modelVersion: '1' } })], checksum: 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD=' });
    const result = judge(claimer, { predecessors: [{ checksum: v1.checksum, header: v1 }, { checksum: v2.checksum, header: v2 }] });
    assert.equal(result.rules.K6, 'reject');
    assert.match(result.errors.join(' '), /Ambiguous model ID|already has a recorded successor/);
  });

  it('runs a supplied predecessor through the same rules, so an ambiguous history is not a foundation', () => {
    const ambiguous = fhgmHeader({ models: [fhgmRecord({ modelVersion: '1' }), fhgmRecord({ modelVersion: '1' })], checksum: 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=' });
    const claimer = fhgmHeader({ models: [fhgmRecord({ modelVersion: '2', predecessor: { annotationChecksum: ambiguous.checksum, modelId: 'model-a', modelVersion: '1' } })], checksum: 'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE=' });
    const result = judge(claimer, { predecessors: [{ checksum: ambiguous.checksum, header: ambiguous }] });
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /predecessor CCCCCC/i);
    assert.match(result.errors.join(' '), /Ambiguous model ID/);
  });
});

describe('B1 and the separation of a draft verdict from the file result', () => {
  it('refuses to judge records on a base that did not hold', () => {
    const result = checkFhgmModels(fhgmHeader(), { base: { valid: false } });
    assert.equal(result.status, 'not-checked');
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /B1/);
    assert.equal(result.rules.K1, 'skipped', 'no model rule runs on a file that is not a sound FHGFF3 file');
  });

  it('leaves the released FHGFF3 reading untouched whether the lane is open or not', () => {
    const bytes = new Uint8Array(readFileSync(join(ROOT, 'reader-policy', 'counterparts', 'valid', 'fhgff3-both-links-canonical-parent.fhgff3.gff3')));
    const plain = inspectBytes(bytes, { container: 'gff3' });
    const lane = inspectBytes(bytes, { container: 'gff3', drafts: ['FHGM'] });
    assert.equal(lane.fhgm.status, 'absent', 'a released FHGFF3 file with no records carries no FHGM verdict');
    for (const key of ['valid', 'container', 'metadata', 'checksum', 'schema', 'errors']) {
      assert.deepEqual(lane[key], plain[key], `the released reading of ${key} must not change`);
    }
    assert.ok(!plain.warnings.some((line) => line.includes('unreleased draft')), 'the default reading carries no draft warning');
  });

  it('reports a malformed header instead of inventing a verdict', () => {
    const result = checkFhgmModels(null, { base: { valid: true } });
    assert.equal(result.status, 'not-checked');
    assert.match(result.errors.join(' '), /no parsed FHGFF3 header/);
  });

  it('resolves K4 against the file\'s own bytes when the lane is open, and keeps the released result apart', () => {
    const header = { ...fhgmHeader(), schema: 'https://w3id.org/fair-bioheaders/fhgff3/v0.5.0', schemaVersion: '1.1' };
    const geneRow = 'toy\tpilot\tgene\t10\t30\t.\t+\t.\tID=toy%2Da';
    const rnaRow = 'toy\tpilot\tlncRNA\t10\t30\t.\t+\t.\tID=toy-a-rna;Parent=toy%2Da';
    const good = buildFhgff3File(header, { rows: [geneRow, rnaRow] });
    const plain = inspectBytes(good.bytes, { container: 'gff3' });
    const lane = inspectBytes(good.bytes, { container: 'gff3', drafts: ['FHGM'] });
    assert.equal(plain.fhgm, undefined, 'the lane-off reading carries no FHGM block at all');
    assert.equal(lane.fhgm.rules.K4, 'pass', 'the lane defaults K4 to the file\'s own feature rows: toy-a resolves to the one gene row written ID=toy%2Da');
    for (const key of ['valid', 'container', 'metadata', 'checksum', 'schema', 'errors']) {
      assert.deepEqual(lane[key], plain[key], `the released reading of ${key} must not change`);
    }

    const orphan = buildFhgff3File({ ...header, [MODELS_KEY]: [{ ...header[MODELS_KEY][0], featureId: 'toy-missing' }] }, { rows: [geneRow, rnaRow] });
    const rejected = inspectBytes(orphan.bytes, { container: 'gff3', drafts: ['FHGM'] });
    assert.equal(rejected.fhgm.rules.K4, 'reject');
    assert.equal(rejected.fhgm.valid, false);
    assert.equal(rejected.valid, true, 'a K4 rejection never reaches into the released FHGFF3 result');
    assert.deepEqual(rejected.errors, []);

    const replaced = inspectBytes(good.bytes, { container: 'gff3', drafts: ['FHGM'], fhgm: { geneIds: [] } });
    assert.equal(replaced.fhgm.rules.K4, 'reject', 'a caller-supplied resolver replaces the file default rather than joining it');
    const closed = inspectBytes(good.bytes, { container: 'gff3', drafts: ['FHGM'], fhgm: { features: null } });
    assert.equal(closed.fhgm.rules.K4, 'not-checked', 'features: null closes K4 for a caller that must not have the body read');
  });

  it('warns once per checked reading, naming the pin', () => {
    const result = judge(fhgmHeader());
    const line = result.warnings.find((entry) => entry.includes('unreleased draft'));
    assert.ok(line, 'a draft verdict must travel with the V7 warning');
    assert.ok(line.includes(draftEntry('FHGM').commit));
    assert.ok(line.includes(draftEntry('FHGM').sha256));
  });

  it('states every rule it runs and the boundary on the one that needs a resolver', () => {
    const coverage = fhgmRuleCoverage();
    assert.deepEqual(coverage.implemented, ['B1', 'K1', 'K2', 'K3', 'K4', 'K5', 'K6']);
    assert.deepEqual(coverage.notSupported, {}, 'no FHGM rule is declared unrun anymore; K4 runs against a feature layer and says so when it has none');
    assert.match(coverage.boundaries.K4.resolves, /feature rows/);
    assert.match(coverage.boundaries.K4.withoutFeatureLayer, /not-checked/);
    assert.match(coverage.boundaries.K4.unusableFeatureLayer, /unchecked/);
    assert.match(coverage.boundaries.K4.stillElsewhere, /gff3-validator/);
  });
});

// #19: the feature index that K4 resolves the file's own rows against is built
// only for a container that can hold GFF3 rows, while the FHGM lane used to ask
// for it whenever a header selected FHGFF3. A caller asserting a non-GFF3
// container - container sniffing, or an explicit `{container}` for a misfiled
// file - therefore reached a `null.finish()` and threw a TypeError where this
// module documents that findings come back in `errors`.
//
// Every case below is a call that threw before the fix, so a test that cannot
// fail is not what this is: the anchor assertions state why each case reaches
// the consumer at all (`schema.type` is FHGFF3 with a non-GFF3 container), and
// the lane assertions state what it must return instead of throwing.
describe('the FHGM lane on an FHGFF3 header in a container with no feature rows (#19)', () => {
  /**
   * One header field per line, in the flow form the FHGM vectors use. Every value
   * goes through `JSON.stringify`, which is also a YAML scalar, an array or an
   * object: `'1.1'` stays the string 1.1 and does not become a number.
   *
   * @param {Record<string, unknown>} record
   * @returns {string[]}
   */
  function headerLines(record) {
    return Object.entries(record)
      .filter(([key]) => key !== 'checksum')
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  }

  /**
   * The FHGM fixture header in a file whose prefix and body are FASTA, not GFF3.
   * `buildRawFasta` computes the root checksum over these exact bytes (R3, R4), so
   * the only finding against this file is its container, which `checksum.matches`
   * is asserted below: a fixture that failed for some other reason would say
   * nothing about the gate under test.
   *
   * @param {Record<string, unknown>} record
   * @returns {Uint8Array}
   */
  function asFastaContainer(record) {
    return buildRawFasta([...headerLines(record), 'checksum: COMPUTE']);
  }

  /** @type {AsyncGenerator<Uint8Array>} */
  async function* inChunks(bytes, size = 4096) {
    for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
  }

  /**
   * The same header judged at the direct call, for the comparison below.
   *
   * @param {Record<string, unknown>} header
   * @returns {import('../src/fhgm.js').FhgmResult}
   */
  function directly(header) {
    return checkFhgmModels(header, { base: { valid: true } });
  }

  // A real released vector, read as GFA: its `#~` block is also the GFA prefix, so
  // the header is found, selects FHGFF3, and digests to what it states.
  const gfaCarrier = { container: 'gfa', bytes: new Uint8Array(readFileSync(join(ROOT, 'reader-policy', 'counterparts', 'valid', 'fhgff3-both-links-canonical-parent.fhgff3.gff3'))) };
  // A synthetic FHGFF3 header carrying model records, written with the `;~` prefix
  // a FASTA file uses. `#~` is not the FASTA prefix, so reusing the GFF3 vector
  // here would fail at R2 before the lane ever ran: that is a coincidence of
  // prefix rules, not a guard, and it is why this fixture exists.
  const fastaCarrier = { container: 'fasta', bytes: asFastaContainer(fhgmHeader()) };

  for (const carrier of [gfaCarrier, fastaCarrier]) {
    for (const reader of [
      { name: 'inspectBytes', read: (bytes, options) => inspectBytes(bytes, options) },
      { name: 'inspectStream', read: (bytes, options) => inspectStream(inChunks(bytes), options) },
    ]) {
      it(`returns a Reading from ${reader.name} rather than throwing for an FHGFF3 header read in a ${carrier.container} container`, async () => {
        const reading = await reader.read(carrier.bytes, { container: carrier.container, drafts: true });
        // The anchor: this is the call that used to dereference the missing index.
        // Without these three the case could go green by never reaching the
        // consumer at all, which is how the guard written for #17 missed this.
        assert.equal(reading.schema.type, 'FHGFF3', 'the header must still select FHGFF3, or the FHGM consumer is unreachable');
        assert.equal(reading.container, carrier.container, 'and it is being read in a container that holds no GFF3 feature rows');
        assert.equal(reading.checksum.matches, true, 'the digest still holds: the container is this file\'s only finding');
        // The contract: a Reading comes back, the file is rejected for its container,
        // and the draft lane says it could not evaluate instead of vanishing.
        assert.equal(reading.valid, false);
        assert.deepEqual(reading.errors, [`a FHGFF3 header does not belong in a ${carrier.container} file, whatever its checksum says (docs/FORMAT.md)`]);
        assert.notEqual(reading.fhgm, undefined, 'the lane still reports on an FHGFF3 header');
        assert.equal(reading.fhgm.status, 'not-checked', 'B1: no sound FHGFF3 file in this container, so no model verdict exists');
        assert.equal(reading.fhgm.valid, false, 'a lane that cannot evaluate never reports a pass');
        assert.equal(reading.fhgm.rules.K4, 'skipped', 'K4 ran against no feature layer, so it states that instead of passing');
        assert.ok(reading.warnings.some((line) => /K4 not-checked/.test(line)), `the missing feature layer is named in the warnings, got ${JSON.stringify(reading.warnings)}`);
      });
    }
  }

  it('runs every other FHGM rule on such a file, and leaves K4 not-checked', async () => {
    // The fix must not become a way to skip the lane: with a caller that states the
    // base holds, K1, K2, K3 and K5 judge the records exactly as they do in a GFF3
    // file, and only K4 - the rule that needs feature rows - reports `not-checked`.
    const lane = await inspectStream(inChunks(fastaCarrier.bytes), { container: 'fasta', drafts: ['FHGM'], fhgm: { base: { valid: true } } });
    assert.equal(lane.fhgm.status, 'checked', 'the lane ran: FHGM checks are not dropped by the container gate');
    assert.deepEqual(lane.fhgm.rules, { K1: 'pass', K2: 'pass', K3: 'pass', K4: 'not-checked', K5: 'pass', B1: 'pass', K6: 'none' });
    assert.deepEqual(lane.fhgm, directly(fhgmHeader()), 'records, errors and warnings match the same header judged at the direct call with no feature layer');
    assert.equal(lane.fhgm.records[0].featureTarget, null, 'no feature target is claimed against rows nobody read');
  });
});

// #11 (scope per the 17:31 correction): three points where the draft lane's
// feature layer disagreed with the reference index in gff3-validator. The
// contract is that repository's tests/fixtures/features/outcomes.json - verdict
// map found->pass, not-found/duplicate-row/non-gene-target->reject,
// malformed-layer->unchecked, absent-layer->not-checked, the last two never
// scored - and the reproduction is scripts/feature_index_agreement.py there.
// Item 2 as originally filed ("index only gene rows") is a withdrawn
// misdiagnosis: the guard lives in the predicate, not the index, and is pinned
// by the two -transcript-row vectors, which still reject.
describe('K4 feature-layer parity with gff3-validator (#11, items 1, 2-prime and 3)', () => {
  it('does not let a second, distinct ID tag on one row address a featureId (#11, item 2-prime)', () => {
    // parity: repeated_id_tag.gff3 'gene:B' -> not-found -> reject, and
    // 'gene:A' -> found -> pass. On the divergent source this was an
    // end-to-end false acceptance: K4 passed a record whose target existed
    // only as a tag the owning checker never indexes.
    const row = 'toy\tpilot\tgene\t10\t30\t.\t+\t.\tID=gene:A;ID=gene:B';
    const second = judge(fhgmHeader({ models: [fhgmRecord({ featureId: 'gene:B' })] }), { features: `${row}\n` });
    assert.equal(second.rules.K4, 'reject', 'the second ID tag of a row is not an addressable identifier');
    assert.equal(second.records[0].featureTarget.verdict, 'reject');
    assert.match(second.errors.join(' '), /no local feature row carries the decoded ID "gene:B"/);

    const first = judge(fhgmHeader({ models: [fhgmRecord({ featureId: 'gene:A' })] }), { features: `${row}\n` });
    assert.equal(first.rules.K4, 'pass', 'the first tag still addresses its row: the fix narrows the index, it does not empty it');
  });

  it('gives an ID tag with no value no matching surface (#11, item 3)', () => {
    // parity: empty_id.gff3 '' -> not-found. The record side of the match
    // cannot be phrased end to end - the contract requires a non-empty
    // featureId (minLength 1), which is why this divergence was the one the
    // suite could not falsify - so the failable assertion is the index K4
    // consumes: an empty ID= must contribute no entry any pointer could land
    // on. Probed on the divergent source, a record with featureId '' against
    // a bare ID= row exited with rules.K4 stating 'pass' behind a K2 rejection
    // - an acceptance resting on an identifier the oracle does not index.
    const indexed = indexGff3FeatureRows('toy\tpilot\tgene\t10\t30\t.\t+\t.\tID=');
    assert.equal(indexed.rows.some((row) => row.id === ''), false, 'an ID= with no value is not an identifier');

    const empty = judge(fhgmHeader({ models: [fhgmRecord({ featureId: '' })] }), { features: 'toy\tpilot\tgene\t10\t30\t.\t+\t.\tID=\n' });
    assert.equal(empty.records[0].valid, false, 'K2 still refuses the empty featureId itself');
    assert.equal(empty.records[0].featureTarget, null, 'and nothing on the row side stands in for the check K4 could not run');
  });

  it('scores a lone-CR carrier by its rows, not by the scanner missing them (#21 review, finding 1)', () => {
    // The end-to-end form of the terminator bug: on the divergent source the
    // LF twin of these strings rejects (rows exist, none carries the ID) and
    // the CR twin abstains (the scanner read one directive-prefixed blob and
    // called it an empty layer) - so the same file got two different K4
    // answers depending on how its editor wrote line endings. A rejection
    // turned into an abstention is the silent direction the review blocks;
    // the gene-row case is the loud one it also forbids papering over: the
    // base had *that* backwards, rejecting a row the file really carried.
    const noId = 'toy\tpilot\texon\t10\t20\t.\t+\t.\tParent=g1';
    const abstain = judge(fhgmHeader(), { features: `##gff-version 3\r${noId}\r` });
    assert.equal(abstain.rules.K4, 'reject', 'a nine-field row under CR is a row: no matching ID still rejects');
    assert.match(abstain.errors.join(' '), /no local feature row carries/);
    const accepted = judge(fhgmHeader({ models: [fhgmRecord({ featureId: 'toy-a' })] }), { features: '##gff-version 3\rtoy\tpilot\tgene\t10\t30\t.\t+\t.\tID=toy-a\r' });
    assert.equal(accepted.rules.K4, 'pass', 'the gene row under CR is addressable, exactly like its LF twin');
    // And the correction must not overshoot into the other quiet answer:
    // CR comments and directives are no more feature rows than LF ones.
    const empty = judge(fhgmHeader(), { features: '##gff-version 3\r#~checksum: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\r# a comment\r' });
    assert.equal(empty.rules.K4, 'not-checked', 'a header-only CR file is still an absent layer, and still says so');
    assert.ok(empty.warnings.some((line) => /K4 not-checked/.test(line) && /no feature rows/.test(line)), 'the abstention is still named');
  });

  it('abstains from K4 when a readable layer carries zero feature rows (#11, item 1)', () => {
    // The abstention vocabulary is the one #20 shipped for a missing layer:
    // state 'none', rules.K4 'not-checked', a null featureTarget, and a
    // warning naming the missing rows. Zero feature rows is the same
    // observation one level down - the contract puts absent-layer in
    // never_scored - and must not invent a second state.
    const directives = '##gff-version 3\n#~schema: "https://w3id.org/fair-bioheaders/fhgff3/v0.6.0"\n# a comment\n';
    const text = judge(fhgmHeader(), { features: directives });
    assert.equal(text.rules.K4, 'not-checked', 'a readable file with no feature rows supports no conclusion about the pointer, in either direction');
    assert.equal(text.records[0].featureTarget, null, 'never scored means scored in neither direction: no pass, no reject, no per-record claim');
    assert.equal(text.valid, true, 'K1, K2, K3 and K5 still run and still hold');
    assert.equal(text.rules.K1, 'pass');
    assert.equal(text.errors.length, 0, `an abstention adds no rejection: ${JSON.stringify(text.errors)}`);
    assert.ok(text.warnings.some((line) => /K4 not-checked/.test(line) && /no feature rows/.test(line)), `the empty layer is named in the warnings, got ${JSON.stringify(text.warnings)}`);

    // the same answer from the two caller-built shapes that report a finished
    // layer, ONLY when they can actually characterize it - see the #21 review
    // finding below: an uncounted empty prebuilt index or row-fact array is
    // NOT evidence of absence, it is evidence this reading was handed.
    // (featureRows: 0 counted is; that abstention stays here.)
    assert.equal(judge(fhgmHeader(), { features: { rows: [], problems: [], featureRows: 0 } }).rules.K4, 'not-checked', 'a counted index that states zero feature rows is a characterized absence');

    // The contrasts, pinned by the parity contract: rows that carry no
    // identifiers are a layer with no match, "distinctly not absent-layer"
    // (rows_without_id.gff3 -> not-found); and the geneIds shorthand asserts
    // "no gene rows" about a layer, which stays scoreable (unchanged behaviour).
    assert.equal(judge(fhgmHeader(), { features: 'toy\tpilot\texon\t10\t20\t.\t+\t.\tParent=g1\n' }).rules.K4, 'reject', 'feature rows without IDs still reject a target: zero rows examined and no matching row are different observations');
    assert.equal(judge(fhgmHeader(), { features: { rows: [], problems: [], featureRows: 1 } }).rules.K4, 'reject', 'a prebuilt index that reports feature rows is a layer, even holding no ID entries');
    assert.equal(judge(fhgmHeader(), { geneIds: [] }).rules.K4, 'reject', 'the geneIds shorthand keeps its existing reading of an empty list');
  });

  it('treats an empty layer with no count as untrustworthy, never as absence (#21 review, finding 2)', () => {
    // The pre-#11 FeatureIndex shape carried only ID entries, so
    // `{rows: [], problems: []}` is byte-for-byte the same object for a file
    // with no rows at all and for a file whose every row lacks an ID. `rows.length`
    // cannot tell those apart, and this lane must not pretend otherwise:
    // not-checked would assert absence it never saw, reject would assert a
    // miss it never counted. The answer an untrustworthy layer already has -
    // `unchecked`, the lane's never-scored-but-loud verdict, mapped from the
    // shared outcomes.json's malformed-layer - is the honest one, with the
    // ambiguity itself stated in the problems so a later reader sees an
    // uncertain case, not an empty file.
    for (const [shape, uncounted] of [['legacy prebuilt index', { rows: [], problems: [] }], ['empty row-fact array', []]]) {
      const result = judge(fhgmHeader(), { features: uncounted });
      assert.equal(result.rules.K4, 'unchecked', `${shape}: uncounted-and-empty is not evidence of absence`);
      assert.equal(result.records[0].featureTarget.verdict, 'unchecked', `${shape}: the per-record answer names the state`);
      assert.match(result.records[0].featureTarget.detail, /cannot tell a file with no feature rows from rows that carry no identifiers/, `${shape}: the ambiguity itself is recorded, not swallowed`);
      assert.equal(result.valid, true, `${shape}: an unchecked clause rejects nothing and passes nothing`);
    }
    // the count, when the shape carries one, resolves the ambiguity in both
    // directions and neither verdict wobbles
    assert.equal(judge(fhgmHeader(), { features: { rows: [], problems: [], featureRows: 0 } }).rules.K4, 'not-checked', 'counted zero: a real absence, abstained');
    assert.equal(judge(fhgmHeader(), { features: { rows: [], problems: [], featureRows: 2 } }).rules.K4, 'reject', 'counted two with no ID entries: a real layer, rejected on its contents');
    // non-empty uncounted shapes need no count to be trusted: they state rows
    const facts = judge(fhgmHeader(), { features: [{ id: 'toy-a', type: 'gene' }] });
    assert.equal(facts.rules.K4, 'pass', 'a row-fact array with entries is a layer whatever its provenance');
  });

  it('reads a zero-feature-row GFF3 file through the lane as K4 not-checked (#11, item 1, end to end)', () => {
    const file = buildFhgff3File(fhgmHeader(), { rows: [] });
    const lane = inspectBytes(file.bytes, { container: 'gff3', drafts: ['FHGM'] });
    // The anchors first: this must be a sound FHGFF3 file whose lane ran, or
    // the case could go green by never reaching the K4 consumer.
    assert.equal(lane.schema.type, 'FHGFF3');
    assert.equal(lane.checksum.matches, true, 'the file is sound; only its feature layer is empty');
    assert.equal(lane.valid, true, 'the released FHGFF3 reading is untouched by anything on the lane side');
    assert.equal(lane.fhgm.status, 'checked', 'every other rule runs on this file');
    assert.equal(lane.fhgm.rules.K4, 'not-checked', 'the lane defaults to the file\'s own bytes, and those bytes hold no feature rows');
    assert.equal(lane.fhgm.records[0].featureTarget, null);
    assert.equal(lane.fhgm.valid, true, 'abstaining is not a rejection: the draft block claims nothing it did not see');
    assert.ok(lane.fhgm.warnings.some((line) => /K4 not-checked/.test(line) && /no feature rows/.test(line)), `the empty layer is named, got ${JSON.stringify(lane.fhgm.warnings)}`);

    // and a file with rows still scores normally, so the gate is emptiness
    // rather than a refusal to read GFF3 at all
    const withRow = inspectBytes(buildFhgff3File(fhgmHeader(), { rows: ['toy\tpilot\tgene\t10\t30\t.\t+\t.\tID=toy-a'] }).bytes, { container: 'gff3', drafts: ['FHGM'] });
    assert.equal(withRow.fhgm.rules.K4, 'pass', 'one gene row carrying toy-a still passes: the default resolver was not narrowed away');
  });
});

describe('FHGM#29 pinned-draft parity and adversarial controls (#23)', () => {
  it('K1 accepts all 8 registered FHGFF3 carrier release citations and refuses raw-main, v0.4.0, or missing URLs', () => {
    const registered = [
      'https://w3id.org/fair-bioheaders/fhgff3/v0.5.0',
      'https://w3id.org/fair-bioheaders/fhgff3/v0.5.0/',
      'https://raw.githubusercontent.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification/v0.5.0/fhgff3.json',
      'https://raw.githubusercontent.com/FAIR-bioHeaders/FHR-Specification/v0.5.0/fhgff3.json',
      'https://w3id.org/fair-bioheaders/fhgff3/v0.6.0',
      'https://w3id.org/fair-bioheaders/fhgff3/v0.6.0/',
      'https://raw.githubusercontent.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification/v0.6.0/fhgff3.json',
      'https://raw.githubusercontent.com/FAIR-bioHeaders/FHR-Specification/v0.6.0/fhgff3.json',
    ];
    for (const url of registered) {
      const result = judge(fhgmHeader({ header: { schema: url, schemaVersion: '1.1' } }));
      assert.equal(result.rules.K1, 'pass', `registered carrier citation ${url} must pass K1`);
    }
    const unregistered = [
      'https://raw.githubusercontent.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification/main/fhgff3.json',
      'https://raw.githubusercontent.com/FAIR-bioHeaders/FHR-Specification/main/fhgff3.json',
      'https://w3id.org/fair-bioheaders/fhgff3/v0.4.0',
      '',
      undefined,
    ];
    for (const url of unregistered) {
      const result = judge(fhgmHeader({ header: { schema: url, schemaVersion: '1.1' } }));
      assert.equal(result.rules.K1, 'reject', `unregistered carrier citation ${JSON.stringify(url)} must be refused under K1`);
      assert.match(result.errors.join(' '), /no registered FHGFF3 base release/);
    }
  });

  it('K4 requires a root gene row: rejects a non-empty Parent, an empty Parent=, and a bare Parent token', () => {
    const root = judge(fhgmHeader(), { features: 'toy\tpilot\tgene\t10\t30\t.\t+\t.\tID=toy-a\n' });
    assert.equal(root.rules.K4, 'pass');

    const nested = judge(fhgmHeader(), { features: 'toy\tpilot\tgene\t10\t30\t.\t+\t.\tID=toy-a;Parent=toy-b-rna\n' });
    assert.equal(nested.rules.K4, 'reject');
    assert.match(nested.errors.join(' '), /has a Parent attribute, so it is not a root gene row/);

    const emptyParent = judge(fhgmHeader(), { features: 'toy\tpilot\tgene\t10\t30\t.\t+\t.\tID=toy-a;Parent=\n' });
    assert.equal(emptyParent.rules.K4, 'reject', 'Parent= is a present tag with an empty value, not an absent tag');
    assert.match(emptyParent.errors.join(' '), /carries a Parent attribute with no readable value/);

    const bareParent = judge(fhgmHeader(), { features: 'toy\tpilot\tgene\t10\t30\t.\t+\t.\tID=toy-a;Parent\n' });
    assert.equal(bareParent.rules.K4, 'reject', 'a bare Parent token cannot support a root gene claim');
    assert.match(bareParent.errors.join(' '), /carries a Parent attribute with no readable value/);
  });

  it('K4 never substitutes U+FFFD for invalid UTF-8 percent-escapes in a GFF3 row ID', () => {
    const badUtf8 = judge(
      fhgmHeader({ models: [fhgmRecord({ featureId: '\ufffd' })] }),
      { features: 'toy\tpilot\tgene\t10\t30\t.\t+\t.\tID=%FF\n' },
    );
    assert.equal(badUtf8.rules.K4, 'reject', '%FF is not valid UTF-8 and must not false-match literal U+FFFD');
    assert.match(badUtf8.errors.join(' '), /percent-decoded bytes are not valid UTF-8/);

    const genuineReplacement = judge(
      fhgmHeader({ models: [fhgmRecord({ featureId: '\ufffd' })] }),
      { features: 'toy\tpilot\tgene\t10\t30\t.\t+\t.\tID=%EF%BF%BD\n' },
    );
    assert.equal(genuineReplacement.rules.K4, 'pass', 'genuine UTF-8 bytes for U+FFFD (%EF%BF%BD) still resolve to literal U+FFFD');
  });

  it('K4 keeps a leading BOM in a decoded row ID: %EF%BB%BFtoy-a never matches the plain toy-a (#21 review, Copilot finding)', () => {
    // TextDecoder strips a leading BOM by default even with fatal: true; with the
    // round-13 ignoreBOM fix the U+FEFF survives, so the row addresses as
    // '\ufefftoy-a' - never as 'toy-a', which is the invented match this guards.
    // The oracle agrees: unquote_to_bytes('toy-a') != b'\xef\xbb\xbftoy-a'.
    const bomRow = judge(
      fhgmHeader({ models: [fhgmRecord({ featureId: 'toy-a' })] }),
      { features: 'toy\tpilot\tgene\t10\t30\t.\t+\t.\tID=%EF%BB%BFtoy-a\n' },
    );
    assert.equal(bomRow.rules.K4, 'reject',
      'a BOM-prefixed row ID is a different identifier; matching it fabricates a resolution');
    assert.match(bomRow.errors.join(' '), /no local feature row carries/);

    // The draft contract forbids U+FEFF in featureId, so K2 prevents this record
    // from reaching K4. The decoder's retained key is asserted in features.test.mjs.
    const bomNamed = judge(
      fhgmHeader({ models: [fhgmRecord({ featureId: '\ufefftoy-a' })] }),
      { features: 'toy\tpilot\tgene\t10\t30\t.\t+\t.\tID=%EF%BB%BFtoy-a\n' },
    );
    assert.equal(bomNamed.rules.K2, 'reject');
    assert.equal(bomNamed.records[0].featureTarget, null);
  });

  it('K3 compares modelIds after Unicode NFC normalisation, after whole-array K2 and before K4/K5', () => {
    const nfcAndNfd = judge(
      fhgmHeader({
        models: [
          fhgmRecord({ modelId: 'model-caf\u00e9', featureId: 'toy-a' }),
          fhgmRecord({ modelId: 'model-cafe\u0301', featureId: 'toy-b' }),
        ],
      }),
      { geneIds: ['toy-a', 'toy-b'] },
    );
    assert.equal(nfcAndNfd.rules.K3, 'reject', 'NFC and NFD spellings of the same modelId collide under K3');
    assert.match(nfcAndNfd.errors.join(' '), /equal under NFC normalisation/);

    // Two records missing modelId must report K2 required-field errors, never K3 ambiguity on an invented empty string.
    const missingIds = judge(
      fhgmHeader({
        models: [
          { modelVersion: '1', featureId: 'toy-a', reference: { genomeReference: { accession: 'SYNTHETIC_ASSEMBLY.1', seqcol_id: 'J3Hvvqu0USaOuxA-3wRFyZ3YPdnSEDCp' } } },
          { modelVersion: '2', featureId: 'toy-b', reference: { genomeReference: { accession: 'SYNTHETIC_ASSEMBLY.1', seqcol_id: 'J3Hvvqu0USaOuxA-3wRFyZ3YPdnSEDCp' } } },
        ],
      }),
    );
    assert.equal(missingIds.rules.K2, 'reject');
    assert.equal(missingIds.rules.K3, 'pass', 'missing modelId is a K2 defect and must not invent an empty K3 collision');
    assert.ok(!missingIds.errors.some((e) => /K3:/.test(e)));

    // Deviation D4 ordering: K3 runs before per-record K4/K5 checks, so the first error attributes K3.
    const d4 = judge(
      fhgmHeader({
        models: [
          fhgmRecord({ modelId: 'model-a', featureId: 'toy-a' }),
          fhgmRecord({
            modelId: 'model-a',
            modelVersion: '2',
            featureId: 'toy-missing',
            reference: { genomeReference: { accession: 'OTHER.1', seqcol_id: 'J3Hvvqu0USaOuxA-3wRFyZ3YPdnSEDCp' } },
          }),
        ],
      }),
      { geneIds: ['toy-a'] },
    );
    assert.equal(d4.rules.K3, 'reject');
    assert.match(d4.errors[0], /K3: Ambiguous model ID "model-a"/, 'K3 must be reported before per-record K4/K5 errors');
  });
});
