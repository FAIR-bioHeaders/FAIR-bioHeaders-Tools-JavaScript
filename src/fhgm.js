/**
 * FHGM model-level checks - draft lane only, and separate by construction.
 *
 * FHGM is not a header type. Its records ride inside an FHGFF3 header under the
 * `x-fhgm-models` extension key (docs/FORMAT.md R15), the file keeps its released
 * FHGFF3 citation and is routed by V1 to V3, and the file checksum covers every
 * record byte like any other header byte (R3). A record itself carries no
 * `schema`, no `schemaVersion` and no `checksum`, so rule V7 selects only the
 * contract and the checks applied to the records - never the type of the file.
 *
 * Two consequences shape this module:
 *
 * 1. a verdict here never changes the FHGFF3 result. The caller gets a separate
 *    block, so a draft outcome cannot be mistaken for, or blended into, a
 *    released-contract outcome; and
 * 2. B1 is a precondition, not an FHGM rule: the released base schema and the
 *    exact-byte checksum must already hold before any model verdict exists. When
 *    the caller says the base did not hold, this module reports `not-checked`
 *    rather than inventing a verdict on top of a file that is not a sound FHGFF3
 *    file at all.
 *
 * Implemented, from the draft rule text FHGM-Specification records in
 * `development/conformance/manifest.json`:
 *
 * - K1 transport: the header states a `schemaVersion` that admits extension
 *   fields - 1.1 or later, per R15 - and carries one or more records under the
 *   single top-level `x-fhgm-models` key. `overlay: true` additionally applies
 *   the pinned transport overlay. Since FHGM-Specification#17 (the maintainer
 *   dual-base decision of 2026-11-15) that overlay admits either released FHGFF3
 *   identity a carrier can cite - the v0.5.0 citation set with `schemaVersion`
 *   1.1, or the v0.6.0 citation set with 1.2 - as a closed pairing, so a
 *   citation and a stated version that contradict each other are refused by the
 *   overlay and neither branch falls back to the other. R15 alone reads only the
 *   stated version, so seeing the contradiction is the overlay's contribution,
 *   not the default reading's; the narrower single-pin overlay this repository
 *   vendored before that decision could not tell 1.1 and 1.2 apart either, and
 *   the divergence recorded here in favour of R15 is closed. The overlay stays
 *   opt-in: this library's default verdict is the published rule, and a pin in
 *   another repository's draft is evidence a caller can ask for, not a norm this
 *   build silently adopts. `docs/CAPABILITY.md` records both readings.
 * - K2 record shape: every record validates against the pinned record contract,
 *   whose required set is `modelId`, `modelVersion`, `featureId` and `reference`.
 * - K3 uniqueness: `modelId` is unique within one snapshot; a shared id makes the
 *   identity a pointer needs unselectable, is reported as ambiguous, and rejects
 *   that snapshot - the current one or a supplied predecessor.
 * - K5 reference agreement: a record reference shares at least one comparable
 *   form with the file's genome link and never contradicts it. Both halves are
 *   enforced, which the draft records as stricter than its own adoption summary.
 * - K6 predecessor verdicts: `resolvable`, `unresolvable` or `ambiguous`, against
 *   explicitly supplied prior snapshots only. Nothing is resolved from a file
 *   this library was not handed, and a resolvable pointer identifies a predecessor
 *   record; it asserts no curator acceptance.
 *
 * K4 feature-target resolution, and its boundary:
 *
 * - K4: a `featureId` must resolve, percent-decoded, to exactly one local gene
 *   row. Resolving it means reading the GFF3 feature layer below the header, so
 *   the API is an injected resolver: `options.features` is either row facts the
 *   caller took from elsewhere (`[{id, type}]`, the same two facts K4 needs that
 *   gff3-validator or any other feature tool computes) or the GFF3 content
 *   itself, which `src/features.js` indexes minimally - the `type` and `ID` of
 *   each feature row, nothing else. `inspectBytes` supplies the default: when
 *   the FHGM lane is open on a file, K4 resolves against that file's own bytes,
 *   which is what a reader of the file can honestly claim. This remains not a
 *   feature validator: SO terms, coordinates, parent/child structure and biology
 *   belong to gff3-validator, and no row fact read here judges them.
 * - when no feature layer exists for the reading (a bare `checkFhgmModels` call
 *   with no resolver) `rules.K4` is `not-checked`; when the layer is present but
 *   untrustworthy (a row without nine fields, compressed content handed to the
 *   direct call) `rules.K4` is `unchecked`, with the reason on every record.
 *   Neither is ever scored as a pass, and neither rejects the file: K4 can only
 *   reject a `featureId` against rows it actually read.
 * - `options.geneIds` stays as the shorthand it was - an array of decoded gene
 *   row ids - and now counts repeated entries, because "exactly one" is what the
 *   rule says; a caller that can distinguish row types should inject `features`
 *   instead, which can tell "no such row" from "two rows" from "one transcript
 *   row".
 *
 * @module fhgm
 */

import { HeaderError } from './errors.js';
import { draftEntry, draftWarning, loadDraft } from './drafts.js';
import { indexGff3FeatureRows, isGeneRowType } from './features.js';
import { draftValidator, emptyValueWarnings, hasAcceptedLinkScheme } from './validate.js';

/** The R15 extension key the draft pilot transports records under. */
export const MODELS_KEY = 'x-fhgm-models';

/** Rule ids this module knows, and runs, including the one that needs a resolver. */
export const FHGM_RULES = Object.freeze(['B1', 'K1', 'K2', 'K3', 'K4', 'K5', 'K6']);

/**
 * K4's boundary, in the words the capability matrix carries: what it reads, what
 * it does when the feature layer is not there, and what still belongs to
 * gff3-validator even now that a `featureId` resolves here.
 */
export const FHGM_K4_BOUNDARY = Object.freeze({
  resolves: 'a record featureId, percent-decoded, against the ID and type of the enclosing file\'s GFF3 feature rows - two facts per row, read by src/features.js or injected by the caller as options.features; exactly one gene row passes',
  withoutFeatureLayer: 'not-checked: no resolver supplied, so K4 ran against nothing and claims nothing',
  unusableFeatureLayer: 'unchecked: the layer was supplied but cannot be trusted (a row without nine fields, compressed content at the direct call), so K4 neither passes nor rejects',
  stillElsewhere: 'SO-term correctness, coordinates, parent/child structure and every other feature and biology rule belong to gff3-validator; reading two columns of a row does not validate it',
});

/** The three predecessor verdicts K6 recognises. */
export const VERDICTS = Object.freeze({
  resolvable: 'resolvable',
  unresolvable: 'unresolvable',
  ambiguous: 'ambiguous',
});

/**
 * @typedef {object} FhgmRecordResult
 * @property {number} index position in the `x-fhgm-models` array
 * @property {string|null} modelId
 * @property {string|null} modelVersion
 * @property {string|null} featureId
 * @property {boolean} valid K2 result for this record
 * @property {string[]} errors
 * @property {string[]} warnings non-empty and R14 warnings for this record
 * @property {{verdict: string, detail: string}|null} predecessor K6 verdict, null with no claim
 * @property {{verdict: string, detail: string}|null} featureTarget K4 verdict: `pass`/`reject` against a read feature layer, `unchecked` against an untrustworthy one, null when no layer was supplied
 */

/**
 * @typedef {object} FhgmResult
 * @property {'checked'|'not-checked'|'absent'} status `absent` when the header
 *   carries no records at all, `not-checked` when B1 did not hold
 * @property {boolean} valid true only when status is `checked` and every rule that ran held
 * @property {string[]} errors
 * @property {string[]} warnings carries the V7 draft warning whenever a verdict was reached
 * @property {FhgmRecordResult[]} records
 * @property {{type: 'FHGM', status: 'draft', repository: string, citation: string, commit: string, sha256: string, file: string}} contract
 * @property {Record<string, string>} rules what each rule contributed to this reading
 */

/**
 * @typedef {object} FhgmOptions
 * @property {{valid: boolean}} [base] the caller's released FHGFF3 verdict, schema
 *   and checksum together. B1: without a base that holds there is no FHGM verdict.
 * @property {boolean} [overlay] also apply the pinned transport overlay, the way
 *   the upstream draft checker does
 * @property {Array<{checksum?: string, header: Record<string, unknown>}>} [predecessors]
 *   prior snapshots K6 may resolve against; each is itself run through K1-K3 and K5
 * @property {string|Uint8Array|Array<{id: string, type: string}>|null} [features]
 *   the K4 resolver: GFF3 text or decompressed bytes to index with `src/features.js`,
 *   or row facts `[{id, type}]` taken from elsewhere (decoded or percent-escaped ids
 *   both work - ids are decoded before comparison). `null` says "no feature layer,
 *   do not look for one"; absent at the direct call means `not-checked`, and
 *   `inspectBytes` defaults it to the file's own bytes when the lane names FHGM
 * @property {string[]} [geneIds] the decoded `ID` of every local gene row, as an
 *   array in which a repeated id is two rows; superseded by `features` when both
 *   are given. With neither, K4 reports `not-checked` at the direct call
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The comparable reference forms of a genome link.
 *
 * Two forms exist: an FHR-family parent checksum, and an assembly accession with
 * the supplied SeqCol digest. A form the link does not state is absent, never a
 * wildcard.
 *
 * @param {unknown} holder a header record, or a model record's `reference`
 * @param {'header'|'record'} kind
 * @returns {Record<string, unknown>}
 */
function referenceForms(holder, kind) {
  /** @type {Record<string, unknown>} */
  const forms = {};
  if (!isObject(holder)) return forms;
  const reference = isObject(holder.genomeReference) ? holder.genomeReference : null;
  if (reference !== null) {
    if ('accession' in reference) forms.accession = reference.accession;
    if ('seqcol_id' in reference) forms.seqcol_id = reference.seqcol_id;
  }
  if (kind === 'header') {
    for (const raw of Array.isArray(holder.derivedFrom) ? holder.derivedFrom : []) {
      const parent = isObject(raw) ? raw : {};
      if (parent.headerType === 'FHR' && parent.relationship === 'annotates') forms.fhrChecksum = parent.checksum;
    }
    return forms;
  }
  if ('annotates' in holder) forms.fhrChecksum = holder.annotates;
  return forms;
}

/**
 * @param {Record<string, unknown>} left
 * @param {Record<string, unknown>} right
 * @returns {string[]}
 */
function sharedForms(left, right) {
  return Object.keys(left).filter((key) => key in right);
}

/**
 * @param {Record<string, unknown>} left
 * @param {Record<string, unknown>} right
 * @returns {boolean} true when they disagree on a form both state
 */
function conflicts(left, right) {
  return sharedForms(left, right).some((key) => left[key] !== right[key]);
}

/**
 * @param {Record<string, unknown>} left
 * @param {Record<string, unknown>} right
 * @returns {boolean} true when they share at least one form and never disagree
 */
function comparable(left, right) {
  return sharedForms(left, right).length > 0 && !conflicts(left, right);
}

/**
 * `docs/FORMAT.md` R15 admits extension fields from FHGFF3 1.1. A `MAJOR.MINOR`
 * string is compared on both halves as numbers; anything unparseable admits none.
 *
 * @param {string} statedVersion
 * @returns {boolean}
 */
export function admitsExtensionFields(statedVersion) {
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(statedVersion);
  if (match === null) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 1 || (major === 1 && minor >= 1);
}

/**
 * Every string slot of a value, with its dotted path.
 *
 * @param {unknown} value
 * @param {string} prefix
 * @returns {Array<[string, unknown]>}
 */
function walkStrings(value, prefix) {
  if (typeof value === 'string') return [[prefix, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => walkStrings(item, `${prefix}[${index}]`));
  if (isObject(value)) return Object.entries(value).flatMap(([key, item]) => walkStrings(item, prefix === '' ? key : `${prefix}.${key}`));
  return [];
}

/**
 * R14 over a single record. The record contract has no root to walk for
 * declarations the way a file header has, so the URI-bearing slots are the ones
 * the draft names: `contributors[].uri`, `evidence.*.uri` and any `*Url`/`uri`
 * leaf. Values are reported, never dropped.
 *
 * @param {Record<string, unknown>} record
 * @returns {string[]}
 */
function recordLinkSchemeWarnings(record) {
  const warnings = [];
  for (const [path, value] of walkStrings(record, '')) {
    if (!/(^|\.)uri$|Url$/.test(path)) continue;
    if (typeof value !== 'string' || value === '' || hasAcceptedLinkScheme(value)) continue;
    warnings.push(`R14 warning: ${path} is "${value}", which has no link scheme docs/FORMAT.md R14 accepts (http, https, ftp, urn:, doi:, info:)`);
  }
  return warnings;
}

/**
 * Run the snapshot-level rules over one FHGFF3 header: K1, K2, K3 and K5.
 *
 * This is the unit both the current file and every supplied predecessor go
 * through, which is what makes a rejected predecessor a rejection of the reading
 * rather than a silent gap in the history.
 *
 * @param {Record<string, unknown>} header
 * @param {{overlay: boolean, label: string, layer: ReturnType<typeof resolveFeatureLayer>}} settings
 * @returns {{valid: boolean, errors: string[], warnings: string[], records: FhgmRecordResult[], byModelId: Map<string, Record<string, unknown>>, rules: Record<string, string>}}
 */
function checkSnapshot(header, settings) {
  const label = settings.label;
  const layer = settings.layer;
  /** @type {Record<string, string>} */
  const rules = { K1: 'pass', K2: 'pass', K3: 'pass', K4: layer.state === 'rows' ? 'pass' : layer.state === 'unusable' ? 'unchecked' : 'not-checked', K5: 'pass' };
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  /** @type {FhgmRecordResult[]} */
  const records = [];
  /** @type {Map<string, Record<string, unknown>>} */
  const byModelId = new Map();

  const statedVersion = typeof header.schemaVersion === 'string' ? header.schemaVersion : null;
  if (!admitsExtensionFields(statedVersion)) {
    rules.K1 = 'reject';
    errors.push(
      `${label} K1: the header states schemaVersion ${JSON.stringify(statedVersion)}, and docs/FORMAT.md R15 admits extension fields only from FHGFF3 1.1, so no x- key - and no FHGM record - is transportable here`,
    );
  }
  const models = header[MODELS_KEY];
  if (models === undefined) {
    return { valid: true, errors, warnings, records, byModelId, rules: { ...rules, K1: 'absent', K2: 'absent', K3: 'absent', K4: 'absent', K5: 'absent' } };
  }
  if (!Array.isArray(models) || models.length === 0 || models.some((item) => !isObject(item))) {
    rules.K1 = 'reject';
    errors.push(`${label} K1: ${MODELS_KEY} must be a single top-level array holding one or more records, found ${describeValue(models)}`);
    return { valid: false, errors, warnings, records, byModelId, rules: { ...rules, K2: 'skipped', K3: 'skipped', K4: 'skipped', K5: 'skipped' } };
  }

  if (settings.overlay) {
    const loaded = loadDraft('FHGM', 'overlay');
    if (loaded === null) throw new HeaderError('the pinned FHGM transport overlay is unavailable (rule V7)', { rule: 'V7' });
    const checkOverlay = draftValidator('FHGM', 'overlay').validate;
    if (!checkOverlay(header)) {
      rules.K1 = 'reject';
      for (const error of checkOverlay.errors ?? []) {
        errors.push(`${label} K1 overlay: ${(error.instancePath === '' ? 'the header' : error.instancePath)} ${error.message ?? ''} (${error.keyword})`.replace(/ \(\)/, ''));
      }
    }
  }
  if (rules.K1 === 'reject') {
    // With no transport there is no record set to judge: the rest is reported as
    // skipped rather than silently passing an untransportable file.
    return { valid: false, errors, warnings, records, byModelId, rules: { ...rules, K2: 'skipped', K3: 'skipped', K4: 'skipped', K5: 'skipped' } };
  }

  const { validate } = draftValidator('FHGM', 'contract');
  const fileForms = referenceForms(header, 'header');

  models.forEach((raw, index) => {
    if (!isObject(raw)) return; // K1 already refused a non-record entry
    const ok = validate(raw);
    const recordErrors = ok
      ? []
      : (validate.errors ?? []).map(
          (error) => `${label} K2 record ${index}: ${error.instancePath === '' ? MODELS_KEY : `${MODELS_KEY}${error.instancePath}`} ${error.message ?? ''} (${error.keyword})`.replace(/ \(\)/, ''),
        );
    if (!ok) rules.K2 = 'reject';
    const recordWarnings = ok ? [...emptyValueWarnings(raw, 'FHGM'), ...recordLinkSchemeWarnings(raw)] : [];
    errors.push(...recordErrors);
    warnings.push(...recordWarnings);

    /** @type {FhgmRecordResult} */
    const result = {
      index,
      modelId: typeof raw.modelId === 'string' ? raw.modelId : null,
      modelVersion: typeof raw.modelVersion === 'string' ? raw.modelVersion : null,
      featureId: typeof raw.featureId === 'string' ? raw.featureId : null,
      valid: recordErrors.length === 0,
      errors: recordErrors,
      warnings: recordWarnings,
      predecessor: null,
      featureTarget: null,
    };

    // K4, only against rows this reading actually got. No layer means nothing to
    // resolve against, which is `not-checked`, not a pass and not a rejection; an
    // untrustworthy layer is `unchecked` on every record, for the same reason.
    if (recordErrors.length === 0) {
      if (layer.state === 'rows') {
        const decoded = decodeFeatureId(/** @type {string} */ (result.featureId));
        const types = layer.rows.get(decoded) ?? [];
        if (types.length === 1 && isGeneRowType(types[0])) {
          result.featureTarget = { verdict: 'pass', detail: `one local gene row carries the decoded ID ${JSON.stringify(decoded)}` };
        } else {
          rules.K4 = 'reject';
          const why
            = types.length === 0
              ? `no local feature row carries the decoded ID ${JSON.stringify(decoded)}`
              : types.length > 1
                ? `${types.length} local feature rows share the decoded ID ${JSON.stringify(decoded)}, so it is not exactly one row`
                : `the single local row carrying the decoded ID ${JSON.stringify(decoded)} is of type ${JSON.stringify(types[0])}, not a gene row`;
          result.featureTarget = { verdict: 'reject', detail: why };
          errors.push(`${label} K4 record ${index}: its featureId must target one local gene row, and ${JSON.stringify(result.featureId)} does not: ${why}`);
        }
      } else if (layer.state === 'unusable') {
        result.featureTarget = { verdict: 'unchecked', detail: `the supplied feature layer cannot be trusted: ${layer.problems.join('; ')}` };
      }
    }

    const recordForms = referenceForms(raw.reference, 'record');
    if (conflicts(recordForms, fileForms)) {
      rules.K5 = 'reject';
      errors.push(`${label} K5 record ${index}: its reference contradicts the file genome link on ${sharedForms(recordForms, fileForms).join(', ')}`);
    } else if (!comparable(recordForms, fileForms)) {
      rules.K5 = 'reject';
      errors.push(
        `${label} K5 record ${index}: has no reference form comparable with the file genome link (the file states ${Object.keys(fileForms).join(', ') || 'nothing'}; the record states ${Object.keys(recordForms).join(', ') || 'nothing'})`,
      );
    }

    if (result.modelId !== null) {
      if (byModelId.has(result.modelId)) {
        rules.K3 = 'reject';
        errors.push(`${label} K3: Ambiguous model ID ${JSON.stringify(result.modelId)}: more than one record in this snapshot shares it, so the identity a pointer needs is unselectable`);
      } else {
        byModelId.set(result.modelId, raw);
      }
    }
    records.push(result);
  });

  return { valid: errors.length === 0, errors, warnings, records, byModelId, rules };
}

/**
 * Percent-decode a featureId the way a GFF3 `ID=` value is decoded.
 *
 * A malformed escape is left as written rather than throwing: the identifier is
 * data, and K4 compares it to whatever the file actually carries.
 *
 * @param {string|null} value
 * @returns {string}
 */
function decodeFeatureId(value) {
  if (typeof value !== 'string') return '';
  try {
    return decodeURIComponent(value.replace(/\+/g, '%2B'));
  } catch {
    return value;
  }
}

/**
 * A decoded-ID index over the feature rows one reading has.
 *
 * @typedef {{state: 'rows', rows: Map<string, string[]>, problems: string[]}
 *   | {state: 'unusable', rows: Map<string, string[]>, problems: string[]}
 *   | {state: 'none', rows: Map<string, string[]>, problems: string[]}} FeatureLayer
 */

/**
 * @param {Array<{id: string, type: string}>} rows feature rows with decoded ids
 * @returns {FeatureLayer}
 */
function indexRows(rows) {
  /** @type {Map<string, string[]>} */
  const index = new Map();
  for (const row of rows) {
    const types = index.get(row.id);
    if (types === undefined) index.set(row.id, [row.type]);
    else types.push(row.type);
  }
  return { state: 'rows', rows: index, problems: [] };
}

/**
 * Resolve the K4 feature layer for one call, in the order the caller chose.
 *
 * `features` first - bytes or text indexed by `src/features.js`, or row facts
 * taken from elsewhere; its ids are percent-decoded here so the comparison is
 * decoded against decoded, whichever side carried escapes. `geneIds` second -
 * the older shorthand of already-decoded gene row ids, where a repeated entry is
 * a second row because the rule counts rows. Neither, at the direct call, is
 * `none`: no layer, no verdict.
 *
 * @param {FhgmOptions} options
 * @returns {FeatureLayer}
 */
function resolveFeatureLayer(options) {
  const given = options.features;
  if (given !== undefined && given !== null) {
    if (typeof given === 'string' || given instanceof Uint8Array) {
      const indexed = indexGff3FeatureRows(given);
      if (indexed.problems.length > 0) return { state: 'unusable', rows: new Map(), problems: indexed.problems };
      return indexRows(indexed.rows.map((row) => ({ id: decodeFeatureId(row.id), type: row.type })));
    }
    if (Array.isArray(given) && given.every((row) => isObject(row) && typeof row.id === 'string' && typeof row.type === 'string')) {
      return indexRows(given.map((row) => ({ id: decodeFeatureId(row.id), type: row.type })));
    }
    throw new HeaderError('options.features must be GFF3 text, decompressed GFF3 bytes, or an array of {id, type} row facts (K4)', { rule: 'K4' });
  }
  if (options.geneIds !== undefined) {
    if (!Array.isArray(options.geneIds) || options.geneIds.some((id) => typeof id !== 'string')) {
      throw new HeaderError('options.geneIds must be an array of decoded gene row ids (K4)', { rule: 'K4' });
    }
    return indexRows(options.geneIds.map((id) => ({ id, type: 'gene' })));
  }
  return { state: 'none', rows: new Map(), problems: [] };
}

/**
 * One predecessor claim, judged against explicitly supplied prior snapshots only.
 *
 * @param {Record<string, unknown>} model
 * @param {Record<string, unknown>} pointer
 * @param {Record<string, unknown>} header the current file's header
 * @param {Map<string, {header: Record<string, unknown>, byModelId: Map<string, Record<string, unknown>>}>} predecessors
 * @returns {{verdict: string, detail: string}}
 */
function resolvePredecessor(model, pointer, header, predecessors) {
  const snapshot = typeof pointer.annotationChecksum === 'string' ? pointer.annotationChecksum : null;
  const modelId = typeof model.modelId === 'string' ? model.modelId : null;
  if (snapshot === null || snapshot === header.checksum || !predecessors.has(snapshot)) {
    return { verdict: VERDICTS.unresolvable, detail: 'the predecessor snapshot is the current file or was not supplied' };
  }
  if (pointer.modelId !== modelId) {
    return { verdict: VERDICTS.unresolvable, detail: `the pointer names another model ID ${JSON.stringify(pointer.modelId)}` };
  }
  const priorSnapshot = predecessors.get(snapshot);
  const prior = priorSnapshot.byModelId.get(/** @type {string} */ (modelId));
  if (prior === undefined) {
    return { verdict: VERDICTS.unresolvable, detail: `the predecessor snapshot has no model ${JSON.stringify(modelId)}` };
  }
  if (prior.modelVersion !== pointer.modelVersion) {
    return {
      verdict: VERDICTS.unresolvable,
      detail: `the predecessor records version ${JSON.stringify(prior.modelVersion)}, not ${JSON.stringify(pointer.modelVersion)}`,
    };
  }
  if (prior.modelVersion === model.modelVersion) {
    return { verdict: VERDICTS.unresolvable, detail: 'the revision reuses the predecessor model version' };
  }
  for (const [checksum, other] of predecessors) {
    if (checksum === snapshot) continue;
    const otherModel = other.byModelId.get(/** @type {string} */ (modelId));
    if (!isObject(otherModel)) continue;
    const otherPointer = isObject(otherModel.predecessor) ? otherModel.predecessor : null;
    if (
      otherPointer !== null
      && otherPointer.annotationChecksum === snapshot
      && otherPointer.modelId === modelId
      && otherPointer.modelVersion === pointer.modelVersion
      && otherModel.modelVersion !== prior.modelVersion
      && comparable(referenceForms(other.header, 'header'), referenceForms(priorSnapshot.header, 'header'))
      && comparable(referenceForms(otherModel.reference, 'record'), referenceForms(prior.reference, 'record'))
    ) {
      return {
        verdict: VERDICTS.ambiguous,
        detail: `the pointed record already has a recorded successor in supplied snapshot ${String(checksum).slice(0, 8)}...`,
      };
    }
  }
  if (!comparable(referenceForms(header, 'header'), referenceForms(priorSnapshot.header, 'header'))) {
    return { verdict: VERDICTS.unresolvable, detail: 'no matching assembly link with the predecessor snapshot' };
  }
  if (!comparable(referenceForms(model.reference, 'record'), referenceForms(prior.reference, 'record'))) {
    return { verdict: VERDICTS.unresolvable, detail: 'no matching record reference with the predecessor record' };
  }
  return { verdict: VERDICTS.resolvable, detail: `predecessor ${String(snapshot).slice(0, 8)}... version ${JSON.stringify(pointer.modelVersion)}` };
}

/**
 * Run the implemented FHGM model-level checks over one FHGFF3 header.
 *
 * @param {Record<string, unknown>} header the parsed FHGFF3 header record
 * @param {FhgmOptions} [options]
 * @returns {FhgmResult}
 */
export function checkFhgmModels(header, options = {}) {
  const entry = draftEntry('FHGM');
  if (entry === undefined) throw new HeaderError('this build pins no FHGM draft contract (rule V7)', { rule: 'V7' });
  /** @type {FhgmResult['contract']} */
  const contract = {
    type: 'FHGM',
    status: 'draft',
    repository: entry.repository,
    citation: entry.citation,
    commit: entry.commit,
    sha256: entry.sha256,
    file: entry.file,
  };
  if (!isObject(header)) {
    return {
      status: 'not-checked',
      valid: false,
      errors: ['B1: there is no parsed FHGFF3 header to read records out of'],
      warnings: [],
      records: [],
      contract,
      rules: { B1: 'reject', K1: 'skipped', K2: 'skipped', K3: 'skipped', K4: 'skipped', K5: 'skipped', K6: 'skipped' },
    };
  }
  if (options.base !== undefined && options.base.valid === false) {
    return {
      status: 'not-checked',
      valid: false,
      errors: ['B1: the released FHGFF3 header or its exact-byte checksum did not hold, so no FHGM verdict exists for this file'],
      warnings: [],
      records: [],
      contract,
      rules: { B1: 'reject', K1: 'skipped', K2: 'skipped', K3: 'skipped', K4: 'skipped', K5: 'skipped', K6: 'skipped' },
    };
  }

  const layer = resolveFeatureLayer(options);
  const own = checkSnapshot(header, { overlay: options.overlay === true, label: 'current', layer });
  const errors = [...own.errors];
  const warnings = [draftWarning(entry), ...own.warnings];
  const rules = { ...own.rules, B1: 'pass' };

  if (own.rules.K1 === 'absent') {
    return { status: 'absent', valid: true, errors, warnings: [], records: own.records, contract, rules: { ...rules, K2: 'absent', K3: 'absent', K5: 'absent', K6: 'absent' } };
  }

  // Supplied predecessors go through the same snapshot rules before any pointer
  // is judged against them: an ambiguous or malformed history is a defect in the
  // reading, not a foundation for one.
  /** @type {Map<string, {header: Record<string, unknown>, byModelId: Map<string, Record<string, unknown>>}>} */
  const predecessors = new Map();
  for (const supplied of options.predecessors ?? []) {
    if (!isObject(supplied) || !isObject(supplied.header)) continue;
    const checksum = typeof supplied.checksum === 'string' ? supplied.checksum : typeof supplied.header.checksum === 'string' ? supplied.header.checksum : null;
    if (checksum === null) continue;
    const prior = checkSnapshot(supplied.header, { overlay: options.overlay === true, label: `predecessor ${checksum.slice(0, 8)}...`, layer: { state: 'none', rows: new Map(), problems: [] } });
    if (!prior.valid && prior.rules.K1 !== 'absent') {
      errors.push(...prior.errors);
      for (const [rule, verdict] of Object.entries(prior.rules)) if (verdict === 'reject') rules[rule] = 'reject';
      continue;
    }
    predecessors.set(checksum, { header: supplied.header, byModelId: prior.byModelId });
  }

  let anyClaim = false;
  own.records.forEach((record, index) => {
    const raw = header[MODELS_KEY]?.[index];
    if (!isObject(raw) || !isObject(raw.predecessor)) return;
    anyClaim = true;
    const verdict = resolvePredecessor(raw, raw.predecessor, header, predecessors);
    record.predecessor = verdict;
    if (verdict.verdict === VERDICTS.resolvable) {
      if (rules.K6 !== 'reject') rules.K6 = VERDICTS.resolvable;
    } else {
      rules.K6 = 'reject';
      // An ambiguous history is reported in the words the draft reserves for it,
      // because it is the model identity that became unselectable, not a pointer
      // that happens to be missing.
      errors.push(
        verdict.verdict === VERDICTS.ambiguous
          ? `current K6 record ${index}: Ambiguous model ID - ${verdict.detail}`
          : `current K6 record ${index}: predecessor is ${verdict.verdict} - ${verdict.detail}`,
      );
    }
  });
  if (!anyClaim) rules.K6 = 'none';

  return { status: 'checked', valid: errors.length === 0, errors, warnings, records: own.records, contract, rules };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function describeValue(value) {
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (value === null) return 'null';
  if (typeof value === 'object') return 'an object';
  return `a ${typeof value}`;
}

/**
 * The rules this build runs, and the boundary on the one that needs a resolver,
 * for the capability matrix.
 *
 * @returns {{implemented: string[], notSupported: Record<string, {status: string, reason: string}>, boundaries: Record<string, Record<string, string>>}}
 */
export function fhgmRuleCoverage() {
  return {
    implemented: ['B1', 'K1', 'K2', 'K3', 'K4', 'K5', 'K6'],
    notSupported: {},
    boundaries: { K4: { ...FHGM_K4_BOUNDARY } },
  };
}
