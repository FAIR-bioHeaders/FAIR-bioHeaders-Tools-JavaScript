/**
 * FAIR-bioHeaders in JavaScript: read, check and strip FHR, FHP and FHGFF3
 * headers, natively in Node.js.
 *
 * The public surface is deliberately small. {@link inspectBytes} and
 * {@link inspectFile} read a file, recompute its checksum and validate the
 * record against the contract it cites; {@link stripBytes} and
 * {@link stripFile} take a header out again without touching other bytes. The
 * rule-level helpers are exported too, so a caller can reuse one check instead
 * of reimplementing it.
 *
 * Supported contracts: the released FHR, FHP and FHGFF3 schemas, selected per
 * record by rules V1 to V6 from the copies vendored in `schemas/`. FHT and FHGM
 * have no released contract and are not supported: this library publishes no
 * `schemaVersion`, no w3id URL and no registry row for either, and does not
 * implement the opt-in draft lane of rule V7.
 *
 * This library is not the browser tooling on the FAIR bioHeaders website and not
 * `gff3-validator`'s Pyodide build; nothing here runs CPython. It validates
 * headers, not GFF3 features: feature and biology checks belong to
 * `gff3-validator`.
 *
 * @module
 */

export { HeaderError } from './errors.js';
export { LIMITS, PREFIXES, assertNoByteOrderMark, headerLines, isGff3VersionLine, splitLines } from './lines.js';
export { computeChecksum, digest, findChecksumLine, headerText, sha512_256Available } from './checksum.js';
export { loadHeaderYaml } from './yaml.js';
export { plainScalarIsPortable, plainScalarOverflows, resolveCore, resolveYaml11 } from './scalars.js';
export { isFhr1VersionNumber, selectSchema } from './selection.js';
export {
  CURRENT_RELEASE,
  DIALECT,
  FHR1_RELEASE,
  SOURCE,
  describeSupport,
  entry as schemaEntry,
  has as hasSchema,
  loadSchema,
  releasesFor,
} from './registry.js';
export { emptyValueWarnings, hasAcceptedLinkScheme, linkSchemeWarnings, validateRecord, validator } from './validate.js';
export { containerOf, decompress, inspectBytes, inspectFile, stripBytes, stripFile } from './reader.js';
