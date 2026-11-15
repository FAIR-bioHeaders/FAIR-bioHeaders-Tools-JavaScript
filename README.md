# FAIR-bioHeaders in JavaScript

Read, check and strip [FAIR-bioHeaders](https://github.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification)
metadata headers — FHR in reference-genome FASTA and GFA, FHP in protein FASTA,
FHGFF3 in GFF3 — from JavaScript on Node.js.

A FAIR-bioHeaders header is a block of YAML lines at the top of a data file
(`;~key: value` in FASTA, `#~key: value` in GFA and GFF3). The metadata validates
against a per-type JSON Schema, and a SHA-512/256 checksum of the file's exact
bytes covers everything except the checksum line itself. This library implements
the reader side of those rules: parse the header, recompute the checksum, select
the contract the record cites, validate against it, and take the header out again.

```js
import { inspectFile, stripFile } from 'fair-bioheaders';

const reading = inspectFile('genome.fhr.fasta');
if (!reading.valid) {
  console.error(reading.errors);       // why the file is not a conforming FHR file
} else {
  console.log(reading.schema);         // { type: 'FHR', release: 'v0.6.0', schemaVersion: '2.1', rule: 'V3' }
  console.log(reading.checksum);       // { stated, computed, matches: true }
  console.log(reading.warnings);       // R11/R13-precision/R14 and non-empty-value warnings
  writeFileSync('genome.plain.fasta', stripFile('genome.fhr.fasta'));
}
```

## What this is, and what it is not

**It is a native JavaScript library.** Every check runs on Node's own `crypto`
(SHA-512/256), `zlib` and `ajv`. No Python, no CPython-under-Pyodide, no
WebAssembly, no subprocess.

**It is not the website's tooling.** The browser tools on
[fhref.org](https://fhref.org) (the metadata viewer, the table builder, the
GFF3 validator page) are a different codebase with different guarantees. The
family has already ruled ([fair-bioheaders.github.io#23](https://github.com/FAIR-bioHeaders/fair-bioheaders.github.io/issues/23))
that the website's FH\* validation must not be claimed as validation performed
by JavaScript, because that path runs the Python toolkit under Pyodide. Nothing
here inherits, wraps or replaces that page, and the website is not prior art for
this library: those tools are not built on it, and no claim about them is made
here. Conversely, this library's results are not the website's results.

**It is not `gff3-validator`.** This library reads and checks the FHGFF3 *header*.
GFF3 syntax, sequence-ontology terms and biological consistency belong to
[`gff3-validator`](https://github.com/FAIR-bioHeaders/gff3-validator), and a valid
FHGFF3 header says nothing about the features below it.

**It is not a writer.** There is no `combine`: nothing here computes a new
checksum or emits a header. See [What is not implemented](#what-is-not-implemented).

**It is not a Python wrapper.** The primary CI job installs no Python and runs no
foreign runtime; the reference-toolkit differentials are a separate, labelled
supplemental job, and the check that the pinned drafts still match the owning
repositories' live default branch is a third job, advisory and non-gating. See
[Conformance](#conformance).

## Install

Nothing is published yet. This repository's `package.json` is set up for it —
`name: fair-bioheaders`, `license: MPL-2.0` — but publication to npm is a
maintainer action and has not happened; `npm view fair-bioheaders` returned 404
(name unclaimed) on 2026-11-14, and no ownership of that name is asserted here.
Until then, install from the repository:

```sh
npm install github:FAIR-bioHeaders/FAIR-bioHeaders-Tools-JavaScript
```

Requires Node.js 20 or later (`node:crypto`'s `sha512-256`, `node:test` for the
test suite). Development is on Node.js 24 (`.nvmrc`).

## Supported contracts

| Type | File | Contract | `schemaVersion` | Supported here |
| --- | --- | --- | --- | --- |
| FHR | reference genome FASTA, GFA | `fhr.json` | `'2.1'` (2.0, 1 historically) | yes |
| FHP | protein FASTA | `fhp.json` | `'1.2'` (1.0, 1.1) | yes |
| FHGFF3 | GFF3 annotation | `fhgff3.json` | `'1.2'` (1.0, 1.1) | yes |
| FHT | transcriptome | — | — | **no: draft.** Recognised only through the opt-in rule-V7 lane, against bytes pinned by commit and SHA-256 |
| FHGM | gene-model records inside an FHGFF3 header | — | — | **no: draft.** Same lane; not a header type, and judged beside the FHGFF3 result |

Versions were read from the shared registry, not assumed: `schemas/versions.json`
at tag `v0.6.0` of FAIR-bioHeaders-Specification states FHR `'2.1'`, FHP `'1.2'`,
FHGFF3 `'1.2'`, and lists no row for FHT or FHGM. The contracts declare
`"$schema": "https://json-schema.org/draft/2020-12/schema"`, so validation uses
ajv's 2020-12 build; see [`docs/CAPABILITY.md`](docs/CAPABILITY.md).

FHT and FHGM are drafts under development in their own repositories, scheduled for
`v0.7.0` and `v0.8.0`. Neither is supported here, and nothing below makes it so: the
library ships no `schemaVersion` claim, no w3id URL and no registry row for either,
and `schemas/provenance.json` lists released contracts only.

What it does implement is the reader lane rule V7 defines, and the lane is a caller
decision rather than a capability that switches itself on:

```js
import { inspectFile } from 'fair-bioheaders';

// default: no lane. A draft citation is "any other value" under V5 and is read as FHR.
inspectFile('rna.fht.fasta');

// explicit: recognise the pinned FHT draft, and be told on every record that it is a draft.
const draft = inspectFile('rna.fht.fasta', { drafts: ['FHT'] });
draft.schema;   // { type: 'FHT', release: null, schemaVersion: null, rule: 'V7' }
draft.warnings; // ['FHT: warning: schema …/FHT-Specification/main/fht.json is an unreleased draft (commit …, sha256 … of those bytes); read against that pinned draft, not a released schema']

// FHGM: records ride inside an FHGFF3 header; the verdict is reported beside the file's own.
const withModels = inspectFile('annotation.fhgff3.gff3', { drafts: ['FHGM'] });
withModels.valid;      // the released FHGFF3 result - unchanged by any draft verdict
withModels.fhgm.valid; // the draft verdict on x-fhgm-models
```

The draft bytes are vendored under `drafts/` and pinned in `drafts/provenance.json`
to the commit and SHA-256 below; the digest is re-verified before anything reads
them, and a draft that moved under this build is reported instead of being read
quietly.

| Draft | Owning repository | Pinned commit | SHA-256 of the pinned bytes |
| --- | --- | --- | --- |
| FHT | FHT-Specification | `226f923c28b680edb3c546e99a751482d06aef1a` | `59ad9641adcb0e5591045c2d894c066d1adc9984cca84c5ff6502f8dad88487e` |
| FHGM | FHGM-Specification | `ac3d37b3033312844fc3151217731928ae33aa54` | `bf1553cac04dc88d8afaff1d39bc50360342e1ebedac4b73dfe3dff570ff410f` |

FHGM is not a header type at all: its records carry no `schema`, no
`schemaVersion` and no checksum, and travel in the `x-fhgm-models` extension key of
an FHGFF3 header, so the file keeps its released FHGFF3 citation and routing. The
implemented model rules are B1 (the boundary), K1 (transport), K2 (record contract),
K3 (unique `modelId`), K5 (reference agreement) and K6 (predecessor verdicts against
snapshots the caller supplies). **K4 is not implemented**: it resolves a
`featureId` against the GFF3 feature layer, and this library reads the FHGFF3 header
and nothing below it - feature lines belong to
[`gff3-validator`](https://github.com/FAIR-bioHeaders/gff3-validator). A caller that
already has the gene-row ids can pass `{ fhgm: { geneIds } }` and K4 runs.

[`docs/MATRIX.md`](docs/MATRIX.md) is the full type x operation x serialization
matrix, generated from the same registry the reader uses; it states every hole with
its reason.

## API

All functions are named exports of the package root. The library is ESM only.

| Function | What it does |
| --- | --- |
| `inspectBytes(bytes, {container})` | check a file's bytes; returns a `Reading` |
| `inspectFile(path, {container})` | the same for a file on disk |
| `stripBytes(bytes, {container})`, `stripFile(path, {container})` | remove the header block, byte-exact |
| `computeChecksum(bytes, container)` | R2-R5: the stated value, the recomputed value and the covered bytes |
| `digest(bytes)` | base64 SHA-512/256 of exactly those bytes |
| `headerLines(bytes, container)`, `splitLines(bytes)`, `headerText(bytes, container)` | the byte-level header scan |
| `loadHeaderYaml(text)` | R8/R12/R13-safe YAML reading → `{metadata, warnings}` |
| `selectSchema(record, {drafts})` | V1-V6 selection over the bundled copies; `{drafts: [...]}` opens the V7 lane |
| `validateRecord(record, selection)` | contract validation, format assertion and warnings |
| `TYPES`, `TYPE_IDS`, `RELEASED_TYPES`, `DRAFT_TYPE_IDS`, `capability(...)`, `capabilityRows()`, `headerTypesByContainer(...)`, `describeType(...)` | the five-type registry the capability matrix is rendered from |
| `draftSupport()`, `draftEntry(type)`, `draftSuitePin(type)`, `loadDraft(type)`, `verifyDraftBytes(dir)` | the rule-V7 pin: what it is, where the bytes are, whether they still match, and which development-suite revision this build's draft evidence names |
| `checkFhgmModels(header, {base, overlay, predecessors, geneIds})` | the FHGM draft verdict: B1, K1, K2, K3, K5, K6 (K4 only with `geneIds`) |
| `verifyParentLinks(record, {resolveParent})` | FHT draft rule C3: checked-pass / checked-fail / unchecked, against parent bytes the caller hands over |
| `validateRecord(record, selection)` | contract validation, format assertion and warnings |
| `containerOf(path)`, `decompress(bytes)`, `sha512_256Available()` | helpers |
| `CURRENT_RELEASE`, `FHR1_RELEASE`, `DIALECT`, `releasesFor(type)`, `hasSchema(type, release)`, `loadSchema(type, release)`, `schemaEntry(type, release)`, `describeSupport(type)` | what this build bundles |
| `plainScalarIsPortable(text)`, `plainScalarOverflows(text)`, `resolveCore(text)`, `resolveYaml11(text)` | the R12/R13 scalar tables, exposed for reuse and testing |

A `Reading` is `{valid, container, metadata, checksum: {stated, computed, matches},
schema: {type, release, schemaVersion, rule}, warnings: string[], errors: string[]}`,
plus `parentLinks` for an FHT draft reading that was given parents and `fhgm` for a
reading taken with the FHGM lane open. `release` and `schemaVersion` are null on a V7
reading, and `schema.draft` carries the citation, commit and digest it was taken
against.
`inspectBytes` does not throw for a non-conforming file — the findings are in
`errors`. An unavailable contract is reported as
`FHR: unsupported schema version: … (this tool has FHR schemas for main (v0.6.0), …)`
and the record is never checked against a different schema (V4).

The rules each finding names are the shared identifiers: `R1`-`R15`
([`docs/FORMAT.md`](https://github.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification/blob/main/docs/FORMAT.md)),
`P1`-`P2` (`docs/FHP.md`), `G1`-`G3` (`docs/FHGFF3.md`) and `V1`-`V6`
(`docs/SCHEMA-VERSIONS.md`).

## Conformance

Acceptance is the shared suite: FAIR-bioHeaders-Specification's `conformance/`
vectors, vendored byte-for-byte and pinned in `conformance/provenance.json`. No
JavaScript-specific test suite is defined, and none is needed — the vectors are
language-neutral by design.

```sh
npm test                     # unit tests + the shared vectors (63 skipped, see below)
npm run test:ci              # the same suite, accounted: zero tests / missing vector / unexplained skip fails
npm run conformance          # per-format table over all 291 vectors
npm run check:vendoring      # the vendored copies and the pinned drafts still match their provenance
npm run check:drafts         # just the draft pins
npm run check:matrix         # docs/MATRIX.md still matches src/types.js (`npm run matrix` regenerates it)
npm run check:docs           # README/llms.txt state the registry's versions and real counts
npm run check:license        # LICENSE and package.json agree, body is canonical MPL-2.0
```

Current result on the pinned suite: **228 of 228 runnable vectors pass** —
fasta 98/98, gfa 56/56, fhp-fasta 36/36, fhgff3 38/38 — and **63 vectors are not
run** (jsonld 37, microdata 26) because those reader paths are not implemented.
They are reported as skipped with a reason, never as passes. With the V7 lane
requested, the same reading path is exercised against the two development suites
that own the drafts, each verified against its own pin before anything is scored:
**92 draft vectors pass and 5 are not run** — FHT **66/66** at the suite revision
`24d3b033` (`C1`/`C2`/`C3`, the labels the registry states; the contract itself is pinned
separately at `226f923c`), and FHGM 26 pass with the 5 K4-dependent vectors not run,
labelled `UNPINNED` because this build states no suite pin for FHGM and therefore cannot
name the revision it scored. `node scripts/capability/draft-vectors.mjs` refuses a suite
whose manifest digest is not the one it pins, so a draft count here names a checked
revision or says it names none. Those counts are draft evidence and are never added to
the 291. Full breakdown, and the list of what is not implemented or claimed:
[`docs/CONFORMANCE.md`](docs/CONFORMANCE.md), and [`docs/USAGE.md`](docs/USAGE.md) for recipes.

The same vectors were also run through the released Python toolkit
(`fair-bioheaders` 0.11.0) for comparison: `npm run capability:toolkit` reports
validity on 217 uncompressed sequence vectors and byte-equality of `strip` on the
77 valid ones, with no disagreements.

## Limits you should know about

- **Integers beyond 2^53-1 are rounded.** JavaScript numbers are IEEE-754 doubles
  and `js-yaml` has no BigInt channel, so a header integer larger than
  `Number.MAX_SAFE_INTEGER` is read approximately. The reader reports this as a
  `precision warning` rather than hiding it. Python and Java readers hold the
  exact value. No shared vector exercises this.
- **Node only, for now.** SHA-512/256 comes from `node:crypto`. WebCrypto's
  `subtle.digest` supports SHA-1/256/384/512 but not SHA-512/256, so a browser or
  Deno/Bun build needs a pure-JavaScript SHA-512/256 implementation. None is
  included, and browser support is not claimed.
- **Whole-file bytes in memory.** There is no streaming reader; the 64 MiB and
  1 MiB header limits of `docs/FORMAT.md` are enforced for the header block, and
  gzip/BGZF input is decompressed in one step.
- **No `format`-by-annotation shortcuts.** `date` and `uri` are asserted through
  `ajv-formats`, because 2020-12 leaves `format` as an annotation and a silent
  validator would accept `dateCreated: "2022-13-45"`. This holds inside the draft
  lane too: the lane's tests assert that a bad `dateCreated` is refused by the
  pinned FHT contract.
- **A draft reading is not a released-contract reading.** It is labelled in three
  machine-checkable places (`rule: 'V7'`, `release: null`, the warning naming the
  commit and digest), and it never changes what the same bytes produce with the
  lane shut. FHGM verdicts are reported in a separate block for the same reason.

## What is not implemented

Stated as a list so it can be checked against, and each cell carries the same reason
in [`docs/MATRIX.md`](docs/MATRIX.md):

- **no writer.** No `combine`, no checksum emission, no YAML/JSON/JSON-LD/microdata
  output for any type. Creating or editing a header means a tool that writes one.
- **no JSON-LD or HTML microdata reader.** All 63 vectors of those two formats are
  reported not-run with their reasons (`docs/JSONLD.md` J3-J5 need a JSON-LD 1.1
  processor; `docs/MICRODATA.md` M2 needs HTML parsing with implied end tags).
  Nothing here reads a `.jsonld` or `.html` file.
- **no GFF3 feature validation**, and deliberately so: `gff3-validator` owns feature
  lines, SO terms and biology. This is also why FHGM's K4 is not implemented.
- **no parent-link verification by default.** A released record's parent checksum is
  metadata this library reports without recomputing. C3 recomputation runs only
  inside the FHT lane, only against parent bytes the caller hands over, and an
  unsupplied parent leaves the link `unchecked` - never `verified`.
- **no streaming, no gzip writing, no browser, Deno or Bun build** (SHA-512/256 comes
  from `node:crypto`; WebCrypto does not offer it), and no TypeScript declaration
  files.
- **no support for FHT or FHGM.** Both are drafts; the V7 lane recognises pinned bytes
  behind an explicit caller decision and warns on every record, which rule V7 calls
  recognition rather than adoption.
- **no release of this library.** No npm publication, no tag, no DOI, and
  `package.json` says `0.0.0`.

## Repository layout

| Path | What it holds |
| --- | --- |
| `src/` | the library: `lines.js` (R1, R6, R7, R10, G1 block scan), `checksum.js` (R2-R5), `yaml.js` (R8, R12, R13, limits), `scalars.js` (the two YAML dialect tables), `types.js` (the five-type registry), `selection.js` (V1-V7), `drafts.js` (the V7 pin), `validate.js` (contract validation, format assertion, R14), `fhgm.js` (B1, K1, K2, K3, K5, K6), `parent-links.js` (C3), `serializations.js` (what is scored and what is declared not-run), `reader.js` (orchestration, strip) |
| `schemas/` | vendored released contract copies plus `provenance.json` (source tag, commit, SHA-256 per file) |
| `drafts/` | the rule-V7 draft contracts, pinned by commit and SHA-256 in their own `provenance.json`; released-contract-only is `schemas/`, and that split is the point |
| `conformance/` | vendored shared vectors plus `provenance.json` (source commit, per-file digests) |
| `examples/` | vendored shared minimal examples used as valid fixtures |
| `scripts/` | `run-conformance.mjs`, `check-test-report.mjs` (the accounting guard), `make-matrix.mjs`, `golden-default-off.mjs`, `check-vendoring.mjs`, `check-docs.mjs`, `check-license.mjs`, `capability/` (the dependency study, the differential checks against the toolkit and the draft-lane runner), `ci/` (`draft-pins.mjs`: pinned contract bytes against a checkout at that commit; `suite-pin.mjs`: the pinned development suite against a checkout at the suite commit; `draft-pin-freshness.mjs`: pinned digests against the owning repository's live default branch, advisory and non-gating) |
| `test/` | unit tests, the vector-driven acceptance test, the default-gate golden and the workflow guard |
| `testutil/` | test fixture builders, kept out of `test/` because `node --test` treats every file under `test/` as a test file |
| `docs/` | `MATRIX.md` (the generated capability matrix), `CAPABILITY.md` (dependency and dialect findings), `CONFORMANCE.md` (vector results and boundaries), `USAGE.md` (recipes and the warning taxonomy) |
| `skills/` | a skill for coding agents working with this library |

## Licensing

MPL-2.0, in both places that matter: the `LICENSE` file and the `license` field of
`package.json` (`MPL-2.0`, a valid SPDX id; `npm pack --dry-run` output is recorded
in [`docs/CAPABILITY.md`](docs/CAPABILITY.md)). `LICENSE` carries the project's
provenance split — historical USDA-ARS material stays public domain within the
United States, contributions from March 2025 onward are MPL-2.0, third-party
material keeps its own licenses, previously distributed versions keep the terms they
were distributed under, and a file's modification date does not settle its parts.
This repository holds no historical USDA-ARS material today; the terms are stated
so that an import cannot silently drop them. The vendored contract copies keep the
licensing of the specification repository, recorded per file in
`schemas/provenance.json`. Runtime dependencies (`ajv`, `ajv-formats`, `js-yaml`)
are MIT and are distributed as separate modules.

## Citing

The specification is what should be cited, at a version:
FAIR-bioHeaders-Specification v0.6.0, and the 2024 FHR paper
[doi:10.1093/bib/bbae122](https://doi.org/10.1093/bib/bbae122). This library has
no release, no DOI and no citation record of its own yet; see
[FHR-Citation](https://github.com/FAIR-bioHeaders/FHR-Citation) for the family's
citation guidance.
