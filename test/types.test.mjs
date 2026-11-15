/**
 * The five-type registry: what it declares, and what it must never declare.
 *
 * The registry in `src/types.js` is the single statement of scope, and the
 * published matrix is rendered from it. These tests hold the two properties that
 * make that worth anything: the table agrees with the provenance files it claims
 * to read, and no cell states more than this build does. The second matters most
 * for the drafts - a `native` in a draft cell would be a support claim wearing a
 * machine-readable costume.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { CONTAINERS, DRAFT_TYPE_IDS, RELEASED_TYPES, SUPPORT, TYPES, TYPE_IDS, capability, capabilityRows, describeType, headerTypesByContainer } from '../src/types.js';
import { DRAFT_TYPES } from '../src/drafts.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const released = JSON.parse(readFileSync(join(ROOT, 'schemas', 'provenance.json'), 'utf8'));
const drafts = JSON.parse(readFileSync(join(ROOT, 'drafts', 'provenance.json'), 'utf8'));
const registry = JSON.parse(readFileSync(join(ROOT, 'conformance', 'manifest.json'), 'utf8'));

describe('the type table', () => {
  it('names exactly the five types the family is built from', () => {
    assert.deepEqual([...TYPE_IDS], ['FHR', 'FHP', 'FHGFF3', 'FHT', 'FHGM']);
    assert.deepEqual([...RELEASED_TYPES], ['FHR', 'FHP', 'FHGFF3']);
    assert.deepEqual([...DRAFT_TYPE_IDS], ['FHT', 'FHGM']);
    assert.deepEqual([...DRAFT_TYPES], ['FHT', 'FHGM'], 'the registry and the draft pin agree on which drafts exist');
  });

  it('agrees with schemas/provenance.json about what is released, contract for contract', () => {
    for (const type of RELEASED_TYPES) {
      const expected = Object.entries(released.releases)
        .filter(([, row]) => row[type] !== undefined)
        .map(([release, row]) => ({ release, schemaVersion: row[type].schemaVersion, file: row[type].file }));
      assert.deepEqual([...TYPES[type].contracts], expected, `${type} must list exactly the releases that published it, oldest first`);
      const current = expected.find((row) => row.release === released.current);
      assert.ok(current !== undefined, `${type} must have a contract at the current release ${released.current}`);
    }
    for (const type of DRAFT_TYPE_IDS) {
      assert.deepEqual([...TYPES[type].contracts], [], `${type} is a draft: it bundles no contract copy under a release tag`);
      assert.equal(released.releases[released.current][type], undefined, `schemas/provenance.json must list no ${type} contract at the current release`);
      for (const [release, row] of Object.entries(released.releases)) {
        assert.equal(row[type], undefined, `schemas/provenance.json lists a ${type} contract at ${release}; a draft takes no release form`);
      }
    }
  });

  it('gives every draft a pin and no release shape', () => {
    for (const type of DRAFT_TYPE_IDS) {
      const row = drafts.drafts[type];
      assert.equal(row.status, 'draft', `${type} must be labelled draft`);
      assert.equal(row.releaseTag, null, `${type} has no release tag`);
      assert.equal(row.w3id, null, `${type} has no w3id URL`);
      assert.equal(row.registryRow, null, `${type} has no schemas/versions.json row`);
      assert.match(row.sha256, /^[0-9a-f]{64}$/);
      assert.match(row.commit, /^[0-9a-f]{40}$/);
      assert.ok(row.citation.startsWith('https://raw.githubusercontent.com/FAIR-bioHeaders/'), 'V7 recognises only a raw-main citation');
      assert.ok(row.citation.endsWith(row.sourcePath), 'the citation names the file it pins');
      assert.equal(TYPES[type].citation, row.citation);
    }
  });

  it('describes a draft without a support claim and a released type without a version invention', () => {
    for (const type of DRAFT_TYPE_IDS) {
      const line = describeType(type);
      assert.match(line, /draft, no released contract/);
      assert.doesNotMatch(line, /supported/i, `${type}: a draft is recognised, never supported`);
      assert.doesNotMatch(line, /w3id\.org/, `${type}: no w3id URL for a draft`);
    }
    for (const type of RELEASED_TYPES) {
      const current = released.releases[released.current][type];
      assert.match(describeType(type), new RegExp(String(current.schemaVersion).replace('.', '\\.')), `${type} states its current contract version`);
    }
  });
});

describe('the container table', () => {
  it('is exactly the pre-lane table when no lane is requested', () => {
    assert.deepEqual(headerTypesByContainer(), { fasta: ['FHR', 'FHP'], gfa: ['FHR'], gff3: ['FHGFF3'] });
    assert.deepEqual(headerTypesByContainer([]), headerTypesByContainer());
  });

  it('widens only the container the opened draft lives in', () => {
    assert.deepEqual(headerTypesByContainer(['FHT']), { fasta: ['FHR', 'FHP', 'FHT'], gfa: ['FHR'], gff3: ['FHGFF3'] });
    assert.deepEqual(headerTypesByContainer(['FHGM']), { fasta: ['FHR', 'FHP'], gfa: ['FHR'], gff3: ['FHGFF3'] }, 'FHGM is not a header type, so no container gains one');
    assert.deepEqual(headerTypesByContainer(['FHT', 'FHGM']), { fasta: ['FHR', 'FHP', 'FHT'], gfa: ['FHR'], gff3: ['FHGFF3'] });
  });

  it('names every container it can return', () => {
    const table = headerTypesByContainer(['FHT']);
    for (const container of CONTAINERS) assert.ok(Array.isArray(table[container]), `${container} must appear, even when empty`);
  });
});

describe('the capability matrix', () => {
  const rows = capabilityRows();

  it('covers every type against every operation and serialization', () => {
    assert.equal(rows.length, TYPE_IDS.length * 7 * 6);
    for (const type of TYPE_IDS) {
      for (const operation of ['read', 'selectContract', 'validateContract', 'verifyChecksum', 'verifyParentLinks', 'strip', 'write']) {
        for (const serialization of CONTAINERS.concat(['model-records', 'jsonld', 'microdata'])) {
          const cell = rows.find((row) => row.type === type && row.operation === operation && row.serialization === serialization);
          assert.ok(cell !== undefined, `no cell for ${type}/${operation}/${serialization}`);
        }
      }
    }
  });

  it('never leaves an absent capability without a reason', () => {
    const unexplained = rows.filter((row) => row.support !== SUPPORT.native && (row.reason === null || row.reason.trim() === ''));
    assert.deepEqual(unexplained, [], 'a not-supported-yet or not-applicable cell must say why');
  });

  it('never claims a writer', () => {
    for (const type of TYPE_IDS) {
      for (const serialization of CONTAINERS) {
        assert.equal(capability(type, 'write', serialization).support, SUPPORT.notSupportedYet, `${type}/${serialization} must not claim writing`);
      }
    }
  });

  it('keeps the two unimplemented serializations unimplemented, for every type', () => {
    for (const type of TYPE_IDS) {
      for (const serialization of ['jsonld', 'microdata']) {
        const cell = capability(type, 'read', serialization);
        assert.ok([SUPPORT.notSupportedYet, SUPPORT.notApplicable].includes(cell.support), `${type}/${serialization} is not implemented; the matrix must not say otherwise`);
      }
    }
    // The shared manifest still counts these formats, so the not-run claim is about
    // this build, not about the suite: 63 vectors exist and none is scored here.
    const notRun = registry.vectors.filter((vector) => vector.format === 'jsonld' || vector.format === 'microdata');
    assert.equal(notRun.length, 63);
  });

  it('gives the released sequence containers the full native reading path', () => {
    for (const type of RELEASED_TYPES) {
      for (const serialization of TYPES[type].serializations) {
        if (!CONTAINERS.includes(serialization)) continue;
        for (const operation of ['read', 'selectContract', 'validateContract', 'verifyChecksum', 'strip']) {
          assert.equal(capability(type, operation, serialization).support, SUPPORT.native, `${type}/${operation}/${serialization}`);
        }
      }
    }
  });

  it('marks a draft reading as draft, never as native', () => {
    const draftOnlyCells = ['read', 'selectContract', 'validateContract', 'verifyChecksum', 'verifyParentLinks'];
    for (const type of DRAFT_TYPE_IDS) {
      for (const serialization of TYPES[type].serializations) {
        for (const operation of draftOnlyCells) {
          const cell = capability(type, operation, serialization);
          assert.notEqual(cell.support, SUPPORT.native, `${type}/${operation}/${serialization} would claim released-grade support`);
          assert.ok([SUPPORT.nativeDraft, SUPPORT.notApplicable].includes(cell.support), `${type}/${operation}/${serialization} got ${cell.support}`);
        }
        // Strip names no contract, so it is honestly native with the lane shut.
        assert.equal(capability(type, 'strip', serialization).support, SUPPORT.native);
      }
    }
  });

  it('states the FHGM rules this build runs, and the boundary on K4', () => {
    const cell = capability('FHGM', 'validateContract', 'model-records');
    assert.equal(cell.support, SUPPORT.nativeDraft);
    assert.match(cell.reason, /K4 feature-target resolution/);
    assert.match(cell.reason, /not-checked or unchecked, never a pass/);
    const featureLayer = capability('FHGM', 'read', 'gff3');
    assert.equal(featureLayer.support, SUPPORT.notApplicable, 'FHGM has no GFF3 header of its own');
    assert.match(featureLayer.reason, /not a header type/);
  });

  it('refuses to invent a type, operation or serialization', () => {
    assert.throws(() => capability('FHQ', 'read', 'fasta'), /unknown type/);
    assert.throws(() => capability('FHR', 'compress', 'fasta'), /unknown operation/);
    assert.throws(() => capability('FHR', 'read', 'bam'), /unknown serialization/);
  });
});
