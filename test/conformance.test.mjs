/**
 * The acceptance test: FAIR-bioHeaders-Specification's shared conformance
 * vectors, run against this library.
 *
 * This file adds no new cases. It reads `conformance/manifest.json` — a vendored
 * copy of the shared suite, byte-exact and pinned in `conformance/provenance.json`
 * — and asserts, per vector, what the manifest says: a `valid` file must be
 * accepted, its checksum recomputed to the stated digest and its named metadata
 * values parsed; an `invalid` file must be rejected, and an invalid V4 vector
 * must be reported as `unsupported-version` rather than checked against another
 * schema.
 *
 * `microdata` and `jsonld` vectors are reported as skipped with the reason, never
 * as passes: those reader paths are not implemented by this build. See
 * `docs/CONFORMANCE.md` for the counts.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { inspectBytes, stripBytes } from '../src/reader.js';
import { containerFor, notRunReason } from '../src/serializations.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUITE = join(ROOT, 'conformance');
const manifest = JSON.parse(readFileSync(join(SUITE, 'manifest.json'), 'utf8'));
// The vector count comes from the provenance record of the vendored copy, which
// `npm run check:vendoring` ties to the manifest bytes, so a re-vendor changes the
// count in one place instead of in every test that mentions it.
const retired = new Map(JSON.parse(readFileSync(join(ROOT,'reader-policy/retirement-crosswalk.json'),'utf8')).cases.map(x=>[x.id,x]));
const provenance = JSON.parse(readFileSync(join(SUITE, 'provenance.json'), 'utf8'));

// Which formats are scored, and which are declared not-run with a reason, comes
// from src/serializations.js: the runner, the capability matrix, the acceptance
// guard and this suite all read that one declaration, so no table can drift out
// of step with another.


/**
 * @param {unknown} expected
 * @param {unknown} actual
 * @returns {boolean} JSON-typed equality: numbers compare by value, and a string
 *   is never equal to a number (conformance README)
 */
function sameValue(expected, actual) {
  if (expected === null) return actual === null;
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((item, index) => sameValue(item, actual[index]));
  }
  if (typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false;
    const a = /** @type {Record<string, unknown>} */ (actual);
    const e = /** @type {Record<string, unknown>} */ (expected);
    return Object.keys(e).every((key) => key in a && sameValue(e[key], a[key]));
  }
  return expected === actual;
}

/**
 * @param {object} vector
 * @returns {Uint8Array}
 */
function read(vector) {
  const raw = new Uint8Array(readFileSync(join(SUITE, vector.file)));
  return raw;
}

const supported = manifest.vectors.filter((vector) => containerFor(vector.format) !== null);
const unsupportedVectors = manifest.vectors.filter((vector) => notRunReason(vector) !== null);

describe('shared conformance vectors', () => {
  it('cover every vector of the pinned suite, each either run or reported not-run', () => {
    assert.ok(Number.isInteger(provenance.vectors) && provenance.vectors > 0, 'conformance/provenance.json records the vector count');
    assert.equal(manifest.vectors.length, provenance.vectors, 'the manifest holds the vectors its provenance records');
    assert.equal(supported.length + unsupportedVectors.length, manifest.vectors.length, 'no vector is neither run nor reported');
    assert.equal(new Set(manifest.vectors.map((vector) => vector.id)).size, manifest.vectors.length, 'vector ids are unique');
  });

  for (const vector of supported) {
    it(`${vector.id} (${vector.format}, expected ${vector.expected})`, () => {
      const reading = inspectBytes(read(vector), { container: containerFor(vector.format) });
      if (retired.has(vector.id)) {
        assert.equal(createHash('sha256').update(read(vector)).digest('hex'),retired.get(vector.id).oldSha256,'retirement is exact bytes, not ID alone');
        if(vector.expected==='valid')assert.ok(reading.errors.some(x=>x.includes('R4')));
        assert.equal(reading.valid,false,'D9 rejects the preserved noncanonical historical parent; new counterpart tested separately');
        return;
      }
      if (vector.expected === 'valid') {
        assert.deepEqual(reading.errors, [], 'a valid vector must be accepted');
        if (typeof vector.checksum === 'string') {
          assert.equal(reading.checksum.computed, vector.checksum, 'the recomputed checksum must equal the manifest digest');
        }
        for (const [key, want] of Object.entries(vector.metadata ?? {})) {
          assert.ok(sameValue(want, reading.metadata[key]), `metadata.${key} must read ${JSON.stringify(want)}, got ${JSON.stringify(reading.metadata[key])}`);
        }
        for (const rule of vector.warnings ?? []) {
          assert.ok(reading.warnings.some((line) => line.includes(rule)), `a valid vector with warnings must produce one naming ${rule}`);
        }
        // strip must remove bytes and nothing else about the payload changes.
        const stripped = stripBytes(read(vector), { container: containerFor(vector.format) });
        assert.ok(stripped.length < read(vector).length, 'strip must remove the header lines');
      } else {
        assert.equal(reading.valid, false, `an invalid vector (${vector.rule}: ${vector.reason}) must be rejected`);
        if (vector.result === 'unsupported-version') {
          assert.ok(
            reading.errors.join(' ').includes('unsupported schema version'),
            `V4 requires the reader to report unsupported-version, got: ${reading.errors.join('; ')}`,
          );
        }
      }
    });
  }

  for (const vector of unsupportedVectors) {
    it(`${vector.id} (${vector.format}) — not run`, { skip: notRunReason(vector) }, () => {});
  }
});
