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
import { inspectBytes } from '../src/reader.js';
import { draftEntry } from '../src/drafts.js';
import { buildFhgff3File, fhgmHeader, fhgmRecord } from '../testutil/fixtures.mjs';

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

  it('applies the pinned overlay only when asked, and the re-pinned overlay admits both released bases', () => {
    // FHGM-Specification#17 (maintainer dual-base decision, 2026-11-15) rewrote the
    // overlay from a single v0.5.0/1.1 pin into a closed anyOf of two pairings. The
    // earlier version of this test asserted the opposite - that a 1.2 carrier was
    // refused by the overlay and accepted only by the R15 reading - and that divergence
    // is what the re-pinned bytes closed. Both pairings now transport; a citation and a
    // stated version that contradict each other are still refused, by the overlay and
    // never by a fallback to the other branch.
    const currentRelease = judge(fhgmHeader({ header: { schema: 'https://w3id.org/fair-bioheaders/fhgff3/v0.6.0', schemaVersion: '1.2' } }));
    assert.equal(currentRelease.valid, true, 'the R15 reading admits extension fields from 1.1, so a 1.2 header transports');
    const onNewer = judge(fhgmHeader({ header: { schema: 'https://w3id.org/fair-bioheaders/fhgff3/v0.6.0', schemaVersion: '1.2' } }), { overlay: true });
    assert.equal(onNewer.rules.K1, 'pass', 'the re-pinned overlay admits the v0.6.0/1.2 pairing');
    assert.equal(onNewer.valid, true, onNewer.errors.join(' '));
    const onOlder = judge(fhgmHeader({ header: { schema: 'https://w3id.org/fair-bioheaders/fhgff3/v0.5.0', schemaVersion: '1.1' } }), { overlay: true });
    assert.equal(onOlder.valid, true, 'the overlay admits the v0.5.0/1.1 pairing it named before');
    for (const [schema, schemaVersion] of [['https://w3id.org/fair-bioheaders/fhgff3/v0.6.0', '1.1'], ['https://w3id.org/fair-bioheaders/fhgff3/v0.5.0', '1.2']]) {
      const crossed = judge(fhgmHeader({ header: { schema, schemaVersion } }), { overlay: true });
      assert.equal(crossed.rules.K1, 'reject', `${schema} with schemaVersion ${schemaVersion} is a contradiction, not a pairing`);
      assert.match(crossed.errors.join(' '), /K1 overlay/, 'and the refusal is attributed to the overlay');
      const plain = judge(fhgmHeader({ header: { schema, schemaVersion } }));
      assert.equal(plain.rules.K1, 'pass', 'the R15 reading alone cannot see the contradiction: it reads the stated version, not the citation');
    }
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
    assert.match(typed.errors.join(' '), /modelVersion must be string/);

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

    const resolved = judge(fhgmHeader({ models: [fhgmRecord({ featureId: 'toy%2Da' })] }), { geneIds: ['toy-a'] });
    assert.equal(resolved.valid, true, `a decoded ID that matches one gene row passes: ${resolved.errors.join('; ')}`);
    assert.equal(resolved.rules.K4, 'pass');
    assert.equal(resolved.records[0].featureTarget.verdict, 'pass');

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

  it('K4 reads GFF3 content through the injected resolver, decoded against decoded', () => {
    const gff3 = ['##gff-version 3', 'toy\tpilot\tgene\t10\t30\t.\t+\t.\tID=toy%2Da', '##FASTA', 'toy\tpilot\tgene\t1\t1\t.\t+\t.\tID=toy-a'].join('\n');
    const escaped = judge(fhgmHeader({ models: [fhgmRecord({ featureId: 'toy-a' })] }), { features: gff3 });
    assert.equal(escaped.rules.K4, 'pass', 'the row is ID=toy%2Da, the record names toy-a, and the second gene row sits after ##FASTA and is not indexed');
    const sameEscape = judge(fhgmHeader({ models: [fhgmRecord({ featureId: 'toy%2Da' })] }), { features: gff3 });
    assert.equal(sameEscape.rules.K4, 'pass', 'an escaped record side decodes to the same identifier');

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
    const bytes = new Uint8Array(readFileSync(join(ROOT, 'conformance', 'valid', 'fhgff3-both-links.fhgff3.gff3')));
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
