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
import { fhgmHeader, fhgmRecord } from '../testutil/fixtures.mjs';

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

  it('applies the pinned overlay only when asked, and says which pin is narrower', () => {
    const currentRelease = judge(fhgmHeader({ header: { schema: 'https://w3id.org/fair-bioheaders/fhgff3/v0.6.0', schemaVersion: '1.2' } }));
    assert.equal(currentRelease.valid, true, 'the R15 reading admits extension fields from 1.1, so a 1.2 header transports');
    const overlay = judge(fhgmHeader({ header: { schema: 'https://w3id.org/fair-bioheaders/fhgff3/v0.6.0', schemaVersion: '1.2' } }), { overlay: true });
    assert.equal(overlay.rules.K1, 'reject', 'the overlay as drafted pins the v0.5.0 citation and 1.1, and refuses a 1.2 carrier');
    assert.match(overlay.errors.join(' '), /K1 overlay/);
    const pinned = judge(fhgmHeader({ header: { schema: 'https://w3id.org/fair-bioheaders/fhgff3/v0.5.0', schemaVersion: '1.1' } }), { overlay: true });
    assert.equal(pinned.valid, true, 'the overlay admits the identity it names');
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

  it('runs K4 only for a caller that brought the feature layer, and says which', () => {
    const without = judge(fhgmHeader());
    assert.equal(without.rules.K4, 'not-supported-yet', 'K4 is declared, not silently skipped');
    assert.equal(without.records[0].featureTarget, null);

    const resolved = judge(fhgmHeader({ models: [fhgmRecord({ featureId: 'toy%2Da' })] }), { geneIds: ['toy-a'] });
    assert.equal(resolved.valid, true, `a decoded ID that matches one gene row passes: ${resolved.errors.join('; ')}`);
    assert.equal(resolved.rules.K4, 'pass');
    assert.equal(resolved.records[0].featureTarget.verdict, 'pass');

    const missing = judge(fhgmHeader({ models: [fhgmRecord({ featureId: 'absent' })] }), { geneIds: ['toy-a'] });
    assert.equal(missing.rules.K4, 'reject');
    assert.match(missing.errors.join(' '), /must target one local gene row/);
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

  it('warns once per checked reading, naming the pin', () => {
    const result = judge(fhgmHeader());
    const line = result.warnings.find((entry) => entry.includes('unreleased draft'));
    assert.ok(line, 'a draft verdict must travel with the V7 warning');
    assert.ok(line.includes(draftEntry('FHGM').commit));
    assert.ok(line.includes(draftEntry('FHGM').sha256));
  });

  it('states the rule it does not run', () => {
    const coverage = fhgmRuleCoverage();
    assert.deepEqual(coverage.notSupported.K4.status, 'not-supported-yet');
    assert.match(coverage.notSupported.K4.reason, /GFF3 feature layer/);
    assert.ok(coverage.implemented.includes('K6'));
  });
});
