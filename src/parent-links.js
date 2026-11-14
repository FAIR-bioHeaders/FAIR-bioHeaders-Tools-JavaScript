/**
 * Parent-link verification (FHT draft rule C3) - lane-only, never implied.
 *
 * A `derivedFrom` entry names its parent file by that file's FHR-family checksum.
 * C3 says what a reader does with the name when it has the parent's bytes:
 * recompute them under R1-R5 and compare as exact strings.
 *
 * - **checked-pass** - a parent was supplied and recomputes to the stated value;
 * - **checked-fail** - a parent was supplied and recomputes to something else.
 *   That is an invalid link and must be reported, not skipped;
 * - **unchecked** - no parent was supplied. The record stays valid, and nothing
 *   here may call such a link verified.
 *
 * The verdict is per entry: one record can carry a checked-pass link and a
 * checked-fail link at once, and the failure drives the rejection.
 *
 * This module reads no file and resolves no path. The caller hands over the bytes
 * it chose to trust, so a link cannot be "verified" against a file the caller
 * never agreed to open; a runner that works from a manifest is responsible for
 * keeping the paths it resolves inside the directory it was pointed at.
 *
 * C3 is an FHT draft rule. It runs only where the caller opened the rule-V7 lane,
 * and no released contract asks for it: a released record's parent checksum is
 * metadata the file states, and this library reports it without recomputing it.
 *
 * @module parent-links
 */

import { computeChecksum } from './checksum.js';
import { HeaderError } from './errors.js';
import { draftEntry, draftWarning } from './drafts.js';

/** The three verdicts C3 recognises. */
export const VERDICTS = Object.freeze({
  checkedPass: 'checked-pass',
  checkedFail: 'checked-fail',
  unchecked: 'unchecked',
});

/**
 * @typedef {object} ParentLink
 * @property {number} index position in the record's `derivedFrom` list
 * @property {string|null} headerType the parent's FAIR-bioHeaders type, as stated
 * @property {string|null} relationship the stated relationship, as written
 * @property {string|null} statedChecksum the parent checksum the record states
 * @property {string|null} computedChecksum what the supplied bytes recompute to
 * @property {'checked-pass'|'checked-fail'|'unchecked'} verdict
 * @property {string} [detail] why a link is unchecked or failed
 */

/**
 * Container a parent file's bytes must be read in.
 *
 * The checksum rule is per container, not per type: an FHR or FHT parent is a
 * FASTA `;~` file, an FHGFF3 parent is a GFF3 `#~` file.
 *
 * @param {unknown} headerType the link's `headerType`
 * @returns {'fasta'|'gfa'|'gff3'}
 */
function containerOfParent(headerType) {
  if (headerType === 'FHGFF3') return 'gff3';
  if (headerType === 'FHR' || headerType === 'FHP' || headerType === 'FHT') return 'fasta';
  throw new HeaderError(
    `a derivedFrom entry names headerType ${JSON.stringify(headerType)}, whose container cannot be told (rule C3)`,
    { rule: 'C3', field: 'derivedFrom.headerType' },
  );
}

/**
 * @typedef {object} ParentLinkResult
 * @property {boolean} valid false when any link is checked-fail
 * @property {ParentLink[]} links one entry per `derivedFrom` item, in order
 * @property {string[]} errors one line per checked-fail link
 * @property {string[]} warnings the draft warning for the lane this ran under,
 *   and one line per unchecked link: a link nobody supplied is not a verified link
 */

/**
 * Verify a record's parent links against bytes the caller supplied.
 *
 * @param {Record<string, unknown>} record the parsed header record
 * @param {object} [options]
 * @param {(link: Record<string, unknown>, index: number) => {bytes: Uint8Array, container?: 'fasta'|'gfa'|'gff3'}|null} [options.resolveParent]
 *   the caller's supply of parent bytes; return null when this link has no parent
 *   file, which is the `unchecked` case and not a failure
 * @param {string} [options.type] type id to name in the warning, for a caller that
 *   wants the draft line even with nothing supplied
 * @returns {ParentLinkResult}
 */
export function verifyParentLinks(record, options = {}) {
  const resolve = options.resolveParent ?? (() => null);
  const links = Array.isArray(record.derivedFrom) ? record.derivedFrom : [];
  /** @type {ParentLink[]} */
  const verdicts = [];
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  if (options.type !== undefined) warnings.push(parentLinkWarning(options.type));

  links.forEach((raw, index) => {
    const link = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? /** @type {Record<string, unknown>} */ (raw) : {};
    const stated = typeof link.checksum === 'string' ? link.checksum : null;
    /** @type {ParentLink} */
    const entry = {
      index,
      headerType: typeof link.headerType === 'string' ? link.headerType : null,
      relationship: typeof link.relationship === 'string' ? link.relationship : null,
      statedChecksum: stated,
      computedChecksum: null,
      verdict: VERDICTS.unchecked,
    };
    if (stated === null) {
      // The contract requires a checksum, so the schema reports it. A link with
      // nothing to compare has no verdict here rather than a false one.
      entry.detail = 'the link states no parent checksum, so there is nothing to recompute';
      verdicts.push(entry);
      warnings.push(`derivedFrom[${index}]: no parent checksum stated, so the link is unchecked (rule C3)`);
      return;
    }
    let supplied = null;
    try {
      supplied = resolve(link, index);
    } catch (error) {
      if (!(error instanceof HeaderError)) throw error;
      entry.verdict = VERDICTS.checkedFail;
      entry.detail = `the parent file could not be read: ${error.message}`;
      errors.push(`derivedFrom[${index}]: checked-fail - ${entry.detail} (rule C3)`);
      verdicts.push(entry);
      return;
    }
    if (supplied === null || supplied === undefined || supplied.bytes === undefined) {
      entry.detail = 'no parent file was supplied, so the link is neither verified nor a rejection';
      verdicts.push(entry);
      warnings.push(`derivedFrom[${index}]: unchecked - the parent file was not supplied (rule C3)`);
      return;
    }
    const container = supplied.container ?? containerOfParent(entry.headerType);
    const computed = computeChecksum(supplied.bytes, container).computed;
    entry.computedChecksum = computed;
    if (computed === stated) {
      entry.verdict = VERDICTS.checkedPass;
    } else {
      entry.verdict = VERDICTS.checkedFail;
      entry.detail = `the supplied parent recomputes to ${computed}`;
      errors.push(`derivedFrom[${index}]: checked-fail - the link states parent checksum ${stated}, the supplied ${entry.headerType ?? 'parent'} file recomputes to ${computed} (rule C3)`);
    }
    verdicts.push(entry);
  });

  return { valid: errors.length === 0, links: verdicts, errors, warnings };
}

/**
 * The V7 warning for the type a link check ran under, so a caller that asked for
 * a parent check hears the draft statement even on a record whose parents were
 * all left at home.
 *
 * @param {string} type
 * @returns {string}
 */
export function parentLinkWarning(type) {
  const entry = draftEntry(type);
  if (entry === undefined) {
    throw new HeaderError(`${type} has no pinned draft contract, so no parent link can be verified for it (rule V7)`, { rule: 'V7', field: type });
  }
  return draftWarning(entry);
}
