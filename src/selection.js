/**
 * Schema selection, rules V1 to V6 of `docs/SCHEMA-VERSIONS.md`.
 *
 * A reader looks only at the record's own `schema` value and matches it
 * exactly; it never falls back to another release, and a contract it does not
 * have is reported as `unsupported-version` rather than checked against a
 * different one. V7, the opt-in draft lane, is deliberately not implemented:
 * FHT and FHGM have no released contract, no `schemaVersion`, no w3id URL and no
 * row in the shared `schemas/versions.json`, so this library publishes no draft
 * and makes no support claim for either type.
 *
 * @module selection
 */

import { HeaderError } from './errors.js';
import { CURRENT_RELEASE, FHR1_RELEASE, describeSupport, releasesFor } from './registry.js';

const RAW_PREFIX = 'https://raw.githubusercontent.com/FAIR-bioHeaders/';
/** The specification repository's current name and the name it held until #108. */
const SPEC_REPOS = new Set(['FAIR-bioHeaders-Specification', 'FHR-Specification']);
const W3ID_PREFIX = 'https://w3id.org/fair-bioheaders/';
const FILE_TYPES = new Map([
  ['fhr.json', 'FHR'],
  ['fhp.json', 'FHP'],
  ['fhgff3.json', 'FHGFF3'],
]);
const W3ID_TYPES = new Map([
  ['fhr', 'FHR'],
  ['fhp', 'FHP'],
  ['fhgff3', 'FHGFF3'],
]);

/**
 * @typedef {object} Selection
 * @property {'FHR'|'FHP'|'FHGFF3'} type the header type whose contract governs the record
 * @property {string} release the release tag of the contract this reader will use, for example `v0.6.0`
 * @property {'V1'|'V2'|'V3'|'V5'|'V6'} rule the rule that chose it
 * @property {string} [warning] a warning to report with the reading (only V6 sets one)
 */

/**
 * V6: `schemaVersion` the JSON number 1, as FHR 1 writers wrote it. `1` and
 * `1.0` are the same number; the string `'1'`, a boolean and any other number
 * are not.
 *
 * @param {unknown} stated the record's `schemaVersion`
 * @returns {boolean}
 */
export function isFhr1VersionNumber(stated) {
  return typeof stated === 'number' && Number.isFinite(stated) && stated === 1;
}

/**
 * @param {string} value
 * @returns {{type: 'FHR'|'FHP'|'FHGFF3', ref: string}|null}
 */
function parseRawUrl(value) {
  if (!value.startsWith(RAW_PREFIX)) return null;
  const parts = value.slice(RAW_PREFIX.length).split('/');
  if (parts.length !== 3) return null;
  const [repo, ref, file] = parts;
  if (!SPEC_REPOS.has(repo) || ref === '' || !FILE_TYPES.has(file)) return null;
  return { type: FILE_TYPES.get(file), ref };
}

/**
 * @param {string} value
 * @returns {{type: 'FHR'|'FHP'|'FHGFF3', release: string}|null}
 */
function parseW3idUrl(value) {
  const trimmed = value.endsWith('/') ? value.slice(0, -1) : value; // V3: a trailing slash is the same URL
  if (!trimmed.startsWith(W3ID_PREFIX)) return null;
  const parts = trimmed.slice(W3ID_PREFIX.length).split('/');
  if (parts.length !== 2) return null;
  const type = W3ID_TYPES.get(parts[0]);
  if (type === undefined) return null;
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(parts[1])) return null;
  return { type, release: parts[1] };
}

/**
 * V4: this reader has no such contract, so the record is not checked against
 * another one. The message names the value and the releases the reader has.
 *
 * @param {'FHR'|'FHP'|'FHGFF3'} type
 * @param {string} value the record's `schema` value
 * @returns {never}
 */
function unsupportedVersion(type, value) {
  throw new HeaderError(`${type}: unsupported schema version: ${value} (this tool has ${type} schemas for ${describeSupport(type)})`, {
    rule: 'V4',
    result: 'unsupported-version',
    field: 'schema',
  });
}

/**
 * Choose the contract that governs a record.
 *
 * @param {Record<string, unknown>} metadata a parsed header record
 * @returns {Selection}
 * @throws {HeaderError} with `result: 'unsupported-version'` when V4 applies
 */
export function selectSchema(metadata) {
  const value = metadata.schema;
  if (typeof value !== 'string' || value.length === 0) {
    return { type: 'FHR', release: CURRENT_RELEASE, rule: 'V5' };
  }

  const raw = parseRawUrl(value);
  if (raw !== null) {
    if (raw.ref === 'main') {
      if (raw.type === 'FHR' && isFhr1VersionNumber(metadata.schemaVersion)) {
        // V6: an FHR 1 record citing raw-main is read against v0.3.1, the last
        // FHR 1 contract. Deprecated, not invalid, and the reader warns.
        return {
          type: 'FHR',
          release: FHR1_RELEASE,
          rule: 'V6',
          warning:
            `FHR: warning: schemaVersion 1 via the raw-main schema URL is read as FHR 1 (${FHR1_RELEASE}); ` +
            `cite ${W3ID_PREFIX}fhr/${FHR1_RELEASE} or move to schemaVersion "2.0"`,
        };
      }
      return { type: raw.type, release: CURRENT_RELEASE, rule: 'V1' }; // V1
    }
    if (releasesFor(raw.type).includes(raw.ref)) {
      return { type: raw.type, release: raw.ref, rule: 'V2' }; // V2
    }
    unsupportedVersion(raw.type, value); // V4: a ref that is neither main nor a release tag
  }

  const w3id = parseW3idUrl(value);
  if (w3id !== null) {
    if (releasesFor(w3id.type).includes(w3id.release)) {
      return { type: w3id.type, release: w3id.release, rule: 'V3' }; // V3
    }
    unsupportedVersion(w3id.type, value); // V4: unknown release, or one that published no such contract
  }

  // V5: any other value is FHR, checked against this reader's current FHR copy.
  return { type: 'FHR', release: CURRENT_RELEASE, rule: 'V5' };
}
