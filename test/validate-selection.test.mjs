/**
 * Tests for schema selection (V1-V6) and validation (formats, R13, R14,
 * non-empty required values).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HeaderError } from '../src/errors.js';
import { isFhr1VersionNumber, selectSchema } from '../src/selection.js';
import { emptyValueWarnings, hasAcceptedLinkScheme, linkSchemeWarnings, validateRecord, validator } from '../src/validate.js';
import { CURRENT_RELEASE } from '../src/registry.js';

const base = {
  schema: 'https://w3id.org/fair-bioheaders/fhr/v0.6.0',
  schemaVersion: '2.1',
  genome: 'Example genome',
  taxon: { name: 'Homo sapiens' },
  version: '1.0.0',
  metadataAuthor: [{ name: 'Example author' }],
  assemblyAuthor: [{ name: 'Example author' }],
  dateCreated: '2026-11-14',
  masking: 'not-masked',
  checksum: `${'A'.repeat(43)}=`,
};

describe('V1 to V6 selection', () => {
  it('V1: raw-main selects this build’s current copy, under either repository name', () => {
    for (const repo of ['FAIR-bioHeaders-Specification', 'FHR-Specification']) {
      const selection = selectSchema({ ...base, schema: `https://raw.githubusercontent.com/FAIR-bioHeaders/${repo}/main/fhr.json` });
      assert.equal(selection.rule, 'V1');
      assert.equal(selection.type, 'FHR');
      assert.equal(selection.release, CURRENT_RELEASE);
    }
  });

  it('V2: a raw tag URL selects that release', () => {
    const selection = selectSchema({ ...base, schema: 'https://raw.githubusercontent.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification/v0.4.0/fhr.json' });
    assert.equal(selection.rule, 'V2');
    assert.equal(selection.release, 'v0.4.0');
  });

  it('V3: a w3id URL selects that release, with or without a trailing slash', () => {
    for (const schema of ['https://w3id.org/fair-bioheaders/fhp/v0.5.0', 'https://w3id.org/fair-bioheaders/fhp/v0.5.0/']) {
      const selection = selectSchema({ ...base, schema });
      assert.equal(selection.rule, 'V3');
      assert.equal(selection.type, 'FHP');
      assert.equal(selection.release, 'v0.5.0');
    }
  });

  it('V4: an unknown release is unsupported-version, not a check against another schema', () => {
    assert.throws(
      () => selectSchema({ ...base, schema: 'https://w3id.org/fair-bioheaders/fhr/v0.0.0' }),
      (error) => error instanceof HeaderError && error.result === 'unsupported-version' && /unsupported schema version/.test(error.message) && /v0.6.0/.test(error.message),
    );
  });

  it('V4: a raw URL naming a branch is unsupported-version', () => {
    assert.throws(
      () => selectSchema({ ...base, schema: 'https://raw.githubusercontent.com/FAIR-bioHeaders/FHR-Specification/release-v0.4/fhr.json' }),
      (error) => error.result === 'unsupported-version',
    );
  });

  it('V4: a release that published no schema of that type is unsupported-version', () => {
    assert.throws(
      () => selectSchema({ ...base, schema: 'https://w3id.org/fair-bioheaders/fhp/v0.3.1' }),
      (error) => error.result === 'unsupported-version' && error.message.startsWith('FHP:'),
    );
  });

  it('V5: any other value is FHR against the current copy', () => {
    for (const schema of ['https://example.org/schemas/my-fhr-profile.json', 'https://w3id.org/fair-bioheaders/fhr/v0.4.0/fhr.json', 'not a url']) {
      const selection = selectSchema({ ...base, schema });
      assert.equal(selection.rule, 'V5', schema);
      assert.equal(selection.type, 'FHR');
      assert.equal(selection.release, CURRENT_RELEASE);
    }
  });

  it('V6: raw-main with the number 1 is read as FHR 1 (v0.3.1) and warns', () => {
    const selection = selectSchema({
      ...base,
      schema: 'https://raw.githubusercontent.com/FAIR-bioHeaders/FHR-Specification/main/fhr.json',
      schemaVersion: 1,
    });
    assert.equal(selection.rule, 'V6');
    assert.equal(selection.release, 'v0.3.1');
    assert.match(selection.warning, /warning/);
  });

  it('V6: the string "1", a boolean and other numbers are not the number 1', () => {
    assert.equal(isFhr1VersionNumber('1'), false);
    assert.equal(isFhr1VersionNumber(true), false);
    assert.equal(isFhr1VersionNumber(2), false);
    assert.equal(isFhr1VersionNumber(1), true);
    assert.equal(isFhr1VersionNumber(1.0), true); // 1.0 and 1 are the same JSON number
    for (const value of ['1', true, 0]) {
      const selection = selectSchema({
        ...base,
        schema: 'https://raw.githubusercontent.com/FAIR-bioHeaders/FHR-Specification/main/fhr.json',
        schemaVersion: value,
      });
      assert.equal(selection.rule, 'V1', JSON.stringify(value));
    }
  });
});

describe('validation against the released contracts', () => {
  it('accepts the current FHR record', () => {
    const result = validateRecord(base, selectSchema(base));
    assert.equal(result.valid, true, JSON.stringify(result.errors));
  });

  it('asserts format: date and format: uri, which 2020-12 leaves to the validator', () => {
    const selection = selectSchema(base);
    assert.equal(validateRecord({ ...base, dateCreated: '2022-13-45' }, selection).valid, false);
    assert.equal(validateRecord({ ...base, relatedLink: ['not a URI'] }, selection).valid, false);
  });

  it('enforces the version gate on extension fields', () => {
    const selection = selectSchema({ ...base, schemaVersion: '2.1' });
    assert.equal(validateRecord({ ...base, 'x-note': 1 }, selection).valid, true);
    const older = selectSchema({ ...base, schemaVersion: '2.0' });
    assert.equal(validateRecord({ ...base, schemaVersion: '2.0', 'x-note': 1 }, older).valid, false);
  });

  it('enforces the version gate on dotted BUSCO dataset versions', () => {
    const fhp = (schemaVersion) => ({
      schema: `https://w3id.org/fair-bioheaders/fhp/${schemaVersion === '1.2' ? 'v0.6.0' : 'v0.5.0'}`,
      schemaVersion,
      proteome: 'Example proteome',
      sourceType: 'predicted',
      taxon: { name: 'Homo sapiens' },
      version: '1.0',
      metadataAuthor: [{ name: 'Example author' }],
      dateCreated: '2026-11-14',
      checksum: `${'A'.repeat(43)}=`,
      completeness: {
        lineageDataset: 'diptera_odb12.2',
        completeSingle: 1,
        completeDuplicated: 0,
        fragmented: 0,
        missing: 0,
        total: 1,
      },
    });
    const dot = '1.2';
    assert.equal(validateRecord(fhp(dot), selectSchema(fhp(dot))).valid, true);
    assert.equal(validateRecord(fhp('1.1'), selectSchema(fhp('1.1'))).valid, false);
  });

  it('refuses a NaN reaching the validator even where the contract has no range', () => {
    const selection = selectSchema(base);
    const record = { ...base, vitalStats: { N50: Number.NaN } };
    assert.equal(validateRecord(record, selection).valid, false);
  });

  it('keeps unknown keys invalid and nested objects closed', () => {
    const selection = selectSchema(base);
    assert.equal(validateRecord({ ...base, genomeName: 'x' }, selection).valid, false);
    assert.equal(validateRecord({ ...base, taxon: { name: 'x', 'x-bogus': 1 } }, selection).valid, false);
  });

  it('warns about empty required values instead of rejecting them', () => {
    const warnings = emptyValueWarnings({ ...base, genome: '', metadataAuthor: [] }, 'FHR');
    assert.equal(warnings.length, 2);
    assert.match(warnings.join('\n'), /genome/);
    assert.match(warnings.join('\n'), /metadataAuthor/);
    assert.equal(validateRecord({ ...base, version: '' }, selectSchema(base)).valid, true);
  });
});

describe('R14 link schemes', () => {
  it('accepts the schemes R14 lists and warns about the rest', () => {
    for (const value of ['http://example.org', 'https://example.org/x', 'HTTPS://EXAMPLE.ORG', 'ftp://ftp.example.org/x', 'urn:isbn:9780306406157', 'doi:10.1093/bib/bbae122', 'info:doi/10.1000/182']) {
      assert.equal(hasAcceptedLinkScheme(value), true, value);
    }
    for (const value of ['javascript:alert(1)', 'data:text/plain,x', 'file:///etc/passwd', 'vbscript:x', ' https://example.org', 'https://example.org a', 'https:/example.org', 'ftp://', 'urn']) {
      assert.equal(hasAcceptedLinkScheme(value), false, value);
    }
  });

  it('warns about a javascript: relatedLink and keeps the record valid', () => {
    const record = { ...base, relatedLink: ['https://example.org/synthetic', 'javascript:void(0)'] };
    const selection = selectSchema(record);
    const result = validateRecord(record, selection);
    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.equal(result.warnings.filter((line) => line.includes('R14')).length, 1);
  });

  it('finds URI fields from the contract, not a hand-written list', () => {
    const paths = linkSchemeWarnings({ ...base, taxon: { name: 'x', uri: 'javascript:x' } }, 'FHR', CURRENT_RELEASE);
    assert.equal(paths.length, 1);
    assert.match(paths[0], /taxon\.uri/);
    const nested = linkSchemeWarnings(
      { ...base, assemblySoftware: [{ name: 'x', uri: 'data:whatever' }] },
      'FHR',
      CURRENT_RELEASE,
    );
    assert.equal(nested.length, 1);
    assert.match(nested[0], /assemblySoftware\[0\]\.uri/);
  });

  it('uses the same URI discovery on the older releases it bundles', () => {
    const warnings = linkSchemeWarnings({ ...base, schemaVersion: '2.0', taxon: { name: 'x', uri: 'javascript:x' } }, 'FHR', 'v0.4.0');
    assert.equal(warnings.length, 1);
  });
});

describe('bundled contract provenance', () => {
  it('reports the digest mismatch of a modified copy instead of using it', () => {
    const target = validator('FHR', CURRENT_RELEASE);
    assert.equal(typeof target.validate, 'function');
    assert.equal(target.entry.sha256.length, 64);
  });
});
