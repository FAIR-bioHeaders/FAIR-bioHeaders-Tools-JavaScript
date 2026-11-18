/**
 * Schema selection, rules V1 to V7 of `docs/SCHEMA-VERSIONS.md`.
 *
 * A reader looks only at the record's own `schema` value and matches it
 * exactly; it never falls back to another release, and a contract it does not
 * have is reported as `unsupported-version` rather than checked against a
 * different one.
 *
 * V7 is the opt-in lane for **unreleased draft contracts**. It is a parameter,
 * never a default: `selectSchema(record)` and `selectSchema(record, {})` behave
 * exactly as they did before V7 existed, and a draft citation is then "any other
 * value" under V5. Only `selectSchema(record, {drafts: ['FHT']})` - an explicit
 * caller decision naming the type - recognises the pinned draft, and its
 * selection carries the warning V7 requires on every record read that way.
 * Opening the lane recognises a proposal; it does not adopt one, and it does not
 * make a support claim: FHT and FHGM have no row in the shared
 * `schemas/versions.json`, no w3id URL and no release tag, and a release-shaped
 * URL for either type stays V5 even with the lane open. FHGM records carry no
 * `schema` field at all, so for them the lane selects the contract applied to
 * the records (`src/fhgm.js`), not the routing of the file.
 *
 * @module selection
 */

import { HeaderError } from './errors.js';
import { CURRENT_RELEASE, FHR1_RELEASE, describeSupport, releasesFor } from './registry.js';
import { citationIndex, DRAFT_TYPES, draftEntry, draftWarning } from './drafts.js';
import { RELEASED_TYPES, TYPES } from './types.js';

const RAW_PREFIX = 'https://raw.githubusercontent.com/FAIR-bioHeaders/';
/** The specification repository's current name and the name it held until #108. */
const SPEC_REPOS = new Set(['FAIR-bioHeaders-Specification', 'FHR-Specification']);
const W3ID_PREFIX = 'https://w3id.org/fair-bioheaders/';

// Which citation forms exist is not a hand-written list here: it is derived from
// the type registry, so a released type contributes its own `<file>.json` and its
// w3id path segment by being declared in src/types.js. That is what the registry
// is for. Before it, adding a type meant editing three tables in two files; now a
// released type appears under V1 and V3 automatically, and an unreleased one
// cannot appear at all, because RELEASED_TYPES reads the provenance files. The
// draft citations live in a separate index (src/drafts.js) precisely so V1 to V3
// can never reach them by accident.
const FILE_TYPES = new Map(RELEASED_TYPES.map((id) => [`${TYPES[id].pathSlug}.json`, id]));
const W3ID_TYPES = new Map(RELEASED_TYPES.map((id) => [TYPES[id].pathSlug, id]));

/**
 * @typedef {object} DraftLane
 * @property {string[]} [drafts] draft type ids whose V7 lane the caller chose:
 *   an array of ids (`['FHT']`), or `true` for every draft this build pins.
 *   Absent, `null` or `[]` leaves the lane shut.
 */

/**
 * The drafts the caller chose, as a Set of type ids.
 *
 * `true` means "every draft this build pins"; an array means exactly those ids;
 * anything else means the lane stays shut. An unknown id is a hard error rather
 * than a silent no-op, because a caller who asked for a lane it did not get would
 * otherwise read a V5 result believing it came from a draft contract.
 *
 * @param {DraftLane|{drafts?: string[]|true|false|null}} options
 * @returns {Set<string>}
 */
export function enabledDrafts(options) {
  const requested = options?.drafts;
  if (requested === undefined || requested === null || requested === false) return new Set();
  if (requested === true) return new Set(DRAFT_TYPES);
  if (!Array.isArray(requested)) {
    throw new HeaderError(`{drafts} must be true or an array of draft type ids, got ${JSON.stringify(requested)}`, { rule: 'V7', field: 'drafts' });
  }
  const set = new Set();
  for (const id of requested) {
    if (typeof id !== 'string' || draftEntry(id) === undefined) {
      throw new HeaderError(
        `{drafts} names ${JSON.stringify(id)}, which this build pins no draft contract for (drafts available: ${DRAFT_TYPES.join(', ') || 'none'})`,
        { rule: 'V7', field: 'drafts' },
      );
    }
    set.add(id);
  }
  return set;
}

/**
 * @typedef {object} Selection
 * @property {string} type the header type whose contract governs the record
 * @property {string|null} release the release tag of the contract this reader will
 *   use, for example `v0.6.0`; `null` for a draft, which has no release form
 * @property {'V1'|'V2'|'V3'|'V5'|'V6'|'V7'} rule the rule that chose it
 * @property {string} [warning] a warning to report with the reading (V6 and V7 set one)
 * @property {import('./drafts.js').DraftEntry} [draft] set only by V7
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

/** @param {string} text @returns {string} the text as a literal regular-expression fragment */
const literal = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * The raw-URL form of V1, V2 and V4: either name of the specification repository,
 * then a ref, then a released type's `<file>.json`, and nothing else.
 *
 * The ref is everything between the repository name and the final `/<file>.json`,
 * slashes included, so a multi-segment ref (`refs/heads/main`, `main/../v0.6.0`) is
 * kept whole. Only `main` (V1) and a release tag this build holds (V2) select a
 * contract; any other ref is V4, never the current contract. This is the toolkit's
 * own pattern (`bioheaders.selection.RAW`), which matches the ref with `.+?`: any
 * character except a line feed.
 */
const RAW_URL = new RegExp(
  `^${literal(RAW_PREFIX)}(?:${[...SPEC_REPOS].map(literal).join('|')})/([^\\n]+?)/(${[...FILE_TYPES.keys()].map(literal).join('|')})$`,
);

/**
 * @param {string} value
 * @returns {{type: 'FHR'|'FHP'|'FHGFF3', ref: string}|null}
 */
function parseRawUrl(value) {
  const match = RAW_URL.exec(value);
  if (match === null) return null;
  return { type: FILE_TYPES.get(match[2]), ref: match[1] };
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
 * @param {DraftLane} [options] `{drafts: [...]}` opens the V7 lane; with no
 *   option, no draft is recognised and every outcome is the V1-V6 result
 * @returns {Selection}
 * @throws {HeaderError} with `result: 'unsupported-version'` when V4 applies
 */
export function selectSchema(metadata, options = {}) {
  const drafts = enabledDrafts(options);
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

  // V7: the one lane-recognised form is the raw-main URL of the development
  // repository that owns the draft type, and only for a type the caller named.
  // The check sits after V1-V4 and before V5 so it cannot reach a released
  // citation, and it matches the whole URL, not a prefix: a FHT tag URL or a
  // `…/fht/vX.Y.Z` w3id URL names a release no registry lists, so it falls
  // through to V5 exactly as it did before this rule existed.
  if (drafts.size > 0) {
    const cited = citationIndex().get(value);
    if (cited !== undefined && drafts.has(cited)) {
      const entry = draftEntry(cited);
      return { type: cited, release: null, rule: 'V7', draft: entry, warning: draftWarning(entry) };
    }
  }

  // V5: any other value is FHR, checked against this reader's current FHR copy.
  return { type: 'FHR', release: CURRENT_RELEASE, rule: 'V5' };
}

/**
 * The releases a type can be selected against, or the pin a draft is read at.
 *
 * @param {string} type
 * @returns {{status: 'released'|'draft', releases?: string[], draft?: import('./drafts.js').DraftEntry}}
 */
export function selectableAs(type) {
  const releases = releasesFor(type);
  if (releases.length > 0) return { status: 'released', releases };
  const entry = draftEntry(type);
  if (entry !== undefined) return { status: 'draft', draft: entry };
  return { status: 'draft' };
}
