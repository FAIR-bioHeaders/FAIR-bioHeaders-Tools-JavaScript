/**
 * The bundled contract files and what they came from.
 *
 * `schemas/provenance.json` records, for every released contract this library
 * can select, the source repository, release tag, tag commit, source path and
 * the SHA-256 of the exact vendored bytes. The bytes are checked against that
 * digest the first time a file is loaded, so a modified or truncated copy is
 * reported instead of silently selecting a different contract.
 *
 * Nothing here fetches a schema at run time: rules V1 to V6 read the reader's
 * own copies and say which release its current copy is.
 *
 * @module registry
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HeaderError } from './errors.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Absolute path of the directory holding the vendored contract copies. */
export const SCHEMA_DIR = resolve(HERE, '..', 'schemas');

const provenance = JSON.parse(readFileSync(join(SCHEMA_DIR, 'provenance.json'), 'utf8'));

/**
 * @typedef {object} SchemaEntry
 * @property {'FHR'|'FHP'|'FHGFF3'} type
 * @property {string} release release tag, for example `v0.6.0`
 * @property {string} file vendored file name
 * @property {string} path absolute path of the vendored file
 * @property {string|number} schemaVersion the `schemaVersion` that release states
 * @property {string} sourcePath path of the file in the source repository
 * @property {string} sha256 digest recorded for the vendored bytes
 * @property {string} commit the tag's commit in the source repository
 */

/**
 * Release tags that published a contract of this type, oldest first.
 *
 * @param {'FHR'|'FHP'|'FHGFF3'} type
 * @returns {string[]}
 */
export function releasesFor(type) {
  return Object.keys(provenance.releases).filter((release) => provenance.releases[release][type] !== undefined);
}

/**
 * @param {'FHR'|'FHP'|'FHGFF3'} type
 * @param {string} release release tag, for example `v0.4.0`
 * @returns {boolean}
 */
export function has(type, release) {
  return provenance.releases[release] !== undefined && provenance.releases[release][type] !== undefined;
}

/**
 * @param {'FHR'|'FHP'|'FHGFF3'} type
 * @param {string} release
 * @returns {SchemaEntry|undefined}
 */
export function entry(type, release) {
  const row = provenance.releases[release];
  if (row === undefined || row[type] === undefined) return undefined;
  const file = row[type];
  return {
    type,
    release,
    file: file.file,
    path: join(SCHEMA_DIR, file.file),
    schemaVersion: file.schemaVersion,
    sourcePath: file.sourcePath,
    sha256: file.sha256,
    commit: row.commit,
  };
}

/** The release whose copies a raw-`main` URL selects (V1): what this build is current at. */
export const CURRENT_RELEASE = provenance.current;

/** The last release that published the FHR 1 contract, used by V6. */
export const FHR1_RELEASE = provenance.fhr1Release;

/** The JSON Schema dialect every released family contract declares. */
export const DIALECT = provenance.dialect;

/** The source repository of the vendored copies. */
export const SOURCE = provenance.source;

const verified = new Set();

/**
 * Confirm the vendored bytes still match the digest recorded for them.
 *
 * @param {SchemaEntry} target
 */
function assertDigest(target) {
  if (verified.has(target.path)) return;
  const bytes = readFileSync(target.path);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== target.sha256) {
    throw new HeaderError(
      `the bundled ${target.file} does not match its recorded provenance: sha256 ${digest}, expected ${target.sha256} (the copy of ${target.sourcePath} at ${target.release} from ${SOURCE.repository})`,
      { rule: 'provenance' },
    );
  }
  verified.add(target.path);
}

const cache = new Map();

/**
 * The parsed JSON Schema document of a released contract, or `null` when this
 * build has no such contract.
 *
 * @param {'FHR'|'FHP'|'FHGFF3'} type
 * @param {string} release
 * @returns {{schema: Record<string, unknown>, entry: SchemaEntry}|null}
 */
export function loadSchema(type, release) {
  const key = `${type}@${release}`;
  const target = entry(type, release);
  if (target === undefined) return null;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  assertDigest(target);
  const loaded = { schema: JSON.parse(readFileSync(target.path, 'utf8')), entry: target };
  cache.set(key, loaded);
  return loaded;
}

/**
 * What this build can select, in the words the V4 message asks for.
 *
 * @param {'FHR'|'FHP'|'FHGFF3'} type
 * @returns {string}
 */
export function describeSupport(type) {
  return `main (${CURRENT_RELEASE}), ${releasesFor(type).join(', ')}`;
}

export { provenance };
