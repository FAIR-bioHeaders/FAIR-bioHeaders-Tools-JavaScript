/**
 * Errors thrown by this library.
 *
 * Every rejection names the rule of FAIR-bioHeaders-Specification that it
 * enforces (`docs/FORMAT.md` R1-R15, `docs/FHP.md` P1-P2, `docs/FHGFF3.md` G1-G3,
 * `docs/SCHEMA-VERSIONS.md` V1-V6) so a caller can report the rule without
 * matching on message text. Rule ids are labels, not a classification system:
 * see the vector README in the shared specification.
 *
 * @module errors
 */

/**
 * A file, header or record that does not meet the specification.
 *
 * This is the only error type the library throws: `strip` refuses a malformed header
 * block with it too, because R2/R5 are what tell it which lines are the header.
 */
export class HeaderError extends Error {
  /**
   * @param {string} message Human-readable reason.
   * @param {object} [details]
   * @param {string} [details.rule] Rule id enforced, for example `R5` or `V4`.
   * @param {'invalid'|'unsupported-version'} [details.result] For `V4` the
   *   reader must report `unsupported-version` and must not check the record
   *   against another schema (docs/SCHEMA-VERSIONS.md V4).
   * @param {string} [details.field] Header field the finding refers to.
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'HeaderError';
    this.rule = details.rule ?? null;
    this.result = details.result ?? 'invalid';
    this.field = details.field ?? null;
  }
}
