/**
 * Validation of a parsed header record against a released contract.
 *
 * The contracts declare JSON Schema draft 2020-12, so this module uses `ajv`'s
 * 2020-12 entry point (`ajv/dist/2020`). Draft-07 builds of any validator are
 * excluded: `contains`/`minContains` in `fhgff3.json` is a 2019-09-and-later
 * keyword, and the plain draft-07 entry point of `ajv` refuses the released
 * bytes outright. See `docs/CAPABILITY.md`.
 *
 * `format` is an annotation in 2020-12: a validator that does not opt in
 * ignores it. `docs/SCHEMA-VERSIONS.md` ("`format` is asserted") requires every
 * declared format to be checked, so `date` and `uri` are asserted here through
 * `ajv-formats`.
 *
 * Two requirements are normative but not expressible in the released schemas;
 * they are reported as warnings, because a validator "must not report the
 * record as invalid until the next major `schemaVersion` can reject it":
 *
 * - required values are non-empty;
 * - R14 link schemes.
 *
 * The `ajv` entry point, configuration and asserted formats are exported values
 * (`AJV_ENTRY`, `AJV_CONFIG`, `AJV_FORMATS`) and every instance comes from
 * `createCompiler()`, so the guarantee is a thing a test can read rather than a
 * thing a call site can quietly change. `test/ajv-config.test.mjs` asserts it.
 *
 * @module validate
 */

import { createRequire } from 'node:module';

import { HeaderError } from './errors.js';
import { loadSchema } from './registry.js';
import { loadDraft } from './drafts.js';
import { isUri } from './uri.js';

/**
 * The `ajv` entry point this library validates on: the draft/2020-12 build.
 *
 * Exported because it is load-bearing rather than incidental. The released contracts
 * declare `"$schema": "https://json-schema.org/draft/2020-12/schema"` and
 * `fhgff3.json` uses `contains`/`minContains`, a 2019-09-and-later keyword. The plain
 * `ajv` entry point is a draft-07 build: it refuses the released bytes outright
 * (`no schema with key or ref "…/draft/2020-12/schema"`), and where it does not refuse
 * them it reads the cardinality rule differently. Measured, not assumed:
 * `test/ajv-config.test.mjs` asserts the refusal from the vendored bytes.
 */
export const AJV_ENTRY = 'ajv/dist/2020';

/**
 * The configuration every contract this build compiles is compiled with.
 *
 * This object is the library's dialect guarantee, so it is an exported value rather
 * than a literal inside a private function: `test/ajv-config.test.mjs` asserts it key
 * by key, and `scripts/capability/ajv-dialect.mjs` builds its study instances from it
 * through `createCompiler()`, so the capability study measures the configuration in
 * use instead of a hand-maintained copy of it.
 *
 * `strictRequired` and `strictTypes` are off because `ajv`'s default strict mode
 * rejects the released `fhp.json` and `fhgff3.json` for two stylistic reasons (a
 * version gate whose `if` lists `completeness` in `required` without redeclaring it in
 * `properties`, and a `then` whose target property is a `$ref` without its own `type`).
 * Both are compile-time style checks; neither changes what a record means.
 *
 * `strict` itself stays the boolean `true`, and that is the key a vector cannot see:
 * every other drift in this object is observable through a failing test (a draft-07
 * entry point, `validateFormats: false`, or either relaxation removed all fail loudly),
 * but `strict: 'log'` alongside the two explicit relaxations compiles the same bytes
 * with the same silence, so it would pass the whole suite while voiding the guarantee
 * that the strict checks are still enforced for everything that is *not* deliberately
 * relaxed. `docs/CAPABILITY.md` records the measurement.
 *
 * `validateFormats` stays on because `format` is only an annotation in 2020-12: with it
 * off, `dateCreated: "2022-13-45"` validates. `allowUnionTypes` is needed because the
 * contracts use `type` arrays. `allErrors: false` is `ajv`'s own default and is stated
 * so that the reported set is part of the declared configuration.
 *
 * @type {Readonly<import('ajv').Options>}
 */
export const AJV_CONFIG = Object.freeze({
  strict: true,
  strictRequired: false,
  strictTypes: false,
  validateFormats: true,
  allowUnionTypes: true,
  allErrors: false,
});

/**
 * The `format` keywords asserted.
 *
 * `docs/SCHEMA-VERSIONS.md` ("`format` is asserted") requires every declared format to
 * be checked; these are the two the released contracts declare. `date` comes from
 * `ajv-formats`. `uri` is this library's own RFC 3986 check (`src/uri.js`): the
 * `ajv-formats` one refuses a URI with an empty hier-part (`urn:`, `doi:`, `mailto:`),
 * which RFC 3986 and the reference toolkit both accept.
 */
export const AJV_FORMATS = Object.freeze(['date', 'uri']);

/** The asserted formats taken from `ajv-formats`. */
const AJV_FORMATS_PACKAGE = Object.freeze(['date']);

const require = createRequire(import.meta.url);
const Ajv2020 = require(AJV_ENTRY).default;
const addFormats = require('ajv-formats').default;

/**
 * Accepted link schemes (FORMAT.md R14). `http`, `https` and `ftp` additionally
 * need `//` and something after it that is not another `/`.
 */
const LINK_SCHEMES_REQUIRING_AUTHORITY = new Set(['http', 'https', 'ftp']);
const LINK_SCHEMES = new Set(['urn', 'doi', 'info']);

/**
 * A URI-shaped value: a scheme, a colon and at least one character, none of them
 * whitespace, a control character or a bidirectional formatting character
 * (RFC 3987 section 4.1). The same form the reference toolkit tests for R14.
 */
const URI_FORM = /^([A-Za-z][A-Za-z0-9+.-]*):([^\p{White_Space}\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]+)$/u;

/**
 * @param {string} value a `format: uri` value, as written
 * @returns {boolean} whether R14 accepts its link scheme without a warning
 */
export function hasAcceptedLinkScheme(value) {
  if (typeof value !== 'string') return false;
  const match = URI_FORM.exec(value);
  if (match === null) return false;
  const scheme = match[1].toLowerCase();
  if (LINK_SCHEMES.has(scheme)) return true;
  if (LINK_SCHEMES_REQUIRING_AUTHORITY.has(scheme)) {
    const rest = match[2];
    return rest.startsWith('//') && rest.length > 2 && rest[2] !== '/';
  }
  return false;
}

let ajv = null;
/** @type {Map<string, {validate: Function, entry: import('./registry.js').SchemaEntry}>} */
const compiled = new Map();

/**
 * A fresh `ajv` instance carrying the configuration this library guarantees.
 *
 * This is the only place an `ajv` instance is constructed. The capability study and
 * the tests build theirs through here, so a change to `AJV_CONFIG` changes what they
 * measure; a study that restated the literals would keep reporting the properties of
 * a configuration the library no longer uses.
 *
 * Overrides exist for counterfactuals and are explicit at every call site, so each one
 * names the key it varies — `createCompiler({ validateFormats: false })` is a statement
 * about `validateFormats`, not an undocumented second configuration.
 *
 * @param {Partial<import('ajv').Options>} [overrides]
 * @returns {import('ajv').default}
 */
export function createCompiler(overrides = {}) {
  const instance = new Ajv2020({ ...AJV_CONFIG, ...overrides });
  addFormats(instance, { formats: [...AJV_FORMATS_PACKAGE] });
  instance.addFormat('uri', { type: 'string', validate: isUri });
  return instance;
}

/**
 * The shared `ajv` instance for released family contracts.
 *
 * @returns {import('ajv').default}
 */
function compiler() {
  if (ajv === null) ajv = createCompiler();
  return ajv;
}

/**
 * Compile (and cache) the validator for one contract this build holds.
 *
 * The `$id` of a vendored copy is its raw-main URL in the repository that owns
 * it, which every release of that type shares; `ajv` keys schemas by `$id`, so
 * the copies are compiled with it removed and keyed here by type and release
 * instead. The bundled files themselves keep their released bytes.
 *
 * A draft is keyed by its digest, not by a release: there is no release to name,
 * and two different pins of the same draft must not share a compiled validator.
 *
 * @param {string} type
 * @param {string|null} release release tag, or null for a V7 draft
 * @param {'contract'|'overlay'} [part] FHGM draft only: which pinned file
 * @returns {{validate: (data: unknown) => boolean, entry: import('./registry.js').SchemaEntry|import('./drafts.js').DraftEntry}}
 */
export function validator(type, release, part = 'contract') {
  if (release === null) return draftValidator(type, part);
  const key = `${type}@${release}`;
  const hit = compiled.get(key);
  if (hit !== undefined) return hit;
  const loaded = loadSchema(type, release);
  if (loaded === null) {
    throw new HeaderError(`this build bundles no ${type} contract at ${release}`, { rule: 'provenance' });
  }
  const schema = structuredClone(loaded.schema);
  delete schema.$id;
  const instance = compiler();
  const validate = instance.compile(schema);
  const built = { validate, entry: loaded.entry };
  compiled.set(key, built);
  return built;
}

/**
 * Compile (and cache) the validator for one pinned draft contract.
 *
 * `src/drafts.js` verifies the bytes against their recorded SHA-256 first, so a
 * draft that moved under this build is reported instead of quietly read.
 *
 * @param {string} type
 * @param {'contract'|'overlay'} [part]
 * @returns {{validate: (data: unknown) => boolean, entry: import('./drafts.js').DraftEntry}}
 */
export function draftValidator(type, part = 'contract') {
  const loaded = loadDraft(type, part);
  if (loaded === null) {
    throw new HeaderError(`this build pins no ${type} draft (${part})`, { rule: 'V7' });
  }
  const key = `draft:${type}@${part}@${loaded.entry.sha256}`;
  const hit = compiled.get(key);
  if (hit !== undefined) return hit;
  const schema = structuredClone(loaded.schema);
  delete schema.$id;
  const validate = compiler().compile(schema);
  const built = { validate, entry: loaded.entry };
  compiled.set(key, built);
  return built;
}

/**
 * @typedef {object} TypeDescriptor
 * @property {string[]} identityFields the type's name-and-version fields, whose
 *   values must not be empty (docs/SCHEMA-VERSIONS.md, "Required values are
 *   non-empty")
 * @property {string[]} authorLists list fields of author objects
 * @property {boolean} hasTaxon whether the type carries a `taxon` object
 */

/**
 * Per-type vocabulary for the non-empty warnings. Declared once, here, so a new
 * released type contributes a row instead of an `if`.
 *
 * @type {Record<string, TypeDescriptor>}
 */
export const TYPE_VOCABULARY = Object.freeze({
  FHR: { identityFields: ['genome', 'version'], authorLists: ['metadataAuthor', 'assemblyAuthor'], hasTaxon: true },
  FHP: { identityFields: ['proteome', 'version'], authorLists: ['metadataAuthor', 'assemblyAuthor'], hasTaxon: true },
  FHGFF3: { identityFields: ['annotation', 'version'], authorLists: ['metadataAuthor', 'assemblyAuthor'], hasTaxon: true },
  FHT: { identityFields: ['transcriptome', 'version'], authorLists: ['metadataAuthor', 'assemblyAuthor'], hasTaxon: true },
  FHGM: { identityFields: [], authorLists: ['contributors'], hasTaxon: false },
});

/**
 * The non-empty requirements of `docs/SCHEMA-VERSIONS.md` ("Required values are
 * non-empty"), reported as warnings: such a record is schema-valid but does not
 * describe the data.
 *
 * @param {Record<string, unknown>} record
 * @param {string} type
 * @returns {string[]}
 */
export function emptyValueWarnings(record, type) {
  const vocabulary = TYPE_VOCABULARY[type] ?? { identityFields: [], authorLists: [], hasTaxon: false };
  const warnings = [];
  for (const field of vocabulary.identityFields) {
    const value = record[field];
    if (typeof value === 'string' && value.trim() === '') {
      warnings.push(`${field}: required value is empty, so the record does not describe the data (docs/SCHEMA-VERSIONS.md)`);
    }
  }
  if (vocabulary.hasTaxon) {
    const taxon = record.taxon;
    if (taxon !== null && typeof taxon === 'object' && !Array.isArray(taxon)) {
      const t = /** @type {Record<string, unknown>} */ (taxon);
      const named = typeof t.name === 'string' && t.name.trim() !== '';
      const identified = typeof t.uri === 'string' && t.uri.trim() !== '';
      if (!named && !identified) {
        warnings.push('taxon: has neither a non-empty name nor a uri (docs/SCHEMA-VERSIONS.md)');
      }
    }
  }
  for (const field of vocabulary.authorLists) {
    const authors = record[field];
    if (authors === undefined) continue;
    if (!Array.isArray(authors)) continue; // the schema reports the type
    if (authors.length === 0) {
      warnings.push(`${field}: required list is empty (docs/SCHEMA-VERSIONS.md)`);
    }
    authors.forEach((author, index) => {
      if (author !== null && typeof author === 'object' && !Array.isArray(author)) {
        const a = /** @type {Record<string, unknown>} */ (author);
        if (!('name' in a) || (typeof a.name === 'string' && a.name.trim() === '')) {
          warnings.push(`${field}[${index}]: author has no non-empty name (docs/SCHEMA-VERSIONS.md)`);
        }
      }
    });
  }
  return warnings;
}

/**
 * The parsed contract document a selection or an explicit request points at.
 *
 * @param {string} type
 * @param {string|null} release release tag, or null for the pinned draft
 * @param {'contract'|'overlay'} [part]
 * @returns {Record<string, unknown>|null}
 */
function contractDocument(type, release, part = 'contract') {
  if (release === null) {
    const loaded = loadDraft(type, part);
    return loaded === null ? null : loaded.schema;
  }
  const loaded = loadSchema(type, release);
  return loaded === null ? null : loaded.schema;
}

/**
 * R14: collect `format: uri` declarations from a contract and check the
 * record's values against the accepted link schemes.
 *
 * The paths are derived from the contract itself rather than a hand-written
 * field list, so a new URI field in a later minor is covered without a change
 * here. `release: null` reads the pinned draft contract instead.
 *
 * @param {Record<string, unknown>} record
 * @param {string} type
 * @param {string|null} release
 * @returns {string[]} one warning per value with a scheme R14 does not accept
 */
export function linkSchemeWarnings(record, type, release) {
  const document = contractDocument(type, release);
  if (document === null) return [];
  const uriPaths = collectUriPaths(document, document);
  const warnings = [];
  const seen = new Set();
  for (const path of uriPaths) {
    for (const value of readPaths(record, path, '')) {
      if (typeof value.value !== 'string' || value.value === '') continue;
      if (hasAcceptedLinkScheme(value.value)) continue;
      const line = `R14 warning: ${value.path} is "${value.value}", which has no link scheme docs/FORMAT.md R14 accepts (http, https, ftp, urn:, doi:, info:)`;
      if (!seen.has(line)) {
        seen.add(line);
        warnings.push(line);
      }
    }
  }
  return warnings;
}

/**
 * JSON-pointer-like paths of every string slot the contract declares
 * `format: uri`. A segment of `null` means "every item of the array".
 *
 * The cycle guard tracks schema nodes by identity, not path: an `anyOf` branch
 * shares its parent's path, and guarding on the path alone drops the branch.
 *
 * @param {Record<string, unknown>} root the whole schema, for `$ref` targets
 * @param {unknown} node
 * @param {Array<string|null>} [prefix]
 * @param {Set<object>} [onPath] schema nodes already on this recursion path
 * @returns {Array<Array<string|null>>}
 */
function collectUriPaths(root, node, prefix = [], onPath = new Set()) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return [];
  if (onPath.has(/** @type {object} */ (node))) return [];
  const schema = /** @type {Record<string, unknown>} */ (node);
  const here = new Set(onPath).add(schema);
  const found = [];
  if (schema.format === 'uri') found.push([...prefix]);
  if (schema.properties !== null && typeof schema.properties === 'object') {
    for (const [name, child] of Object.entries(/** @type {Record<string, unknown>} */ (schema.properties))) {
      found.push(...collectUriPaths(root, child, [...prefix, name], here));
    }
  }
  if (typeof schema.items === 'object' && schema.items !== null) {
    found.push(...collectUriPaths(root, schema.items, [...prefix, null], here));
  }
  for (const branch of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(schema[branch])) {
      for (const child of schema[branch]) {
        found.push(...collectUriPaths(root, child, prefix, here));
      }
    }
  }
  if (typeof schema.$ref === 'string' && schema.$ref.startsWith('#/')) {
    const target = resolvePointer(root, schema.$ref);
    if (target !== undefined) found.push(...collectUriPaths(root, target, prefix, here));
  }
  return found;
}

/**
 * @param {Record<string, unknown>} root
 * @param {string} pointer a local JSON pointer, for example `#/$defs/Author`
 * @returns {unknown}
 */
function resolvePointer(root, pointer) {
  let node = root;
  for (const raw of pointer.slice(2).split('/')) {
    const token = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node !== null && typeof node === 'object' && token in /** @type {Record<string, unknown>} */ (node)) {
      node = /** @type {Record<string, unknown>} */ (node)[token];
    } else {
      return undefined;
    }
  }
  return node;
}

/**
 * @param {unknown} data
 * @param {Array<string|null>} path
 * @param {string} shown
 * @returns {Array<{path: string, value: unknown}>}
 */
function readPaths(data, path, shown) {
  if (path.length === 0) return [{ path: shown || 'metadata', value: data }];
  const [head, ...rest] = path;
  if (head === null) {
    if (!Array.isArray(data)) return [];
    return data.flatMap((item, index) => readPaths(item, rest, `${shown}[${index}]`));
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return [];
  const value = /** @type {Record<string, unknown>} */ (data)[head];
  if (value === undefined) return [];
  return readPaths(value, rest, shown === '' ? head : `${shown}.${head}`);
}

/**
 * @typedef {object} ValidationResult
 * @property {boolean} valid
 * @property {string[]} errors schema violations, empty when valid
 * @property {string[]} warnings non-schema requirements reported as warnings
 * @property {{type: string, release: string|null, schemaVersion: string|number|null, draft?: object}} schema
 */

/**
 * Validate a parsed header record against the contract that governs it.
 *
 * A V7 selection is validated against the pinned draft bytes, and its result is
 * labelled: `schema.release` and `schema.schemaVersion` are null because a draft
 * has taken neither form, and `schema.draft` carries the citation, commit and
 * digest the reading was taken against.
 *
 * @param {Record<string, unknown>} record
 * @param {import('./selection.js').Selection} selection
 * @returns {ValidationResult}
 */
export function validateRecord(record, selection) {
  const draft = selection.rule === 'V7';
  const { validate, entry } = draft ? draftValidator(selection.type, 'contract') : validator(selection.type, selection.release);
  const ok = validate(record);
  const errors = ok ? [] : (validate.errors ?? []).map((error) => formatError(error));
  const warnings = [...emptyValueWarnings(record, selection.type), ...linkSchemeWarnings(record, selection.type, selection.release)];
  if (selection.warning !== undefined) warnings.push(selection.warning);
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    schema: draft
      ? {
          type: selection.type,
          release: null,
          schemaVersion: null,
          draft: {
            status: 'draft',
            repository: selection.draft.repository,
            citation: selection.draft.citation,
            commit: selection.draft.commit,
            sha256: selection.draft.sha256,
            file: selection.draft.file,
          },
        }
      : { type: selection.type, release: selection.release, schemaVersion: entry.schemaVersion },
  };
}

/**
 * @param {import('ajv').ErrorObject} error
 * @returns {string}
 */
function formatError(error) {
  const where = error.instancePath === '' ? 'metadata' : error.instancePath;
  return `${where}: ${error.message} (${error.keyword})`;
}
