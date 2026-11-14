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
| FHT | transcriptome | — | — | **no: draft, no released contract** |
| FHGM | gene model | — | — | **no: draft, no released contract** |

Versions were read from the shared registry, not assumed: `schemas/versions.json`
at tag `v0.6.0` of FAIR-bioHeaders-Specification states FHR `'2.1'`, FHP `'1.2'`,
FHGFF3 `'1.2'`, and lists no row for FHT or FHGM. The contracts declare
`"$schema": "https://json-schema.org/draft/2020-12/schema"`, so validation uses
ajv's 2020-12 build; see [`docs/CAPABILITY.md`](docs/CAPABILITY.md).

FHT and FHGM are drafts under development in their own repositories. Rule V7 keeps
a draft out of every release form, so this library ships no draft schema, names no
draft `schemaVersion`, publishes no w3id URL for either type, does not implement
the V7 opt-in lane, and makes no support claim for either. A record that cites a
draft URL is "any other value" under V5 and is read as FHR, exactly as V7 requires
when the lane is off — which it always is here.

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
| `selectSchema(record)` | V1-V6 selection over the bundled copies |
| `validateRecord(record, selection)` | contract validation, format assertion and warnings |
| `containerOf(path)`, `decompress(bytes)`, `sha512_256Available()` | helpers |
| `CURRENT_RELEASE`, `FHR1_RELEASE`, `DIALECT`, `releasesFor(type)`, `hasSchema(type, release)`, `loadSchema(type, release)`, `schemaEntry(type, release)`, `describeSupport(type)` | what this build bundles |
| `plainScalarIsPortable(text)`, `plainScalarOverflows(text)`, `resolveCore(text)`, `resolveYaml11(text)` | the R12/R13 scalar tables, exposed for reuse and testing |

A `Reading` is `{valid, container, metadata, checksum: {stated, computed, matches},
schema: {type, release, schemaVersion, rule}, warnings: string[], errors: string[]}`.
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
npm run conformance          # per-format table over all 291 vectors
npm run check:vendoring      # the vendored copies still match their provenance
npm run check:docs           # README/llms.txt state the registry's versions and real counts
npm run check:license        # LICENSE and package.json agree, body is canonical MPL-2.0
```

Current result on the pinned suite: **228 of 228 runnable vectors pass** —
fasta 98/98, gfa 56/56, fhp-fasta 36/36, fhgff3 38/38 — and **63 vectors are not
run** (jsonld 37, microdata 26) because those reader paths are not implemented.
They are reported as skipped with a reason, never as passes. Full breakdown, and
the list of what is not implemented or claimed:
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
  validator would accept `dateCreated: "2022-13-45"`.

## Repository layout

| Path | What it holds |
| --- | --- |
| `src/` | the library: `lines.js` (R1, R6, R7, R10, G1 block scan), `checksum.js` (R2-R5), `yaml.js` (R8, R12, R13, limits), `scalars.js` (the two YAML dialect tables), `selection.js` (V1-V6), `validate.js` (contract validation, format assertion, R14), `reader.js` (orchestration, strip) |
| `schemas/` | vendored released contract copies plus `provenance.json` (source tag, commit, SHA-256 per file) |
| `conformance/` | vendored shared vectors plus `provenance.json` (source commit, per-file digests) |
| `examples/` | vendored shared minimal examples used as valid fixtures |
| `scripts/` | `run-conformance.mjs`, `check-vendoring.mjs`, `check-docs.mjs`, `check-license.mjs`, `capability/` (the dependency study and the differential checks against the toolkit) |
| `test/` | unit tests and the vector-driven acceptance test |
| `docs/` | `CAPABILITY.md` (dependency and dialect findings), `CONFORMANCE.md` (vector results and boundaries), `USAGE.md` (recipes and the warning taxonomy) |
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
