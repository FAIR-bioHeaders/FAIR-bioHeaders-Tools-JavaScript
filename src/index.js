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
 * record by rules V1 to V6 from the copies vendored in `schemas/`.
 *
 * FHT and FHGM are drafts: no released contract, no `schemaVersion` of their own
 * in the shared registry, no w3id URL and no row in `schemas/versions.json`, and
 * no support claim for either. Rule V7 gives them one recognition path - the
 * explicit `{drafts: [...]}` lane in `src/drafts.js`, reading bytes pinned by
 * commit and SHA-256 and warning on every record - and nothing about that lane
 * makes either type supported. With no `drafts` option this library behaves
 * exactly as it did before V7 existed, which `test/default-gate.test.mjs` proves
 * against `test/goldens/default-gate.json`.
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

// The five-type registry: what this build knows, and what it can do with it.
export {
  CONTAINERS,
  DRAFT_TYPE_IDS,
  RELEASED_TYPES,
  SUPPORT,
  TYPES,
  TYPE_IDS,
  capability,
  capabilityRows,
  describeType,
  headerTypesByContainer,
} from './types.js';

// The rule-V7 draft lane. Nothing here is reachable without an explicit
// `{drafts: ...}` decision by the caller.
export {
  DRAFT_TYPES,
  citationIndex as draftCitations,
  draftEntry,
  draftProvenance,
  draftSuitePin,
  draftSupport,
  draftWarning,
  hasDraft,
  loadDraft,
} from './drafts.js';
export { VERDICTS as PARENT_LINK_VERDICTS, parentLinkWarning, verifyParentLinks } from './parent-links.js';
export { FHGM_NOT_SUPPORTED, FHGM_RULES, MODELS_KEY, VERDICTS as FHGM_VERDICTS, admitsExtensionFields, checkFhgmModels, fhgmRuleCoverage } from './fhgm.js';
