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
- 64 MiB metadata-file handling and streaming or partial reads (there is no
  streaming reader);
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

## Draft-lane evidence, labelled draft and kept out of the counts above

FHT and FHGM have no vector in the shared suite and none is vendored here: rule V7
keeps a record that cites a draft in the development repository that owns it. What
can be done - and is, by `node scripts/capability/draft-vectors.mjs`, also run in CI
against the pinned commits - is to read those repositories' own development suites
through the lane and report them separately.

| draft suite | contract pinned at | suite scored | vectors | pass | fail | not run, and why |
| --- | --- | --- | --- | --- | --- | --- |
| FHT (`FHT-Specification/conformance`) | `226f923c28b680edb3c546e99a751482d06aef1a`, sha256 `59ad9641adcb0e55…` | `24d3b033ab951ef79ee9f6d17419d8ba700f1b0a`, manifest sha256 `9b07179497bdc724…`, verified before the run | 66 | 66 | 0 | none |
| FHGM (`FHGM-Specification/development/conformance`) | `ac3d37b3033312844fc3151217731928ae33aa54`, sha256 `bf1553cac04dc88d…` | **no suite pin stated**, so the run is labelled `UNPINNED`: the revision it scored is the checkout it was given, not a checked claim | 31 | 31 | 0 | none: the five K4-dependent vectors resolve against the file's own feature rows - a vector whose layer is absent or untrustworthy stays not-run with that state as the reason |

**FHT is 66, and that is the only FHT count this repository reports.** Two revisions are
involved and they are not the same claim:

- The **contract** pin, `226f923c`, is the revision whose `fht.json` bytes this build
  compiles. `scripts/ci/draft-pins.mjs --check` confirms them.
- The **suite** pin, `24d3b033` (`suiteCommit` in `drafts/provenance.json`), is the
  revision whose manifest the draft-lane evidence is a claim about: 56250 bytes,
  sha256 `9b07179497bdc7247d6ead2404d9d5fdee48308a58b385bd4cd9a7e91450053a`, **66
  vectors**, labelled `C1`/`C2`/`C3`. The extra vector against the older count is
  `fht-fasta-parent-mixed-verdicts`.

At the contract revision the same repository holds a **65**-vector manifest (54216 bytes,
sha256 `d9025104675e69b59ea80f07535762e4eeb07195e40e8dddab7f68e85f697695`) whose three
contract rules still carry the provisional `T1`/`T2`/`T3` ids that
`FHT-Specification#36`/#38 later retired in favour of `C1`/`C2`/`C3`. That manifest is not
a count this build produces any more; the paragraph exists to say why the two revisions
differ, not to offer a second number. The rule *semantics* are the same across the rename,
and the ids this repository quotes describe the suite revision, never the contract
revision. Before this section was rewritten, CI cloned the contract revision and printed
its vector count under a header that cited the contract pin, while the registry's
`suiteVectors: 66` and `suiteRules: ["C1","C2","C3"]` described the later revision and
were read by no code at all. The runner now verifies the manifest digest first and refuses
anything else, so a checkout at `226f923c` is `DRIFT` to `scripts/ci/suite-pin.mjs`, and
`draft-vectors.mjs` exits 2 against it rather than scoring it.

Each row is a *draft* result: it says the lane reads the pinned bytes and reports what the
pinned contract and the drafted rules say. It is not a released-contract result, it is not
added to the 228 above, and it is not support for either type. The FHT row covers C1
contract validation, C2 schema-URL closure, C3 parent-link verdicts (checked-pass,
checked-fail and unchecked all reached), the R1-R15 header rules and the two V5 cases the
suite includes; the FHGM row covers B1, K1, K2, K3, K5 and K6, with the predecessor
verdicts exercised against the prior snapshots the suite names.

Three checkers, three different questions, one owner each:

| question | owner | outcome if it fails |
| --- | --- | --- |
| are the contract bytes in this checkout the bytes the pin names? | `node scripts/ci/draft-pins.mjs --check <checkout>…` | the labelled draft job goes red |
| is the development suite about to be executed the suite the pin names? | `node scripts/ci/suite-pin.mjs --check <checkout>…`, and the same check inside `scripts/capability/draft-vectors.mjs` before it scores anything | the labelled draft job goes red, and nothing is scored |
| does the owning repository's live default branch still publish those bytes? | `node scripts/ci/draft-pin-freshness.mjs`, proposed in #6 and not on `main` until that merges | advisory only, by design: a draft legitimately moves, and drift is detected, not repaired |

`node scripts/ci/draft-pins.mjs --check <FHT checkout> <FHGM checkout>` is what
proves the bytes being read are the bytes the pin names; the CI job runs it against
checkouts of the pinned commits, and it was verified locally to report `DRIFT` on a
stale checkout and `MATCH` on the pinned one.

That check answers "is this checkout the commit we pinned". It cannot answer the
other question, which is whether the pin is still what the owning repository
publishes today, and a draft legitimately moves: `node
scripts/ci/draft-pin-freshness.mjs` asks it, digesting each target's live default-branch
bytes - the two contracts, the FHGM transport overlay, and the FHT development-suite
manifest this build quotes - against the SHA-256 in `drafts/provenance.json`, and
reporting `MATCH` or `DRIFT`. It is advisory and it repairs nothing: live drift is
**detected, not repaired**, there is no automatic re-pinning here, and the job runs with
`continue-on-error`, so a moved draft can never turn the released-contract result red.
Re-pinning stays the deliberate act it was: bytes, commit, digest and the prose that
quotes them change in one commit. Before judging anything the script digests its own
`drafts/` copies against the registry and fetches a path no repository publishes from
each owning repository, and if either step does not come out right it reports the run as
inconclusive rather than naming a winner - a check that cannot fail cannot pass.
Redirects are not followed, for the same reason: a digest taken after a redirect
describes wherever the redirect landed, not the URL this build cites.

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
  and this build states no `schemaVersion`, no w3id URL and no registry row for
  either. The rule-V7 lane recognises their pinned bytes behind an explicit caller
  decision and warns on every record it reads that way; recognition is what V7
  calls it, and the draft-lane counts above are never merged into this one.
- It is not a release. Nothing here is published, tagged or merged by this work, and
  `version` in `package.json` is `0.0.0` to say so.
