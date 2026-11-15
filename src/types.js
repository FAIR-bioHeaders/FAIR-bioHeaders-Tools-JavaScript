/**
 * The five FAIR-bioHeaders types, and what this build can do with each.
 *
 * This is the single declaration of type scope. The reader, the selection rules
 * and the matrix all read their answer from here, so adding a type is a change to
 * these tables plus its contract provenance row - not a search through
 * `reader.js`, `selection.js` and the documentation for hardcoded type names.
 * That is what makes FHT and FHGM additive: when `v0.7.0` publishes FHT, the move
 * is `status: 'draft'` to `status: 'released'` here plus a row in
 * `schemas/provenance.json`, and every cell that says `native-draft` becomes
 * `native` by the derivation below rather than by a rewrite.
 *
 * The two statuses are not interchangeable:
 *
 * - `released` - the type has a contract published by FAIR-bioHeaders-Specification,
 *   a row in `schemas/versions.json`, a `schemaVersion` and w3id URLs. FHR, FHP and
 *   FHGFF3 are released; their copies are vendored in `schemas/` and are selected by
 *   rules V1 to V6.
 * - `draft` - no released contract, no registry row, no w3id URL and no support
 *   claim. FHT and FHGM are drafts, read only through the explicit rule-V7 lane in
 *   `src/drafts.js` against bytes pinned by commit and SHA-256. A lane reading is
 *   recognition of a proposal, never support for a type.
 *
 * FHGM has a different shape again: it is not a file header. Its records carry no
 * `schema`, no `schemaVersion` and no `checksum`; they ride inside an FHGFF3 header
 * under the `x-fhgm-models` extension key (docs/FORMAT.md R15), the file keeps its
 * released FHGFF3 citation and is routed by V1 to V3, and the FHGM lane selects only
 * the contract and the checks applied to the records (docs/SCHEMA-VERSIONS.md V7,
 * docs/FHGM.md "The FHGFF3 file header versus FHGM model records").
 *
 * @module types
 */

import { provenance as releasedProvenance } from './registry.js';
import { citationIndex, DRAFT_TYPES, draftEntry } from './drafts.js';

/** Published status of a type. */
export const STATUS = Object.freeze({ released: 'released', draft: 'draft' });

/**
 * Support value of one capability cell.
 *
 * - `native` - implemented here and checked by the native test suite;
 * - `native-draft` - implemented here, but only behind the explicit V7 lane, and
 *   its result is labelled draft and never a released-contract result;
 * - `not-supported-yet` - deliberately absent, with the reason in the cell;
 * - `not-applicable` - the cell is not a gap: the dimension does not apply to that
 *   type or serialization, and the reason says who owns it instead.
 */
export const SUPPORT = Object.freeze({
  native: 'native',
  nativeDraft: 'native-draft',
  notSupportedYet: 'not-supported-yet',
  notApplicable: 'not-applicable',
});

/** Operations the matrix reports, in reading order. */
export const OPERATIONS = Object.freeze(['read', 'selectContract', 'validateContract', 'verifyChecksum', 'verifyParentLinks', 'strip', 'write']);

/** Serializations (containers and transports) the matrix reports on. */
export const SERIALIZATIONS = Object.freeze(['fasta', 'gfa', 'gff3', 'model-records', 'jsonld', 'microdata']);

/** The sequence-file containers this reader takes bytes for. */
export const CONTAINERS = Object.freeze(['fasta', 'gfa', 'gff3']);

/** Why each absent cell is absent. Stated once so every cell uses the same words. */
const REASONS = Object.freeze({
  jsonld:
    'the canonical JSON-LD reader of docs/JSONLD.md (J1-J9) is not implemented: J3-J5 need a JSON-LD 1.1 processor, and this build reports the format not-run rather than scoring part of it',
  microdata:
    'the HTML microdata reader of docs/MICRODATA.md (M1-M5) is not implemented: M2 needs HTML parsing with implied end tags, and this build reports the format not-run rather than scoring part of it',
  write: 'there is no writer in this library at all: no combine, no checksum emission. Headers are created or edited with a tool that writes one',
  parentLinksReleased:
    'a released contract states a parent checksum but publishes no rule that makes a recomputed mismatch a rejection, so nothing here recomputes a parent by default',
  parentLinksDraft:
    'FHT draft rule C3: a supplied parent file is recomputed and compared as an exact string, and a missing parent leaves the link unchecked and never verified',
  containerMismatch: (type, serialization) => `${type} has no ${serialization} serialization: it is not defined for that container`,
  draftOnly: (type) => `${type} is a draft: this works only where the caller opened the rule-V7 lane for it, and the reading is labelled draft, not a released-contract result`,
  modelRecords: 'an FHGM record carries no schema, schemaVersion or checksum of its own: the file is routed by its FHGFF3 citation under V1 to V3, so there is no contract selection to make at the record',
  fileChecksumCoversRecords: 'the enclosing FHGFF3 file checksum covers every embedded record byte (docs/FORMAT.md R3); the record itself carries no checksum to verify',
  featureLayer:
    'resolving a record featureId to a GFF3 feature row needs the feature layer, which this library does not read: GFF3 syntax, SO terms and biology belong to gff3-validator, and FHGM model resolution belongs to its own tooling',
  notAHeaderType: 'FHGM is not a header type: it has no file header to read, select or strip of its own',
  noModelRecordsHere: (type) => `${type} carries no nested model-record array: x-fhgm-models belongs to FHGFF3 headers`,
});

/**
 * @typedef {object} TypeDescription
 * @property {string} id `FHR`, `FHP`, `FHGFF3`, `FHT` or `FHGM`
 * @property {'released'|'draft'} status published status of the type
 * @property {'header'|'nested-records'} shape whether the type owns a file header
 * @property {string[]} serializations serializations the type is defined in
 * @property {string} [routedBy] for a nested type, the header type that routes it
 * @property {string} [extensionKey] for a nested type, the R15 key that carries it
 * @property {string} owningRepository development repository that owns the type
 * @property {string|null} citation V7 raw-main citation; null for a released type
 * @property {Array<{release: string, schemaVersion: string|number, file: string}>} contracts
 *   contract copies this build bundles; empty for a draft, which has no release form
 * @property {string|null} pathSlug the lowercase path segment a w3id URL uses; null for a draft
 */

/**
 * The released types, in citation order. `pathSlug` is the lowercase segment the
 * published URLs use (`fhr.json`, `https://w3id.org/fair-bioheaders/fhr/v0.6.0`),
 * read off the registry's own `files`/`w3id` shape rather than restated.
 */
const RELEASED = Object.freeze([
  { id: 'FHR', owningRepository: 'FAIR-bioHeaders-Specification', pathSlug: 'fhr', serializations: ['fasta', 'gfa', 'jsonld', 'microdata'] },
  { id: 'FHP', owningRepository: 'FAIR-bioHeaders-Specification', pathSlug: 'fhp', serializations: ['fasta'] },
  { id: 'FHGFF3', owningRepository: 'FAIR-bioHeaders-Specification', pathSlug: 'fhgff3', serializations: ['gff3'] },
]);

/** The shape of a draft declaration, keyed here so the order is stable. */
const DRAFT_SHAPES = Object.freeze({
  FHT: { shape: 'header', serializations: ['fasta'], routedBy: null, extensionKey: null },
  FHGM: { shape: 'nested-records', serializations: ['model-records'], routedBy: 'FHGFF3', extensionKey: 'x-fhgm-models' },
});

/**
 * @param {Omit<TypeDescription, 'contracts'>} base
 * @returns {TypeDescription}
 */
function describe(base) {
  /** @type {Array<{release: string, schemaVersion: string|number, file: string}>} */
  const contracts = [];
  if (base.status === STATUS.released) {
    for (const [release, row] of Object.entries(releasedProvenance.releases)) {
      const file = /** @type {Record<string, {file: string, schemaVersion: string | number}>} */ (row)[base.id];
      if (file !== undefined) contracts.push({ release, schemaVersion: file.schemaVersion, file: file.file });
    }
  }
  return Object.freeze({ ...base, contracts: Object.freeze(contracts) });
}

/**
 * Every type this build knows about, released and draft alike.
 *
 * @type {Record<string, TypeDescription>}
 */
export const TYPES = Object.freeze(
  (() => {
    /** @type {Record<string, TypeDescription>} */
    const table = {};
    for (const released of RELEASED) {
      table[released.id] = describe({
        ...released,
        status: STATUS.released,
        shape: 'header',
        citation: null,
      });
    }
    for (const id of DRAFT_TYPES) {
      const entry = draftEntry(id);
      const shape = DRAFT_SHAPES[id] ?? { shape: 'header', serializations: [], routedBy: null, extensionKey: null };
      table[id] = describe({
        id,
        status: STATUS.draft,
        ...shape,
        owningRepository: entry.repository,
        citation: entry.citation,
        pathSlug: null,
      });
    }
    return table;
  })(),
);

/** Type ids in declaration order: released first, then drafts. */
export const TYPE_IDS = Object.freeze(Object.keys(TYPES));

/** The released types, as a list of ids. Nothing here may include a draft. */
export const RELEASED_TYPES = Object.freeze(TYPE_IDS.filter((id) => TYPES[id].status === STATUS.released));

/** The draft types this build has pinned bytes for. Recognition, not support. */
export const DRAFT_TYPE_IDS = Object.freeze(TYPE_IDS.filter((id) => TYPES[id].status === STATUS.draft));

/**
 * The header types a container can hold, given which lanes the caller opened.
 *
 * With no lane this is exactly the set this library accepted before the draft lane
 * existed, which is what keeps the default reading unchanged.
 *
 * @param {string[]} [enabledDrafts] draft type ids whose V7 lane the caller chose
 * @returns {Record<string, string[]>} container to header type ids
 */
export function headerTypesByContainer(enabledDrafts = []) {
  const enabled = new Set(enabledDrafts);
  /** @type {Record<string, string[]>} */
  const table = {};
  for (const id of TYPE_IDS) {
    const type = TYPES[id];
    if (type.shape !== 'header') continue;
    if (type.status === STATUS.draft && !enabled.has(id)) continue;
    for (const serialization of type.serializations) {
      if (!CONTAINERS.includes(serialization)) continue;
      (table[serialization] ??= []).push(id);
    }
  }
  for (const key of Object.keys(table)) table[key] = Object.freeze(table[key]);
  for (const container of CONTAINERS) table[container] ??= Object.freeze([]);
  return table;
}

/**
 * The capability of one operation on one type in one serialization.
 *
 * @param {string} typeId
 * @param {typeof OPERATIONS[number]} operation
 * @param {typeof SERIALIZATIONS[number]} serialization
 * @returns {{support: string, reason: string|null}}
 */
export function capability(typeId, operation, serialization) {
  const type = TYPES[typeId];
  if (type === undefined) throw new Error(`unknown type ${typeId}`);
  if (!OPERATIONS.includes(operation)) throw new Error(`unknown operation ${operation}`);
  if (!SERIALIZATIONS.includes(serialization)) throw new Error(`unknown serialization ${serialization}`);

  const draft = type.status === STATUS.draft;
  const inContainer = CONTAINERS.includes(serialization);
  const defined = type.serializations.includes(serialization);

  // Cells that are not gaps at all.
  if (operation === 'write') return cell(SUPPORT.notSupportedYet, REASONS.write);
  if (serialization === 'jsonld' || serialization === 'microdata') {
    if (!defined) return cell(SUPPORT.notApplicable, REASONS.containerMismatch(typeId, serialization));
    return cell(SUPPORT.notSupportedYet, REASONS[serialization]);
  }
  if (serialization === 'model-records') {
    if (!defined) return cell(SUPPORT.notApplicable, REASONS.noModelRecordsHere(typeId));
  }
  if (type.shape === 'nested-records' && (inContainer || serialization !== 'model-records')) {
    return cell(SUPPORT.notApplicable, `${REASONS.notAHeaderType}; ${type.routedBy} carries the records, and ${type.routedBy}'s own capabilities are reported under ${type.routedBy}`);
  }
  if (inContainer && !defined) return cell(SUPPORT.notApplicable, REASONS.containerMismatch(typeId, serialization));

  switch (operation) {
    case 'read':
      return draft
        ? cell(SUPPORT.nativeDraft, REASONS.draftOnly(typeId))
        : cell(SUPPORT.native, null);
    case 'selectContract':
      if (type.shape === 'nested-records') return cell(SUPPORT.notApplicable, REASONS.modelRecords);
      if (serialization === 'model-records') return cell(SUPPORT.notApplicable, REASONS.modelRecords);
      return draft
        ? cell(SUPPORT.nativeDraft, `${REASONS.draftOnly(typeId)}; the lane recognises its pinned raw-main citation alone - a w3id or raw-tag URL for ${typeId} stays "any other value" under V5`)
        : cell(SUPPORT.native, 'V1 to V6 over the vendored copies; an unavailable release is reported unsupported-version and never checked against another schema (V4)');
    case 'validateContract':
      if (serialization === 'model-records') {
        return draft
          ? cell(SUPPORT.nativeDraft, `${REASONS.draftOnly(typeId)}; K1 transport, K2 record contract, K3 modelId uniqueness, K4 feature-target resolution against the enclosing file's own row IDs or an injected resolver, K5 reference agreement and K6 predecessor verdicts are implemented here; K4 without a feature layer reports not-checked or unchecked, never a pass`)
          : cell(SUPPORT.notSupportedYet, 'no FHGM check runs unless the V7 lane names FHGM');
      }
      return draft
        ? cell(SUPPORT.nativeDraft, `${REASONS.draftOnly(typeId)}; against the pinned draft bytes, with the V7 warning on the reading`)
        : cell(SUPPORT.native, 'draft/2020-12 with date and uri asserted, plus the non-empty and R14 warnings');
    case 'verifyChecksum':
      if (serialization === 'model-records') {
        return cell(SUPPORT.notApplicable, `${REASONS.fileChecksumCoversRecords}; the recomputation is the ${type.routedBy} reading's, reported under ${type.routedBy}/verifyChecksum/gff3`);
      }
      if (draft) return cell(SUPPORT.nativeDraft, `${REASONS.draftOnly(typeId)}; the R1-R5 recomputation is the same code path as a released reading, only the contract behind it differs`);
      return cell(SUPPORT.native, 'R1-R5: SHA-512/256 over the exact bytes except the root checksum line and its terminator, canonical padded base64, compared as a string');
    case 'verifyParentLinks':
      if (serialization === 'model-records') return cell(SUPPORT.notApplicable, REASONS.modelRecords);
      if (draft && typeId === 'FHT') return cell(SUPPORT.nativeDraft, REASONS.parentLinksDraft);
      if (draft) return cell(SUPPORT.notApplicable, `${typeId} records carry no derivedFrom link of their own`);
      return cell(SUPPORT.notSupportedYet, REASONS.parentLinksReleased);
    case 'strip':
      if (serialization === 'model-records') {
        return cell(SUPPORT.native, 'strip removes the enclosing FHGFF3 header block, which takes the records with it: it is a byte operation on the header lines and names no contract');
      }
      return cell(SUPPORT.native, 'byte operation on the leading header block; it needs no contract, so it behaves the same with the lane open or closed');
    default:
      throw new Error(`unknown operation ${operation}`);
  }

  /**
   * @param {string} support
   * @param {string|null} reason
   */
  function cell(support, reason) {
    return { support, reason };
  }
}

/**
 * Every cell of the matrix, flat and in declaration order.
 *
 * @returns {Array<{type: string, status: string, shape: string, operation: string, serialization: string, support: string, reason: string|null}>}
 */
export function capabilityRows() {
  const rows = [];
  for (const typeId of TYPE_IDS) {
    const type = TYPES[typeId];
    for (const operation of OPERATIONS) {
      for (const serialization of SERIALIZATIONS) {
        const { support, reason } = capability(typeId, operation, serialization);
        rows.push({
          type: typeId,
          status: type.status,
          shape: type.shape,
          operation,
          serialization,
          support,
          reason,
        });
      }
    }
  }
  return rows;
}

/**
 * The draft citations this build recognises, for the selection rule.
 *
 * @returns {Map<string, string>} citation URL to draft type id
 */
export function draftCitations() {
  return citationIndex();
}

/**
 * A one-line, non-promotional statement of what this build can do with a type.
 *
 * @param {string} typeId
 * @returns {string}
 */
export function describeType(typeId) {
  const type = TYPES[typeId];
  if (type === undefined) throw new Error(`unknown type ${typeId}`);
  if (type.status === STATUS.released) {
    const versions = type.contracts.map((row) => `${row.release} = ${row.schemaVersion}`).join(', ');
    return `${typeId}: released, ${type.contracts.length} contract copies (${versions}); a record is checked against the copy its own citation selects`;
  }
  const entry = draftEntry(typeId);
  return `${typeId}: draft, no released contract, no schemaVersion claim, no w3id URL and no registry row; readable only through the V7 lane against ${entry.repository} ${entry.commit.slice(0, 12)} (sha256 ${entry.sha256.slice(0, 12)}...)`;
}
