# Round 15 runtime policy update

See [ROUND15-READINESS.md](ROUND15-READINESS.md) for the explicit D9/D10 runtime
change, preserved historical291 ledger, separate canonical counterparts and
64-case policy receipt. Older measured counts below remain dated evidence.

# Conformance: what the shared vectors say about this build

Acceptance is FAIR-bioHeaders-Specification's own conformance suite — 291 vectors,
reader-neutral by design, each a real file plus the outcome a conforming
implementation must produce. This repository adds no second suite and defines no
JavaScript-specific expectations; it vendors the shared bytes and runs them.

```sh
npm run conformance        # per-format table over all 291 vectors
npm test                   # unit tests + one test per vector (63 reported skipped)
npm run test:ci            # the same suite, accounted (see "Accounting the suite")
npm run check:vendoring    # the vendored copies AND the pinned drafts match their provenance
```

## Where the vectors come from

| Field | Value |
| --- | --- |
| repository | [FAIR-bioHeaders-Specification](https://github.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification) |
| ref | tag `v0.6.0` |
| commit | `0ae18b00ee4bd71ab2dc28bae706b0f9d195076b` |
| path | `conformance/` |
| retrieved | 2026-11-18 |
| manifest SHA-256 | `cdbb79b1fbfda52b27a9f54b73d3bae1efb662efcbb4c41ba02b9e3be40a51e1` |
| combined digest | `346615a0541fcad6…`, recomputed by `npm run check:vendoring` |

Every file is byte-identical to `conformance/` at tag `v0.6.0`. The first copy
(2026-11-14) came from `main` at `a60bc02` and matched no tag: its
`manifest.json` lacked the `converterResults` field of two vectors and its
`README.md` had been reworded. It was re-vendored from the tag on 2026-11-18;
no vector file changed. The tests read the vector count from
`conformance/provenance.json` instead of restating it. Every file carries its SHA-256 in
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
draft contract in the shared suite ("This suite publishes no draft contract, so no
vector is valid or invalid under V7"). This build does implement the lane, so the
shared suite still holds nothing for it - and the lane is therefore accounted for in
two other places: `test/default-gate.test.mjs` proves the lane-off behaviour is
byte-identical to the pre-lane library, and the lane-on behaviour is proved against
the pinned FHT contract, the pinned FHGM record contract and the two development
suites (next section).

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
- 64 MiB metadata-file handling (no metadata file is read). Streaming is tested
  here rather than by the suite: `test/streaming.test.mjs` reads every runnable
  vector in 1-, 2-, 3-, 7- and 4096-byte chunks and requires the in-memory
  reading, and reads a sparse file over 2 GiB;
- writers of every kind: no combine, no YAML/JSON/JSON-LD/microdata output, so J7,
  J8 and M5-class writer obligations are not exercised here at all;
- integers beyond `Number.MAX_SAFE_INTEGER`, which the suite never uses;
- the v0.3.0 copy of `fhr.json`, which no vector cites (v0.3.1 is the FHR 1 release
  V6 names) — it is bundled so V2/V3 can answer a v0.3.0 citation as a known
  release rather than as `unsupported-version`;
- FHGM K4 (feature-target resolution) when a reading has no feature layer, or one
  whose rows cannot be trusted: the default lane indexes the enclosing file's own
  rows for their `ID` and `type`, and without usable rows the verdict is
  `not-checked` or `unchecked` - a declared gap, never a pass and never a
  rejection;
- parent-link recomputation for the released types: no released rule makes a
  recomputed mismatch a rejection, so `verifyParentLinks` runs only inside the FHT
  lane, against parent bytes the caller hands over.

## Draft-lane evidence — measured 2026-11-20

These consumer development lanes require explicit V7 opt-in and stay out of the
shared 291-vector ledger. Family publication does not adopt a released selection
in this library. Native FHGM differs from the historical `x-fhgm-models` extension.

| Artifact | Last-touch commit | SHA-256 | Downloaded bytes | Vectors / result |
| --- | --- | --- | --- | --- |
| FHT contract | `eb6c36d37771918a754d12719a29cad1876fb73c` | `b62c4e227042e162b43d2c461cfe6c3ece3806636ca88a4cf9b0b2f902fb1fc3` | 35,293 | C1/C2/C3 development lane |
| FHT suite | `e6ba1c737c9caddc53b99a4a107825d7a16a4765` | `d0147d3ad97c0fad0ede94ae76340632a86a160f566b01129e592e643fd77492` | 89,146 | 93 pass / 0 fail / 0 not-run |
| FHGM record | `06176262f9824f26d974a15d8feeebde1fbeb0a8` | `b7075e5872e0a5ffce5ae61c590ce182f1f219fa269413cad3b1a966753cfeae` | 11,522 | unchanged bytes |
| FHGM overlay | `019bc29e32ce225791053dd2ce323bb91f304ce1` | `533b3120f4a86590f1b60a2175487597c99b646b3d092b7818b1f682c6cecf9b` | 3,191 | unchanged bytes; own last-touch revision |
| FHGM suite | `e8e26d7cb9024b83e474045291f56a46e57a1ecf` | `d42b621165951dc0eb94ec80ff1953aae72c62d668e7a88c5b48541e41d26a64` | 113,389 | 90 pass / 0 fail / 2 not-run of 92 |

Total: **183 pass / 0 fail / 2 not-run**. The two named FHGM abstentions are:

- `feature-inventory-complete-empty`: K4 is not checked without a usable feature layer.
- `feature-target-bare-parent`: `layers.gff3: reject` belongs to gff3-validator.

FHT C1 now checks all five supplied integer BUSCO counts using exact integer
summation, including integral floating point inputs. This reader rejects counts
outside `Number.isSafeInteger` (absolute value above 2^53−1): YAML/JSON Number
parsing cannot preserve their source precision. This is a consumer limitation,
not a new owning-contract range constraint. Schema validation owns partial,
boolean, fractional and out-of-range counts. C2 URL closure and C3 exact parent-file
identity retain their existing boundaries. The four former FHT promotion candidates
carry upstream D3 `accepted-file-identity-only` reviews; those establish no biological
derivation. FHGM B1/K1–K6 checks retain their existing implementation and K4 abstention
boundary; this refresh adds no GFF3 syntax, ontology or biology validator.

The user requested CI repair after freshness reported three moved artifacts: FHT
contract, FHT suite and FHGM suite. Contents API base64 bytes were checked against
Git blobs, downloaded lengths and SHA-256. The FHT contract changed from 34,396 to
35,293 bytes; FHT suite from 82 to 93 vectors; FHGM suite from 62 to 92. The unchanged
FHGM overlay now records its own last-touch commit instead of the common historical
snapshot. Previous measurements remain in provenance history. Historical November
18/19 scores of FHT82/FHGM62 describe the superseded pins, not this build.

Every requested suite requires a complete pin. Missing, partial or mismatching
provenance refuses scoring; absent suite paths fail. The checked-in default-gate
golden, released schemas and shared 291 payloads are unchanged. Runtime performs no
upstream fetch, and freshness errors/404 controls remain failures rather than passes.

## Accounting the suite

`npm run test:ci` (`scripts/check-test-report.mjs`) runs Node's own test runner with
the TAP reporter and then refuses to call the run a success unless the suite is
still the whole suite. It fails on:

- zero leaf tests, or a discovered test file that contains none - an empty harness
  reports success without the guard;
- a vector of the pinned manifest with no test, or with two;
- a skip for anything other than the declared not-run formats, with a reason that is
  not the declared one, or a declared not-run format that ran anyway - so a hole
  cannot be filled by silence in either direction;
- any failing test.

Two demonstrations that the guard bites, both local and both reverted: silencing one
runnable vector (`{ skip: ... }` on `gfa-lf`) left `node --test` reporting
`pass 369, fail 0` while the guard exited 1 with
`gfa-lf (gfa): skipped with "silenced on purpose", and it is not a declared not-run
format`; pointing it at a file with no tests exited 1 with
`the runner reported 1 file(s) and no leaf test at all`. The cross-repository
demonstration - a deliberate bad vector expectation making the CI job red - is
recorded with the PR, because that one only counts on CI.

The guard also checks the workflow itself (`test/workflow.test.mjs`): the primary
`native` job must install and invoke no foreign runtime, must run every acceptance
command, must contain no step allowed to fail softly, and any job that does install
Python must say `supplemental` in its name. Adding a `setup-python` step to the
primary job fails the test suite locally before CI ever runs it.

## Cross-checks beyond the vectors

The suite is a pass/fail contract, not a differential, so three extra comparisons
run against the released Python toolkit (`fair-bioheaders` 0.12.0 from PyPI, the
version CI's `reference` job installs; last run 2026-11-18):

```text
npm run capability:toolkit
  validity compared on 217 vectors; strip compared on 77 valid vectors
  no disagreements with the toolkit

npm run capability:digest
  valid sequence vectors recomputed: 87; mismatches: 0
  R1/R3/R4 tamper vectors recomputed: 21; stated==computed: 0

npm run capability:yaml -- --sweep
  80709 scalars compared against fair-bioheaders 0.12.0, 0 disagreements
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
  and this build states no `schemaVersion`, no w3id URL and no registry row for
  either. The rule-V7 lane recognises their pinned bytes behind an explicit caller
  decision and warns on every record it reads that way; recognition is what V7
  calls it, and the draft-lane counts above are never merged into this one.
- It is not a release. Nothing here is published, tagged or merged by this work, and
  `version` in `package.json` is `0.0.0` to say so.

## Missing suite provenance (#8)

The maintainer reaffirmed option 1 on 2026-11-16: every requested draft suite must
state a complete pin before any suite is scored. A missing or partial pin exits 2
with `NOTHING SCORED`, no per-type counts and no total. The separate suite-check
CLI also fails on an absent pin, including when invoked through a symlink. A run
with no existing requested suite path exits 3 instead of reporting success.
Historical `UNPINNED` measurements above describe earlier behavior, not the current
posture. The released 291-vector ledger is unchanged; development pins were deliberately refreshed on 2026-11-20 as recorded above.
