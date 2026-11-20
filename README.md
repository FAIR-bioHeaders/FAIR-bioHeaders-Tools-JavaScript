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
import { writeFileSync } from 'node:fs';
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
(name unclaimed) on 2026-11-14, re-verified against the npm registry on
2026-11-20 (both `fair-bioheaders` and `@fair-bioheaders/javascript` still
404), and no ownership of that name is asserted here.
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

The shared project has published FHT in `v0.7.0` and native FHGM in `v0.8.0`.
This library still bundles earlier owning-draft pins, including the historical
FHGM extension inside FHGFF3. Neither released addition is supported here: the
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
quietly. The re-pin of 2026-11-18 **moved these contract bytes** — unlike the suite-only
re-pin of 2026-11-16, whose narrative claimed the contracts had not moved and is now
superseded in `drafts/provenance.json` with the superseded digests kept on the record.

| Draft | Owning repository | Pinned commit | SHA-256 of the pinned bytes |
| --- | --- | --- | --- |
| FHT | FHT-Specification | `86438f21c3a17a58334c97aed4955be1a2393522` | `4156353aa6d077fee2d2c69be4e17859b8e4f81bb10824f3c87f6701de196e7a` |
| FHGM | FHGM-Specification | `06176262f9824f26d974a15d8feeebde1fbeb0a8` | `b7075e5872e0a5ffce5ae61c590ce182f1f219fa269413cad3b1a966753cfeae` |

Those are the **contract** bytes the lane compiles. The **development suites** are a
separate pair of pins, because a suite and its contract move at different times:

| Draft | Suite commit | Suite manifest | SHA-256 | Vectors |
| --- | --- | --- | --- | --- |
| FHT | `86438f21c3a17a58334c97aed4955be1a2393522` | `conformance/manifest.json` | `e5a4a5d027259e29a7e3cfb42da5e1ef07fa78d4a0e604ef73f28b8e5a59a508` | 82 |
| FHGM | `06176262f9824f26d974a15d8feeebde1fbeb0a8` | `development/conformance/manifest.json` | `e41f05fd8bb8b8ec175b0192b80832041c84e15c325876aa66a86ba6e59413ce` | 62 |

A count is a note about a digest, never the thing being pinned: `scripts/ci/suite-pin.mjs`
refuses a manifest that does not digest to the recorded value, and refuses one that does
digest while disagreeing with the count above.

FHGM is not a header type at all: its records carry no `schema`, no
`schemaVersion` and no checksum, and travel in the `x-fhgm-models` extension key of
an FHGFF3 header, so the file keeps its released FHGFF3 citation and routing. The
implemented model rules are B1 (the boundary), K1 (transport), K2 (record contract),
K3 (unique `modelId`), K4 (feature-target resolution) and K5 (reference agreement)
and K6 (predecessor verdicts against snapshots the caller supplies). K4 resolves a
`featureId` as written against the percent-decoded `ID` and `type` of the GFF3 feature rows —
exactly one gene row passes. The layer is an injected resolver: by default the lane
indexes the file's own rows through `src/features.js`, a caller holding the feature
layer elsewhere can inject `options.features` (row facts or GFF3 content) or the
older `{ fhgm: { geneIds } }` shorthand, and `features: null` closes the check.
Indexing two columns of a row resolves a pointer and validates no feature: SO terms,
coordinates and biology stay with
[`gff3-validator`](https://github.com/FAIR-bioHeaders/gff3-validator). Without a
layer K4 is `not-checked`; with an untrustworthy one (a row without nine fields) it
is `unchecked` — never a pass, never a rejection.

[`docs/MATRIX.md`](docs/MATRIX.md) is the full type x operation x serialization
matrix, generated from the same registry the reader uses; it states every hole with
its reason.

## API

All functions are named exports of the package root. The library is ESM only.

| Function | What it does |
| --- | --- |
| `inspectBytes(bytes, {container})` | check a file's bytes; returns a `Reading` |
| `inspectFile(path, {container})` | the same for a file on disk, read in chunks (sync) |
| `inspectFileAsync(path, opts)`, `inspectStream(asyncIterable, opts)` | the same as a stream: any size, gzip included, memory the size of the header; returns a `Promise<Reading>` |
| `stripBytes(bytes, {container})`, `stripFile(path, {container})` | remove the header block, byte-exact |
| `stripFileTo(input, output, opts)` | the same as a stream, written to `output` once header structure and input transport are accepted; does not validate schema/checksum |
| `computeChecksum(bytes, container)` | R2-R5: the stated value, the recomputed value and the covered bytes |
| `HeaderScanner` | the single pass behind all of these: `push` chunks, then `finish` |
| `digest(bytes)` | base64 SHA-512/256 of exactly those bytes |
| `headerLines(bytes, container)`, `splitLines(bytes)`, `headerText(bytes, container)` | the byte-level header scan |
| `loadHeaderYaml(text)` | R8/R12/R13-safe YAML reading → `{metadata, warnings}` |
| `selectSchema(record, {drafts})` | V1-V6 selection over the bundled copies; `{drafts: [...]}` opens the V7 lane |
| `validateRecord(record, selection)` | contract validation, format assertion and warnings |
| `TYPES`, `TYPE_IDS`, `RELEASED_TYPES`, `DRAFT_TYPE_IDS`, `capability(...)`, `capabilityRows()`, `headerTypesByContainer(...)`, `describeType(...)` | the five-type registry the capability matrix is rendered from |
| `draftSupport()`, `draftEntry(type)`, `draftSuitePin(type)`, `loadDraft(type)`, `verifyDraftBytes(dir)` | the rule-V7 pin: what it is, where the bytes are, whether they still match, and which development-suite revision this build's draft evidence names |
| `checkFhgmModels(header, {base, overlay, predecessors, features, geneIds})` | the FHGM draft verdict: B1, K1, K2, K3, K5, K6, and K4 against `features` (row facts or GFF3 content) or `geneIds`; `inspectBytes` defaults `features` to the file's own bytes when the lane names FHGM and the file is read as GFF3, and to no layer at all in another container, where K4 reports `not-checked` |
| `verifyParentLinks(record, {resolveParent})` | FHT draft rule C3: checked-pass / checked-fail / unchecked, against parent bytes the caller hands over |
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
**all 144 draft vectors pass.** FHT **82/82, 0 fail, 0 not-run** at suite pin
`86438f21` (`C1`/`C2`/`C3`, the labels the registry states), and FHGM **62/62, 0 fail,
0 not-run** at suite pin `06176262` — FHGM scored 58/4 when the re-pin landed on
2026-11-18; the four named `layers.model` expectations of FHGM-Specification#29 are
implemented in this build (2026-11-19), against a draft whose upstream semantics
`FHGM#22`/`#27`/`#28`/`#32` still hold open.
The re-pin of 2026-11-18 moved **both contract byte sets** for the first time since the
lane existed: the old pins (FHT `226f923c`/`be9bcc82` at 72 vectors, FHGM
`ac3d37b3`/`c503ecf3` at 43) are superseded and named in `previousPin` fields of
`drafts/provenance.json`, where the retrieval date, command and digests are recorded.
FHGM's suite has had a stated pin since the re-pin of 2026-11-16 — before that its row
read `UNPINNED`, and the 31 vectors it scored were scored against a checkout nobody had
checked. The K4-dependent FHGM vectors are now eleven, up from eight, and all eleven
reached a `pass` or `reject` verdict against the file's own feature rows.
`node scripts/capability/draft-vectors.mjs` refuses a suite
whose manifest digest is not the one it pins, so a draft count here names a checked
revision or says it names none. A K4 vector whose feature layer is absent or
untrustworthy is still reported not-run with that state, never scored by assumption, and
so is a vector whose `layers.gff3` expectation asks about the feature layer this library
does not judge. Four of the 82 FHT vectors carry `promotion: candidate-unreviewed` upstream,
twelve FHGM vectors came from a packet marked `Status: DRAFT`, and FHGM's four
failures on the day the re-pin landed were this build not yet implementing four
expectations FHGM-Specification#29 added to
`layers.model` — base selection by cited release (`carrier-cites-raw-main`), root-gene-row
target and raw-vs-decoded featureId identity (`feature-target-gene-with-parent`,
`feature-id-names-percent-encoding`), and NFC-compared modelId uniqueness
(`model-ids-equal-under-nfc`); those four are implemented in this build (2026-11-19,
Round 14 #23). They are reported by name with their reasons
([`docs/CONFORMANCE.md`](docs/CONFORMANCE.md)), because a pass on an unreviewed expectation
is agreement with a draft claim, not review of it, and a failure is where the work is.
Those counts are draft evidence and are never added to
the 291. Full breakdown, and the list of what is not implemented or claimed:
[`docs/CONFORMANCE.md`](docs/CONFORMANCE.md), and [`docs/USAGE.md`](docs/USAGE.md) for recipes.

The same vectors were also run through the released Python toolkit
(`fair-bioheaders` 0.12.0) for comparison: `npm run capability:toolkit` reports
validity on 217 uncompressed sequence vectors and byte-equality of `strip` on the
77 valid ones, with no disagreements.

A requested draft suite without a complete pin is refused before any suite is
scored (issue #8, reaffirmed 2026-11-16). Missing or partial suite provenance exits
2 with `NOTHING SCORED`; no supplied existing suite path exits 3. The low-level
pin-view API can report absence, but neither runner nor suite-check CLI treats it
as verified evidence. Shipped pins and default released behavior are unchanged.

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
- **One pass, bounded memory.** Every reader scans the bytes once: the header
  lines are kept (at most 1 MiB and 10,000 lines, the limits of `docs/FORMAT.md`)
  and every other byte goes straight into the SHA-512/256 hash. `inspectFile`
  reads a plain file in 1 MiB chunks, so its size is not limited (files over
  2 GiB are tested). In-memory gzip/BGZF decompression (`inspectBytes`,
  `inspectFile`, `stripBytes`, `stripFile`, `decompress`) stops at
  `maxDecompressedBytes`, 1 GiB by default, with an error in the reading instead
  of exhausting memory. `inspectFileAsync`, `inspectStream` and `stripFileTo`
  decompress as a stream and have no such limit. The 64 MiB metadata-file limit
  does not arise: this library reads no metadata files. The one exception is the
  FHGM draft lane on a GFF3 file, which also keeps the file's own feature index
  for K4 (each row's `type` and `ID`, and at most 20 listed malformed rows); a
  FASTA or GFA file is never indexed, whichever draft lanes are open.
- **No `format`-by-annotation shortcuts.** `date` is asserted through
  `ajv-formats` and `uri` through this library's own RFC 3986 check
  (`src/uri.js`), because 2020-12 leaves `format` as an annotation and a silent
  validator would accept `dateCreated: "2022-13-45"`. The `ajv-formats` `uri`
  check refuses a URI with an empty hier-part (`urn:`, `doi:`, `mailto:`), which
  RFC 3986 and the Python toolkit accept; such a value passes `format: uri` here
  too, and R14 still warns about it. This holds inside the draft
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
  lines, SO terms and biology. The FHGM lane's K4 reads two columns of each feature
  row (`type` and `ID`) to resolve a `featureId` pointer; it judges none of them.
- **no parent-link verification by default.** A released record's parent checksum is
  metadata this library reports without recomputing. C3 recomputation runs only
  inside the FHT lane, only against parent bytes the caller hands over, and an
  unsupplied parent leaves the link `unchecked` - never `verified`.
- **no gzip writing, no browser, Deno or Bun build** (SHA-512/256 comes
  from `node:crypto`; WebCrypto does not offer it), and no TypeScript declaration
  files.
- **no released FHT or native FHGM implementation.** This build retains historical drafts; the V7 lane recognises pinned bytes
  behind an explicit caller decision and warns on every record, which rule V7 calls
  recognition rather than adoption.
- **no release of this library.** No npm publication, no tag, no DOI, and
  `package.json` says `0.0.0`.

## Setup and API guide

See [the complete installed-package quickstart and API guide](docs/GETTING-STARTED.md)
for prerequisites, positive and rejection examples, errors, side effects and
resource boundaries. The pinned draft lane is opt-in through `{drafts: [...]}`;
its exact commits and digests remain recorded above and in `drafts/provenance.json`.

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
