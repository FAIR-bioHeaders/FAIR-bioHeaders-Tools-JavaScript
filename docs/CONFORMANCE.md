# Conformance: what the shared vectors say about this build

Acceptance is FAIR-bioHeaders-Specification's own conformance suite — 291 vectors,
reader-neutral by design, each a real file plus the outcome a conforming
implementation must produce. This repository adds no second suite and defines no
JavaScript-specific expectations; it vendors the shared bytes and runs them.

```sh
npm run conformance        # per-format table over all 291 vectors
npm test                   # unit tests + one test per vector (63 reported skipped)
npm run check:vendoring    # the vendored copies still match their provenance
```

## Where the vectors come from

| Field | Value |
| --- | --- |
| repository | [FAIR-bioHeaders-Specification](https://github.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification) |
| ref | `main` |
| commit | `a60bc02ad94c364e4bff30d43561c60663d72beb` |
| path | `conformance/` |
| retrieved | 2026-11-14 |
| manifest SHA-256 | `bc3edf9e9d2e248b70c7c90eb6011a83054b201547c1f4ddb5576baaa5ee0989` |
| combined digest | `8708420cb7ad2aed…`, recomputed by `npm run check:vendoring` |

The vector *files* are byte-identical to those at tag `v0.6.0`
(`0ae18b00ee4bd71ab2dc28bae706b0f9d195076b`); `main` differs only in
`conformance/manifest.json`, where the retired `converterResults` field was
removed, and in `conformance/README.md`. Every file carries its SHA-256 in
`conformance/provenance.json`; `.gitattributes` keeps line endings untouched, and
`conformance/**` is never edited here — vectors are generated and reviewed
upstream by `scripts/make_conformance.py`.

## Result on this build

```text
suite: <this repository>/conformance
manifest vectors: 291; selected: 291

format      total  pass  fail  not-run
fasta          98    98     0        0
fhgff3         38    38     0        0
fhp-fasta      36    36     0        0
gfa            56    56     0        0
jsonld         37     0     0       37
microdata      26     0     0       26
TOTAL         291   228     0       63
```

**228 of 228** runnable vectors pass, 0 fail. The split by expectation:

| format | valid | invalid | runnable |
| --- | --- | --- | --- |
| fasta | 35 | 63 | 98 |
| gfa | 20 | 36 | 56 |
| fhp-fasta | 14 | 22 | 36 |
| fhgff3 | 18 | 20 | 38 |
| jsonld | 17 | 20 | 0 — not implemented |
| microdata | 15 | 11 | 0 — not implemented |

For a valid vector the run asserts all of: the file is accepted, the recomputed
checksum equals the manifest digest, each metadata value the manifest names parses
to the stated value and type, and a warning is present where the manifest lists
one under `warnings` (the two R14 vectors). For an invalid vector it asserts the
file is rejected, and for the four V4 vectors it additionally requires the reader
to report `unsupported-version` rather than check the record against another
schema. Each valid vector is also put through `strip`, which must remove the header
lines and nothing else.

## Rules the runnable vectors exercise

`R1` byte-exact lines and transport (LF, CRLF, lone CR, mixed, no final newline,
gzip, BGZF, multi-member gzip split inside the checksum line),
`R2` exactly one root-level checksum line (quoted key, missing, doubled, nested
only), `R3` coverage (metadata, sequence, comment and terminator tampering),
`R4` SHA-512/256 and canonical base64 (truncated SHA-512, SHA-256, a set unused
bit), `R5` the checksum line's grammar (tab, block scalars, continuations, trailing
comment, explicit tag, a comment holding a raw `>`), `R6` UTF-8 and YAML line-break
characters, `R7` byte order mark, `R8` duplicate keys, anchors, aliases, merge keys,
`R10` header placement and concatenation, `R11` `\x3E`/`\x40` escaping and the
raw-marker warning, `R12` YAML 1.1/1.2 portability (leading zero, `_`, sexagesimal,
boolean words, explicit tag) including in extension values, `R13` NaN and Infinity,
`R14` the accepted-scheme warning, `R15` extension fields (key shapes, nested
refusal, older-version and older-release gates, duplicate extension key),
`P1`/`P2` FHP metadata and FHP-vs-FHR selection, `G1`/`G2`/`G3` the GFF3 version
line and block end, the genome link, and FHGFF3-vs-FHR selection, and
`V1`–`V6` schema selection including the FHR 1 compatibility path and
`unsupported-version`.

`V7` has no vector by design: rule V7 changes no default outcome and publishes no
draft contract in the shared suite. This library does not implement the lane, so
there is nothing here to skip.

## Vectors not run, and why

**63 vectors, all of them one of two formats.** They are reported as skipped with
the reason, by both `npm run conformance` and `npm test`; none is counted as a pass.

- **`microdata`, 26 vectors** (`microdata-*`): the HTML microdata binding of
  `docs/MICRODATA.md` (rules M1-M5) is a separate reader path. It needs HTML
  parsing with the microdata item/token-list/first-wins/implicit-end-tag rules, and
  it has no checksum coverage rule at all — a microdata vector pins a whole
  extracted metadata object. Nothing in this build reads HTML.
- **`jsonld`, 37 vectors** (`jsonld-*`): the canonical JSON-LD form of
  `docs/JSONLD.md` (rules J1-J9). J1-J2 and J6-J9 would be reachable with a JSON
  reader plus context handling, but **J3, J4 and J5 are explicitly JSON-LD
  *processor* vectors** (framing/compacting against a context other than the FHR
  context alone, `@nest`, `@import`, remapped and remote contexts), which needs a
  JSON-LD implementation this library does not have. Rather than pass 34 of 37 and
  quietly drop three, the whole format is reported not run.

Also unexercised by the suite, so untested by anything here rather than merely
"not failed":

- the reader's byte/node/depth limits beyond what the vectors' headers reach;
- 64 MiB metadata-file handling and streaming or partial reads (there is no
  streaming reader);
- writers of every kind: no combine, no YAML/JSON/JSON-LD/microdata output, so J7,
  J8 and M5-class writer obligations are not exercised here at all;
- integers beyond `Number.MAX_SAFE_INTEGER`, which the suite never uses;
- the v0.3.0 copy of `fhr.json`, which no vector cites (v0.3.1 is the FHR 1 release
  V6 names) — it is bundled so V2/V3 can answer a v0.3.0 citation as a known
  release rather than as `unsupported-version`.

## Cross-checks beyond the vectors

The suite is a pass/fail contract, not a differential, so three extra comparisons
run against the released Python toolkit (`fair-bioheaders` 0.11.0 from PyPI):

```text
npm run capability:toolkit
  validity compared on 217 vectors; strip compared on 77 valid vectors
  no disagreements with the toolkit

npm run capability:digest
  valid sequence vectors recomputed: 87; mismatches: 0
  R1/R3/R4 tamper vectors recomputed: 21; stated==computed: 0

npm run capability:yaml -- --sweep
  80709 scalars compared against fair-bioheaders 0.11.0, 0 disagreements
```

The first compares this library's verdict with the toolkit's on every uncompressed
sequence vector and compares stripped bytes exactly. The second recomputes the
digests the manifest states. The third compares the YAML stage — R8, R12, R13 — on
a 90-scalar named corpus plus a deterministic 80k combination sweep, which is where
the divergence between `js-yaml`'s YAML 1.1 tag table and PyYAML's resolver was
found and fixed (see [`CAPABILITY.md`](CAPABILITY.md)).

## What this result does not mean

- It is not a claim that the website's browser tools, or `gff3-validator`'s Pyodide
  build, validate anything in JavaScript: they run CPython under Pyodide, and
  [fair-bioheaders.github.io#23](https://github.com/FAIR-bioHeaders/fair-bioheaders.github.io/issues/23)
  rules on how that may be described. This library is separate and native, and its
  results are its own.
- It is not GFF3 feature validation. The FHGFF3 vectors cover the header and the
  container rules; feature lines, SO terms and biology belong to
  `gff3-validator`.
- It is not FHT or FHGM support, at any version. Neither has a released contract,
  and this build ships no draft, no `schemaVersion`, no w3id URL and no V7 lane for
  either.
- It is not a release. Nothing here is published, tagged or merged by this work, and
  `version` in `package.json` is `0.0.0` to say so.
