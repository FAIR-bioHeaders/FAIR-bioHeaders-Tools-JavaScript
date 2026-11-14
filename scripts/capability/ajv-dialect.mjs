#!/usr/bin/env node
/**
 * Capability study (i): does `ajv` honour the released contracts as written?
 *
 * The family contracts declare `"$schema": "https://json-schema.org/draft/2020-12/schema"`,
 * so a draft-07 validator is not a candidate without proof. This script compiles
 * the vendored v0.6.0 `fhr.json`, `fhp.json` and `fhgff3.json` and exercises the
 * constructs they actually use — `$defs`/`definitions` and `$ref`,
 * `patternProperties` for `^x-…` extension keys, `propertyNames`,
 * `contains`/`minContains`, `format` assertion, and the version-gated `if`/`then`
 * conditionals — with **negative controls**: each check that a conditional fires
 * is paired with the same record at a version where it must pass, so a validator
 * that silently ignores the construct fails this script instead of passing it.
 *
 *     node scripts/capability/ajv-dialect.mjs
 *
 * Exit status 0 only when every expectation is met. Recorded output:
 * `docs/CAPABILITY.md`.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CURRENT_RELEASE, DIALECT, has as hasSchema, loadSchema } from '../../src/registry.js';
import { validateRecord, validator } from '../../src/validate.js';
import { DRAFT_TYPES, draftEntry, draftWarning, loadDraft } from '../../src/drafts.js';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default;
const AjvDraft07 = require('ajv').default;
const addFormats = require('ajv-formats').default;
const ajvVersion = require('ajv/package.json').version;
const formatsVersion = require('ajv-formats/package.json').version;
const yamlVersion = require('js-yaml/package.json').version;

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = resolve(HERE, '..', '..', 'examples');

let failures = 0;
const results = [];
const check = (name, condition, detail = '') => {
  if (!condition) failures += 1;
  results.push(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const note = (text) => results.push(`NOTE  ${text}`);

/**
 * @param {'FHR'|'FHP'|'FHGFF3'} type
 * @param {string} release
 * @returns {Record<string, unknown>}
 */
function contract(type, release) {
  return structuredClone(loadSchema(type, release).schema);
}

console.log(`node ${process.version} | ajv ${ajvVersion} | ajv-formats ${formatsVersion} | js-yaml ${yamlVersion}`);
console.log(`contracts: ${CURRENT_RELEASE} copies, dialect ${DIALECT}\n`);

// --- 0. the released contracts compile and accept their own examples -------
const minimal = {
  FHR: JSON.parse(readFileSync(join(EXAMPLES, 'minimal.fhr.json'), 'utf8')),
  FHP: JSON.parse(readFileSync(join(EXAMPLES, 'minimal-predicted.fhp.json'), 'utf8')),
  FHGFF3: JSON.parse(readFileSync(join(EXAMPLES, 'minimal-reference.fhgff3.json'), 'utf8')),
};
for (const [type, record] of Object.entries(minimal)) {
  const result = validateRecord(record, { type, release: CURRENT_RELEASE, rule: 'V3' });
  check(`${type}.json at ${CURRENT_RELEASE} accepts the shared ${type} example`, result.valid, JSON.stringify(result.errors));
}

// --- 1. $defs / definitions and $ref are really dereferenced --------------
{
  const ajv = new Ajv2020({ strict: true, strictRequired: false, strictTypes: false, validateFormats: true, allowUnionTypes: true });
  addFormats(ajv, { formats: ['date', 'uri'] });
  const fhp = contract('FHP', CURRENT_RELEASE);
  delete fhp.$id;
  fhp.$defs.Author = { type: 'string' };
  const v = ajv.compile(fhp);
  check('#/$defs/Author is dereferenced (patching it invalidates the valid FHP example)', v(minimal.FHP) === false);

  const ajv2 = new Ajv2020({ strict: true, strictRequired: false, strictTypes: false, validateFormats: true, allowUnionTypes: true });
  addFormats(ajv2, { formats: ['date', 'uri'] });
  const fhrSchema = contract('FHR', CURRENT_RELEASE);
  delete fhrSchema.$id;
  fhrSchema.definitions.sha2 = { type: 'string', pattern: 'ZZZZZ' };
  const v2 = ajv2.compile(fhrSchema);
  check('fhr.json uses the legacy `definitions` keyword; #/definitions/sha2 is still dereferenced', v2(minimal.FHR) === false);
}

// --- 2. patternProperties for `^x-…` extension keys ----------------------
{
  const withExt = (extra) => ({ ...minimal.FHP, ...extra });
  check('patternProperties accepts an x- key at 1.2', validateRecord(withExt({ 'x-refget-commonName': { nested: [1, 'two', null, true] } }), { type: 'FHP', release: CURRENT_RELEASE, rule: 'V3' }).valid);
  check('a misspelt standard field stays invalid (additionalProperties false)', !validateRecord(withExt({ genom: 'x' }), { type: 'FHP', release: CURRENT_RELEASE, rule: 'V3' }).valid);
  for (const key of ['X-Note', 'x-', 'x-_note', 'x-a b', 'x-ä', 'x-note\n']) {
    check(`extension key ${JSON.stringify(key)} is refused`, !validateRecord(withExt({ [key]: 1 }), { type: 'FHP', release: CURRENT_RELEASE, rule: 'V3' }).valid);
  }
  check('extension key x-a.b-c_1 is accepted', validateRecord(withExt({ 'x-a.b-c_1': 1 }), { type: 'FHP', release: CURRENT_RELEASE, rule: 'V3' }).valid);
  const nested = structuredClone(minimal.FHP);
  nested.taxon['x-bogus'] = 1;
  check('x- key inside a nested object is refused (nested objects stay closed)', !validateRecord(nested, { type: 'FHP', release: CURRENT_RELEASE, rule: 'V3' }).valid);
}

// --- 3. version-gated if/then: extension fields (R15) --------------------
{
  const at = (type, version, release) => validateRecord({ ...minimal[type], schema: `https://w3id.org/fair-bioheaders/${type.toLowerCase()}/${release}`, schemaVersion: version, 'x-note': 1 }, { type, release, rule: 'V3' });
  check('FHR: x- refused when the record states "2.0"', !at('FHR', '2.0', 'v0.6.0').valid);
  check('FHR: x- accepted when the record states "2.1"', at('FHR', '2.1', 'v0.6.0').valid);
  check('FHP: x- refused at "1.0" (added in 1.1)', !at('FHP', '1.0', 'v0.6.0').valid);
  check('FHP: x- accepted at "1.1"', at('FHP', '1.1', 'v0.6.0').valid);
  check('FHGFF3: x- refused at "1.0"', !at('FHGFF3', '1.0', 'v0.6.0').valid);
  check('FHGFF3: x- accepted at "1.1"', at('FHGFF3', '1.1', 'v0.6.0').valid);
  const v040 = validateRecord({ ...minimal.FHP, schema: 'https://w3id.org/fair-bioheaders/fhp/v0.4.0', schemaVersion: '1.0', 'x-note': 1 }, { type: 'FHP', release: 'v0.4.0', rule: 'V3' });
  check('the v0.4.0 copy has no patternProperties at all, so x- is an unknown key there', !v040.valid);
}

// --- 4. version-gated if/then: dotted BUSCO values (#170) ---------------
{
  const completeness = (lineageDataset) => ({ lineageDataset, completeSingle: 1, completeDuplicated: 0, fragmented: 0, missing: 0, total: 1 });
  const fhpAt = (version, release, lineageDataset) =>
    validateRecord(
      { ...minimal.FHP, schema: `https://w3id.org/fair-bioheaders/fhp/${release}`, schemaVersion: version, completeness: completeness(lineageDataset) },
      { type: 'FHP', release, rule: 'V3' },
    );
  check('FHP 1.2: diptera_odb12.2 accepted', fhpAt('1.2', 'v0.6.0', 'diptera_odb12.2').valid);
  check('FHP 1.1: dotted value refused by the conditional', !fhpAt('1.1', 'v0.5.0', 'diptera_odb12.2').valid);
  check('FHP 1.0: dotted value refused by the conditional', !fhpAt('1.0', 'v0.4.0', 'diptera_odb12.2').valid);
  check('FHP 1.1: undotted value still accepted (the gate is the pattern, not the field)', fhpAt('1.1', 'v0.5.0', 'diptera_odb10').valid);
  for (const bad of ['diptera_odb10.', 'diptera_odb.2', 'diptera_odb10.a2', 'Diptera_odb10.2']) {
    check(`FHP 1.2: malformed dotted value ${JSON.stringify(bad)} refused`, !fhpAt('1.2', 'v0.6.0', bad).valid);
  }
}

// --- 5. contains / minContains (FHGFF3 genome link) ---------------------
{
  const withParents = (derivedFrom) => validateRecord({ ...minimal.FHGFF3, derivedFrom }, { type: 'FHGFF3', release: CURRENT_RELEASE, rule: 'V3' });
  const parent = (headerType, checksum, relationship) => ({ headerType, checksum, relationship });
  const A = `${'A'.repeat(43)}=`;
  const B = `${'B'.repeat(43)}=`;
  check('FHGFF3: minContains refuses two `annotates` parents', !withParents([parent('FHR', A, 'annotates'), parent('FHR', B, 'annotates')]).valid);
  check('FHGFF3: one `annotates` parent plus one other parent is accepted', withParents([parent('FHR', A, 'annotates'), parent('FHP', B, 'translatedFrom')]).valid);
  check('FHGFF3: `annotates` on a non-FHR parent is refused', !withParents([parent('FHP', B, 'annotates')]).valid);

  // The same bytes evaluated as draft-07: `minContains` is a 2019-09 keyword, so
  // a draft-07 build reads `contains` alone and the cardinality rule changes.
  const asDraft07 = structuredClone(contract('FHGFF3', CURRENT_RELEASE));
  delete asDraft07.$id;
  asDraft07.$schema = 'http://json-schema.org/draft-07/schema#';
  const ajv7 = new AjvDraft07({ strict: false, strictRequired: false, strictTypes: false, validateFormats: false });
  let draftOutcome;
  try {
    const v7 = ajv7.compile(asDraft07);
    draftOutcome = v7({ ...minimal.FHGFF3, derivedFrom: [parent('FHP', B, 'annotates')] });
  } catch (error) {
    draftOutcome = `threw: ${String(error.message).split('\n')[0]}`;
  }
  note(`draft-07 build on the same bytes, one `+ `annotates` + ` parent that is not FHR: ${JSON.stringify(draftOutcome)} (2020-12 build says false)`);
  let refusal;
  try {
    new AjvDraft07({ strict: false }).addSchema(structuredClone(contract('FHP', CURRENT_RELEASE)));
    refusal = 'accepted the 2020-12 bytes without complaint';
  } catch (error) {
    refusal = String(error.message).split('\n')[0];
  }
  note(`plain \`ajv\` (draft-07 entry point) on the released fhp.json: ${refusal}`);
}

// --- 6. format is an opt-in annotation in 2020-12 -----------------------
{
  const noFormats = new Ajv2020({ strict: true, strictRequired: false, strictTypes: false, validateFormats: false, allowUnionTypes: true });
  const s = contract('FHR', CURRENT_RELEASE);
  delete s.$id;
  const v = noFormats.compile(s);
  check('validateFormats:false lets a bogus date through (so formats must be asserted)', v({ ...minimal.FHR, dateCreated: '2022-13-45' }) === true);
  check('this library asserts them instead', !validateRecord({ ...minimal.FHR, dateCreated: '2022-13-45' }, { type: 'FHR', release: CURRENT_RELEASE, rule: 'V3' }).valid);
  check('and refuses a value that is not a URI at all', !validateRecord({ ...minimal.FHR, relatedLink: ['not a URI'] }, { type: 'FHR', release: CURRENT_RELEASE, rule: 'V3' }).valid);
  check('R14: a javascript: URI stays schema-valid (warning, not rejection)', validateRecord({ ...minimal.FHR, relatedLink: ['javascript:alert(1)'] }, { type: 'FHR', release: CURRENT_RELEASE, rule: 'V3' }).valid);
  check('R14: urn:, doi: and ftp:// are URIs too', validateRecord({ ...minimal.FHR, relatedLink: ['urn:isbn:9780306406157', 'doi:10.1093/bib/bbae122', 'ftp://ftp.example.org/x'] }, { type: 'FHR', release: CURRENT_RELEASE, rule: 'V3' }).valid);
}

// --- 7. R13: non-finite numbers -----------------------------------------
{
  const fhr = { type: 'FHR', release: CURRENT_RELEASE, rule: 'V3' };
  check('NaN in a ranged field is refused', !validateRecord({ ...minimal.FHR, vitalStats: { gcContent: Number.NaN } }, fhr).valid);
  check('Infinity in a ranged field is refused', !validateRecord({ ...minimal.FHR, vitalStats: { gcContent: Number.POSITIVE_INFINITY } }, fhr).valid);
  check('NaN in an un-ranged field is refused', !validateRecord({ ...minimal.FHP, geneticCode: Number.NaN }, { type: 'FHP', release: CURRENT_RELEASE, rule: 'V3' }).valid);
}

// --- 8. bundling several releases in one validator instance -------------
{
  const ajv = new Ajv2020({ strict: true, strictRequired: false, strictTypes: false, validateFormats: true, allowUnionTypes: true });
  addFormats(ajv, { formats: ['date', 'uri'] });
  let collision = '';
  try {
    ajv.addSchema(contract('FHP', 'v0.5.0'), 'fhp-v0.5.0');
    ajv.addSchema(contract('FHP', 'v0.6.0'), 'fhp-v0.6.0');
    collision = 'both added without error';
  } catch (error) {
    collision = String(error.message).split('\n')[0];
  }
  note(`two release copies share one $id (the raw-main URL): ${collision}`);
  note('this library compiles each copy with $id removed and keys it by type and release instead');
}

// --- 9. strict-mode configuration --------------------------------------
{
  let complaint = '';
  try {
    const ajv = new Ajv2020({ strict: true, validateFormats: true, allowUnionTypes: true });
    addFormats(ajv, { formats: ['date', 'uri'] });
    ajv.compile(contract('FHP', CURRENT_RELEASE));
    complaint = 'compiled with default strict settings';
  } catch (error) {
    complaint = String(error.message).split('\n')[0];
  }
  note(`ajv 8 default strict mode on the released fhp.json: ${complaint}`);
  const compiled = [];
  for (const release of ['v0.3.0', 'v0.3.1', 'v0.4.0', 'v0.4.1', 'v0.4.2', 'v0.5.0', 'v0.6.0']) {
    for (const type of ['FHR', 'FHP', 'FHGFF3']) {
      if (!hasSchema(type, release)) continue; // that release published no such contract
      validator(type, release);
      compiled.push(`${type}@${release}`);
    }
  }
  check(`this library's configuration compiles every bundled copy (${compiled.length} of them)`, compiled.length === 17, compiled.join(' '));
}

// --- 10. the rule-V7 draft contracts compile under the same configuration --
// Draft bytes are read only through the lane, but when they are read they are read
// by this compiler: same 2020-12 build, same strict settings, same asserted
// formats. A draft contract that would force a different configuration would be a
// finding worth having before anyone relies on the lane.
{
  for (const type of DRAFT_TYPES) {
    const loaded = loadDraft(type);
    check(`${type} draft compiles on the same 2020-12 configuration`, loaded !== null && loaded.schema.$schema === DIALECT, loaded?.schema.$schema ?? 'unavailable');
    check(`${type} draft declares draft/2020-12, not draft-07`, loaded?.schema.$schema === 'https://json-schema.org/draft/2020-12/schema');
    const empty = validateRecord({}, { type, release: null, rule: 'V7', draft: loaded.entry });
    check(`${type} draft reports its required set on an empty record`, empty.valid === false && empty.errors.some((line) => line.includes('required property')), empty.errors.map((line) => line.split(' ')[0]).join(', '));
    const warned = draftWarning(loaded.entry);
    check(`${type} warning names the commit, the digest and what the result is not`, warned.includes(loaded.entry.commit) && warned.includes(loaded.entry.sha256) && warned.includes('not a released schema'));
  }

  // FHT C2 is inside the pinned bytes: an arbitrary URL must fail the contract,
  // and it must not be able to select FHT. Negative control: the pinned citation
  // must be accepted by the same pattern.
  const fht = loadDraft('FHT');
  const record = (schemaValue, extra = {}) => ({
    schema: schemaValue,
    schemaVersion: '1.0',
    transcriptome: 'Capability study record',
    assemblyType: 'de novo',
    moleculeType: 'mRNA',
    taxon: { name: 'Homo sapiens' },
    version: '1.0.0',
    metadataAuthor: [{ name: 'Capability study record (synthetic)' }],
    dateCreated: '2026-11-14',
    checksum: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    ...extra,
  });
  const pinned = validateRecord(record(fht.entry.citation), { type: 'FHT', release: null, rule: 'V7', draft: fht.entry });
  check('the pinned raw-main citation satisfies the FHT draft contract (control)', pinned.valid === true, pinned.errors.join('; '));
  const arbitrary = validateRecord(record('https://example.org/schemas/fht.json'), { type: 'FHT', release: null, rule: 'V7', draft: fht.entry });
  check('an arbitrary URL fails the FHT draft contract (C2)', arbitrary.valid === false && arbitrary.errors.some((line) => line.includes('schema')), arbitrary.errors.join('; '));
  const dated = validateRecord(record(fht.entry.citation, { dateCreated: '2022-13-45' }), { type: 'FHT', release: null, rule: 'V7', draft: fht.entry });
  check('format is ASSERTED in the draft lane too: dateCreated "2022-13-45" is refused', dated.valid === false && dated.errors.some((line) => line.includes('format')), dated.errors.join('; '));
  note(`with the lane shut, that same citation is "any other value" under V5 and is read as FHR (docs/SCHEMA-VERSIONS.md V7)`);

  const fhgm = loadDraft('FHGM');
  const overlay = loadDraft('FHGM', 'overlay');
  check('the FHGM transport overlay compiles too', overlay !== null && overlay.schema.$schema === DIALECT);
  const bareRecord = validateRecord({ modelId: 'm', modelVersion: '1', featureId: 'g1' }, { type: 'FHGM', release: null, rule: 'V7', draft: fhgm.entry });
  check('the FHGM record contract requires reference (deviation D1)', bareRecord.valid === false && bareRecord.errors.some((line) => line.includes('reference')), bareRecord.errors.join('; '));
  note('FHGM records carry no schema of their own, so nothing about them is selected by V1-V7: the lane picks the contract, the FHGFF3 citation routes the file');
}

for (const line of results) console.log(line);
console.log(`\n${results.filter((line) => line.startsWith('PASS')).length} pass, ${failures} fail`);
process.exitCode = failures === 0 ? 0 : 1;
