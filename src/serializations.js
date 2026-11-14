/**
 * Which serializations this build reads, and which it declares it does not.
 *
 * One declaration, four readers: `npm run conformance`, `npm test`, the native
 * acceptance guard and the capability matrix all take their answer from here, so
 * a format cannot be "implemented" in one place and "not run" in another. That
 * matters more than it sounds: the failure mode this family has hit repeatedly is
 * a table that quietly drops a format instead of reporting it.
 *
 * A `not-run` entry is a hole with a reason attached. It is never scored as a
 * pass, never counted in a pass total, and never removed from a report.
 *
 * @module serializations
 */

import { SUPPORT } from './types.js';

/**
 * @typedef {object} SerializationReader
 * @property {'native'|'not-run'} state whether this build scores vectors of the format
 * @property {'fasta'|'gfa'|'gff3'} [container] the container a native reader takes bytes for
 * @property {string|null} reason why a not-run format is not run, or null
 */

/**
 * The shared suite's format ids, as `conformance/manifest.json` states them.
 *
 * @type {Record<string, SerializationReader>}
 */
export const READERS = Object.freeze({
  fasta: Object.freeze({ state: 'native', container: 'fasta', reason: null }),
  gfa: Object.freeze({ state: 'native', container: 'gfa', reason: null }),
  'fhp-fasta': Object.freeze({ state: 'native', container: 'fasta', reason: null }),
  fhgff3: Object.freeze({ state: 'native', container: 'gff3', reason: null }),
  microdata: Object.freeze({
    state: 'not-run',
    container: undefined,
    reason:
      'the HTML microdata binding of docs/MICRODATA.md (rules M1-M5) is not implemented by this build: M2 needs HTML parsing with implied end tags and first-attribute-wins, and a microdata vector pins a whole extracted metadata object',
  }),
  jsonld: Object.freeze({
    state: 'not-run',
    container: undefined,
    reason:
      'the canonical JSON-LD form of docs/JSONLD.md (rules J1-J9) is not implemented by this build: J3, J4 and J5 are JSON-LD 1.1 processor rules (@nest, @import, remapped and remote contexts, reverse term mapping), and rather than score 34 of 37 and quietly drop three, the whole format is reported not run',
  }),
});

/** Formats this build scores. */
export const RUNNABLE_FORMATS = Object.freeze(Object.keys(READERS).filter((format) => READERS[format].state === 'native'));

/** Formats this build declares it does not score, with their reasons. */
export const NOT_RUN_FORMATS = Object.freeze(Object.keys(READERS).filter((format) => READERS[format].state === 'not-run'));

/**
 * The container a vector's format is read in.
 *
 * @param {string} format
 * @returns {'fasta'|'gfa'|'gff3'|null}
 */
export function containerFor(format) {
  return READERS[format]?.container ?? null;
}

/**
 * Whether a vector can be scored here.
 *
 * @param {{format: string}} vector
 * @returns {boolean}
 */
export function isRunnable(vector) {
  return containerFor(vector.format) !== null;
}

/**
 * The reason a vector is not scored.
 *
 * @param {{format: string}} vector
 * @returns {string|null}
 */
export function notRunReason(vector) {
  return READERS[vector.format]?.state === 'not-run' ? READERS[vector.format].reason : null;
}

/**
 * The support value the capability matrix uses for a not-run format, kept
 * consistent with `src/types.js` so a format cannot be `not-supported-yet` in one
 * table and merely unmentioned in the other.
 */
export const NOT_RUN_SUPPORT = SUPPORT.notSupportedYet;
