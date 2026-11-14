/**
 * The rule-V7 draft lane: what it recognises, and what it refuses to be.
 *
 * V7 lets a reader *recognise* an unreleased draft contract, and only where the
 * user explicitly chose that lane. The requirements this module implements:
 *
 * - the lane is never the default: with no `drafts` option, nothing here runs and
 *   a draft citation stays "any other value" under V5, which is the behaviour
 *   this library had before the lane existed (`test/default-gate.test.mjs` and
 *   `test/goldens/default-gate.json` hold the byte-identity proof);
 * - the draft bytes are vendored and pinned the way the family pins a copied
 *   tree: the commit of the development repository that owns the type and the
 *   SHA-256 of the exact bytes, recorded in `drafts/provenance.json` and
 *   re-verified the first time a draft is loaded, so selection can never run
 *   against a moving `main`;
 * - every record read through the lane carries a loud warning naming the draft,
 *   its commit and its digest, and saying the result is not a
 *   released-contract result;
 * - a draft takes no release form. Nothing here has a release tag, a w3id URL or
 *   a row in the shared `schemas/versions.json`, and a release-shaped URL for a
 *   type the registry does not list stays V5 even with the lane open.
 *
 * FHGM needs one more distinction: it is not a header type at all. An FHGM
 * record carries no `schema` field; the records ride inside an FHGFF3 header
 * under the `x-fhgm-models` extension key, the file is routed by its own FHGFF3
 * citation under V1 to V3, and the FHGM lane selects only the contract and the
 * checks applied to those records (`src/fhgm.js`).
 *
 * @module drafts
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HeaderError } from './errors.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Absolute path of the directory holding the vendored draft bytes. */
export const DRAFT_DIR = resolve(HERE, '..', 'drafts');

const PROVENANCE_PATH = join(DRAFT_DIR, 'provenance.json');

if (!existsSync(PROVENANCE_PATH)) {
  // A missing draft registry is a packaging fault, not a runtime condition:
  // saying so here beats reporting every draft citation as an unknown value.
  throw new HeaderError(`drafts/provenance.json is missing from this build; the V7 lane cannot load (rule V7)`, { rule: 'V7' });
}

/**
 * The draft registry as written. `drafts` is keyed by type id; FHGM also nests a
 * `transportOverlay` row, which is checked with the same digest discipline.
 */
export const draftProvenance = JSON.parse(readFileSync(PROVENANCE_PATH, 'utf8'));

/** Type ids that have a draft in this build, in registry order. */
export const DRAFT_TYPES = Object.freeze(Object.keys(draftProvenance.drafts));

/**
 * @typedef {object} DraftEntry
 * @property {'FHT'|'FHGM'} type
 * @property {'draft'} status always `draft`: a published contract leaves this lane
 * @property {string} citation the raw-main URL of the repository that owns the type
 * @property {string} repository development repository that owns the type
 * @property {string} commit the pinned revision of that repository
 * @property {string} sha256 digest of the exact vendored bytes
 * @property {string} file vendored file name inside `drafts/`
 * @property {string} path absolute path of the vendored file
 * @property {string} sourcePath path of the file in the owning repository
 * @property {null} releaseTag a draft has no release tag, by rule
 * @property {null} w3id a draft has no w3id URL, by rule
 * @property {null} registryRow a draft has no `schemas/versions.json` row, by rule
 * @property {DraftEntry} [overlay] FHGM only: the transport overlay pinned beside it
 */

/**
 * @param {string} type
 * @returns {DraftEntry|undefined} the pinned entry, or undefined for a type with no draft
 */
export function draftEntry(type) {
  const row = draftProvenance.drafts[type];
  if (row === undefined) return undefined;
  const built = {
    type,
    status: row.status,
    citation: row.citation,
    repository: row.repository,
    commit: row.commit,
    sha256: row.sha256,
    file: row.file,
    path: join(DRAFT_DIR, row.file),
    sourcePath: row.sourcePath,
    bytes: row.bytes,
    releaseTag: row.releaseTag ?? null,
    w3id: row.w3id ?? null,
    registryRow: row.registryRow ?? null,
  };
  if (row.transportOverlay !== undefined) {
    const overlay = row.transportOverlay;
    built.overlay = {
      type,
      status: 'draft',
      citation: overlay.citation,
      repository: row.repository,
      commit: overlay.commit,
      sha256: overlay.sha256,
      file: overlay.file,
      path: join(DRAFT_DIR, overlay.file),
      sourcePath: overlay.sourcePath,
      bytes: overlay.bytes,
      releaseTag: null,
      w3id: null,
      registryRow: null,
    };
  }
  return built;
}

/**
 * The V7 citation a record may use to reach a draft: the raw-main URL of the
 * owning development repository, and nothing else.
 *
 * @returns {Map<string, string>} citation URL → type id
 */
export function citationIndex() {
  const index = new Map();
  for (const type of DRAFT_TYPES) {
    const entry = draftEntry(type);
    if (entry !== undefined) index.set(entry.citation, type);
  }
  return index;
}

/**
 * The warning V7 requires on every record read through the lane.
 *
 * @param {DraftEntry} entry
 * @returns {string}
 */
export function draftWarning(entry) {
  return (
    `${entry.type}: warning: schema ${entry.citation} is an unreleased draft ` +
    `(commit ${entry.commit}, sha256 ${entry.sha256} of those bytes); ` +
    'read against that pinned draft, not a released schema'
  );
}

const verified = new Set();

/**
 * Confirm the vendored draft bytes still match the digest recorded for them.
 *
 * A mismatch is reported, never papered over: V7 says a reader "says so instead
 * of quietly choosing a newer draft", because a reading that claims to be
 * current would otherwise move out of sight under the caller.
 *
 * @param {DraftEntry} entry
 */
function assertDigest(entry) {
  if (verified.has(entry.path)) return;
  if (!existsSync(entry.path)) {
    throw new HeaderError(`the pinned draft file drafts/${entry.file} is missing from this build (rule V7)`, { rule: 'V7' });
  }
  const digest = createHash('sha256').update(readFileSync(entry.path)).digest('hex');
  if (digest !== entry.sha256) {
    throw new HeaderError(
      `the pinned draft drafts/${entry.file} does not match its recorded provenance: sha256 ${digest}, expected ${entry.sha256} (${entry.repository} ${entry.commit}, ${entry.sourcePath}); the draft moved and this build was not re-pinned (rule V7)`,
      { rule: 'V7', field: `drafts/${entry.file}` },
    );
  }
  verified.add(entry.path);
}

const cache = new Map();

/**
 * The parsed JSON Schema document of a pinned draft, or null when this build has
 * no draft of that type.
 *
 * @param {string} type
 * @param {'contract'|'overlay'} [part] FHGM only: `overlay` asks for the transport
 *   overlay instead of the record contract
 * @returns {{schema: Record<string, unknown>, entry: DraftEntry}|null}
 */
export function loadDraft(type, part = 'contract') {
  const entry = draftEntry(type);
  if (entry === undefined) return null;
  const target = part === 'overlay' ? entry.overlay : entry;
  if (target === undefined) return null;
  const key = `${type}@${part}@${target.sha256}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  assertDigest(target);
  const loaded = { schema: JSON.parse(readFileSync(target.path, 'utf8')), entry: target };
  cache.set(key, loaded);
  return loaded;
}

/**
 * @param {string} type
 * @returns {boolean} whether this build carries a pinned draft of that type
 */
export function hasDraft(type) {
  return draftProvenance.drafts[type] !== undefined;
}

/**
 * The lane this build can open, in the words a caller should print. It states
 * the pin, and states equally that none of it is a released contract.
 *
 * @returns {Array<{type: string, citation: string, commit: string, sha256: string, status: string}>}
 */
export function draftSupport() {
  return DRAFT_TYPES.map((type) => {
    const entry = draftEntry(type);
    return { type, citation: entry.citation, commit: entry.commit, sha256: entry.sha256, status: entry.status };
  });
}

export { provenanceAsWritten };

/**
 * The registry exactly as the file says it, for `scripts/check-vendoring.mjs`.
 * Named apart from `draftProvenance` so nothing mistakes it for the live view.
 *
 * @returns {Record<string, unknown>}
 */
function provenanceAsWritten() {
  return JSON.parse(readFileSync(PROVENANCE_PATH, 'utf8'));
}

/**
 * Re-verify every pinned draft file against the digest recorded for it.
 *
 * `dir` exists so a caller, or a test, can point at a copy: the lane's promise is
 * that bytes which no longer match their recorded digest are reported instead of
 * read, and that promise has to be checkable without touching the vendored tree.
 *
 * @param {string} [dir] the directory holding the draft bytes
 * @returns {Array<{file: string, type: string, part: string, expected: string, actual: string|null}>}
 *   one row per problem; empty when every digest matches
 */
export function verifyDraftBytes(dir = DRAFT_DIR) {
  /** @type {Array<{file: string, type: string, part: string, expected: string, actual: string|null}>} */
  const problems = [];
  for (const type of DRAFT_TYPES) {
    const entry = draftEntry(type);
    for (const [part, target] of [['contract', entry], ['overlay', entry.overlay]]) {
      if (target === undefined) continue;
      const path = join(dir, target.file);
      if (!existsSync(path)) {
        problems.push({ file: target.file, type, part, expected: target.sha256, actual: null });
        continue;
      }
      const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
      if (actual !== target.sha256) problems.push({ file: target.file, type, part, expected: target.sha256, actual });
    }
  }
  return problems;
}
