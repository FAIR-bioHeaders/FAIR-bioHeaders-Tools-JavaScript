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
 * @module validate
 */

import { createRequire } from 'node:module';

import { HeaderError } from './errors.js';
import { loadSchema } from './registry.js';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats').default;

/**
 * Accepted link schemes (FORMAT.md R14). `http`, `https` and `ftp` additionally
 * need `//` and a host.
 */
const LINK_SCHEMES_REQUIRING_AUTHORITY = new Set(['http', 'https', 'ftp']);
const LINK_SCHEMES = new Set(['urn', 'doi', 'info']);

/** RFC 3987 section 4.1 bidirectional formatting characters. */
const BIDI_CHARS = /[\u200e\u200f\u202a-\u202e]/;

/**
 * @param {string} value a `format: uri` value, as written
 * @returns {boolean} whether R14 accepts its link scheme without a warning
 */
export function hasAcceptedLinkScheme(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  // A value with whitespace, a control character or a bidirectional formatting
  // character anywhere has no accepted scheme.
  if (/[\p{White_Space}\u0000-\u0020\u007f-\u009f]/u.test(value) || BIDI_CHARS.test(value)) return false;
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/s.exec(value);
  if (match === null) return false;
  const scheme = match[1].toLowerCase();
  if (LINK_SCHEMES.has(scheme)) return true;
  if (LINK_SCHEMES_REQUIRING_AUTHORITY.has(scheme)) {
    const authority = /^\/\/([^/?#]*)/.exec(match[2]);
    if (authority === null) return false;
    const host = authority[1].split('@').pop().split(':')[0];
    return host.length > 0;
  }
  return false;
}

let ajv = null;
/** @type {Map<string, {validate: Function, entry: import('./registry.js').SchemaEntry}>} */
const compiled = new Map();

/**
 * The shared `ajv` instance for released family contracts.
 *
 * `strictRequired` and `strictTypes` are off: `ajv`'s default strict mode
 * rejects the released `fhp.json` and `fhgff3.json` for two stylistic reasons
 * (a version gate whose `if` lists `completeness` in `required` without
 * redeclaring it in `properties`, and a `then` whose target property is a `$ref`
 * without its own `type`). Both are compile-time style checks; neither changes
 * what a record means. See `docs/CAPABILITY.md`.
 *
 * @returns {import('ajv').default}
 */
function compiler() {
  if (ajv === null) {
    ajv = new Ajv2020({
      strict: true,
      strictRequired: false,
      strictTypes: false,
      validateFormats: true,
      allowUnionTypes: true,
      allErrors: false,
    });
    addFormats(ajv, { formats: ['date', 'uri'] });
  }
  return ajv;
}

/**
 * Compile (and cache) the validator for one released contract.
 *
 * The `$id` of a vendored copy is its raw-main URL in the specification
 * repository, which every release of that type shares; `ajv` keys schemas by
 * `$id`, so the copies are compiled with it removed and keyed here by type and
 * release instead. The bundled files themselves keep their released bytes.
 *
 * @param {'FHR'|'FHP'|'FHGFF3'} type
 * @param {string} release
 * @returns {{validate: (data: unknown) => boolean, entry: import('./registry.js').SchemaEntry}}
 */
export function validator(type, release) {
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
 * The non-empty requirements of `docs/SCHEMA-VERSIONS.md` ("Required values are
 * non-empty"), reported as warnings: such a record is schema-valid but does not
 * describe the data.
 *
 * @param {Record<string, unknown>} record
 * @param {'FHR'|'FHP'|'FHGFF3'} type
 * @returns {string[]}
 */
export function emptyValueWarnings(record, type) {
  const warnings = [];
  for (const field of type === 'FHR' ? ['genome', 'version'] : type === 'FHP' ? ['proteome', 'version'] : ['annotation', 'version']) {
    const value = record[field];
    if (typeof value === 'string' && value.trim() === '') {
      warnings.push(`${field}: required value is empty, so the record does not describe the data (docs/SCHEMA-VERSIONS.md)`);
    }
  }
  const taxon = record.taxon;
  if (taxon !== null && typeof taxon === 'object' && !Array.isArray(taxon)) {
    const t = /** @type {Record<string, unknown>} */ (taxon);
    const named = typeof t.name === 'string' && t.name.trim() !== '';
    const identified = typeof t.uri === 'string' && t.uri.trim() !== '';
    if (!named && !identified) {
      warnings.push('taxon: has neither a non-empty name nor a uri (docs/SCHEMA-VERSIONS.md)');
    }
  }
  for (const field of ['metadataAuthor', 'assemblyAuthor']) {
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
 * R14: collect `format: uri` declarations from a released contract and check the
 * record's values against the accepted link schemes.
 *
 * The paths are derived from the contract itself rather than a hand-written
 * field list, so a new URI field in a later minor is covered without a change
 * here.
 *
 * @param {Record<string, unknown>} record
 * @param {'FHR'|'FHP'|'FHGFF3'} type
 * @param {string} release
 * @returns {string[]} one warning per value with a scheme R14 does not accept
 */
export function linkSchemeWarnings(record, type, release) {
  const loaded = loadSchema(type, release);
  if (loaded === null) return [];
  const uriPaths = collectUriPaths(loaded.schema, loaded.schema);
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
 * @property {{type: 'FHR'|'FHP'|'FHGFF3', release: string, schemaVersion: string|number}} schema
 */

/**
 * Validate a parsed header record against the contract that governs it.
 *
 * @param {Record<string, unknown>} record
 * @param {import('./selection.js').Selection} selection
 * @returns {ValidationResult}
 */
export function validateRecord(record, selection) {
  const { validate, entry } = validator(selection.type, selection.release);
  const ok = validate(record);
  const errors = ok ? [] : (validate.errors ?? []).map((error) => formatError(error));
  const warnings = [...emptyValueWarnings(record, selection.type), ...linkSchemeWarnings(record, selection.type, selection.release)];
  if (selection.warning !== undefined) warnings.push(selection.warning);
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    schema: { type: selection.type, release: selection.release, schemaVersion: entry.schemaVersion },
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
