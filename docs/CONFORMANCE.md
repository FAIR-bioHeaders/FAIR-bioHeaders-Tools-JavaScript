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
| FHT (`FHT-Specification/conformance`) | `226f923c28b680edb3c546e99a751482d06aef1a`, sha256 `59ad9641adcb0e55…` | `be9bcc825f55db92852fd882ffba4c1c214f53db`, manifest sha256 `9fd8c0b2a4638d5d…`, verified before the run | 72 | 72 | 0 | none scored by assumption. Four of the 72 carry `promotion: candidate-unreviewed` upstream, so four *expectations* await a second reader; the runner prints that tally itself |
| FHGM (`FHGM-Specification/development/conformance`) | `ac3d37b3033312844fc3151217731928ae33aa54`, sha256 `bf1553cac04dc88d…` | `c503ecf38deaba289e8384124ee5e2b8e81b86f1`, manifest sha256 `0d2790151c4a2955…`, verified before the run — the first revision this build can name for FHGM, whose row used to read `UNPINNED` | 43 | 43 | 0 | none scored by assumption. The twelve `dmel-*` vectors promoted from the real-data fixtures are labelled `Status: DRAFT` upstream: their expectations await independent review |

**FHT is 72 and FHGM is 43, and those are the only draft counts this repository
reports.** Two revisions are involved per draft and they are not the same claim:

- The **contract** pin is the revision whose contract bytes this build compiles.
  Neither moved in the re-pin of 2026-11-16: `fht.json` at `226f923c` and the FHGM
  record contract at `ac3d37b3` both still digest to what the registry says, and
  `scripts/ci/draft-pins.mjs --check` confirms them in a checkout.
- The **suite** pin (`suiteCommit` in `drafts/provenance.json`) is the revision whose
  manifest the draft-lane evidence is a claim about. FHT's moved from `24d3b033`
  (56250 bytes, sha256 `9b07179497bdc724…`, 66 vectors) to `be9bcc82` (65615 bytes,
  sha256 `9fd8c0b2a4638d5d…`, 72 vectors); the diff is six added vectors and none
  removed. FHGM's is stated for the first time: `c503ecf3`, 51114 bytes, sha256
  `0d2790151c4a2955…`, 43 vectors, twelve more than the 31 this repository had run
  and reported unpinned.

Both suites still carry the same rule labels — FHT `C1`/`C2`/`C3`, FHGM `B1` and
`K1`-`K6` — and a count is only ever quoted with the revision it was scored at. The
FHT contract revision `226f923c` still holds the older **65**-vector manifest (54216 bytes,
sha256 `d9025104675e69b59ea80f07535762e4eeb07195e40e8dddab7f68e85f697695`) whose three
contract rules carry the provisional `T1`/`T2`/`T3` ids that
`FHT-Specification#36`/#38 later retired in favour of `C1`/`C2`/`C3`. That manifest is not
a count this build produces any more; the paragraph exists to say why the two revisions
differ, not to offer a second number. The rule *semantics* are the same across the rename,
and the ids this repository quotes describe the suite revision, never the contract
revision. Before that section was written, CI cloned the contract revision and printed
its vector count under a header that cited the contract pin, while the registry's
`suiteVectors` and `suiteRules` described a later revision and were read by no code at
all. The runner now verifies the manifest digest first and refuses
anything else, so a checkout at `226f923c` is `DRIFT` to `scripts/ci/suite-pin.mjs`, and
`draft-vectors.mjs` exits 2 against it rather than scoring it - which is what it did
against `be9bcc82` for the minutes before this re-pin landed.

### What the draft counts did, and did not, prove on 2026-11-16

The re-pin moved the lane from 97 draft vectors to 115, and the split is reported the
way it came out:

- FHT **66 → 72, all 72 scored**, 0 fail, 0 not-run. The six new vectors are two gzip
  stream cases (`fht-fasta-gzip-multimember`, `fht-fasta-gzip-sequence-tampered`) and
  four parent-link cases built from the *Drosophila* pilot
  (`fht-fasta-parent-subset-citing-whole`, `fht-fasta-parent-masked-exact`,
  `fht-fasta-parent-real-digest-wrong-file`, `fht-fasta-parent-case-folded-digest`).
  All four of the latter carry `promotion: candidate-unreviewed` in the manifest: the
  owning repository has not finished reviewing the *expectation*, so a pass here is
  agreement with a draft claim, not corroboration of it. The runner prints that tally on
  the line under its own count rather than leaving a 72/72 to read as 72 reviewed facts.
- FHGM **31 → 43, all 43 scored**, 0 fail, 0 not-run. The twelve additions are the
  `dmel-*` vectors promoted by FHGM-Specification#18, and three of them cite K4
  (`dmel-snapshot-v1`, `dmel-target-absent`, `dmel-target-transcript-row`); with the
  eight K4-citing vectors already in the suite, K4 is now reached on 8 vectors where
  earlier builds reached it on 5 and left the rest not-run. Each of the eight produced a
  `pass` or `reject` verdict against the enclosing file's own feature rows, which is the
  only way a K4 vector can be scored here: the runner refuses to score one whose K4 comes
  back `not-checked` or `unchecked`, so a 43/43 is 43 verdicts, not 43 assumptions.
- One guard came with the growth. Every vector in the pinned FHGM suite states
  `layers.gff3: accept`, and this library evaluates no feature layer: a pass on such a
  vector says nothing about that layer. Had a vector stated `layers.gff3: reject`, the
  old runner would have *granted* it - a rejection this build cannot see - so the runner
  now leaves any vector whose `layers.gff3` expectation is not `accept` not-run, naming
  gff3-validator as the owner of that judgement. Nothing at `0d279015…` exercises the
  refusal yet; `test/draft-suite-pin.test.mjs` exercises it against a synthetic suite.

Neither number is added to the 228 below, and neither is a released-contract result.

Each row is a *draft* result: it says the lane reads the pinned bytes and reports what the
pinned contract and the drafted rules say. It is not a released-contract result, it is not
added to the 228 above, and it is not support for either type. The FHT row covers C1
contract validation (24 vectors cite it), C2 schema-URL closure (3), C3 parent-link
verdicts (10; checked-pass, checked-fail and unchecked all reached), the R1-R15 header
rules and the suite's three V1 and two V5 selection cases; the FHGM row covers B1 and
K1-K6, with K4 reached on 8 vectors and the predecessor verdicts exercised against the
prior snapshots the suite names. Label counts are read out of the pinned manifest, not
carried over from the last revision.

Four checks, four different questions, one owner each:

| question | owner | outcome if it fails |
| --- | --- | --- |
| are the vendored draft bytes in *this build* the bytes its own registry says they are? | `npm run check:drafts`, and the same `verifyDraftBytes()` call inside `scripts/capability/draft-vectors.mjs` before it opens a single vector | the acceptance job goes red, and the draft-lane run exits 2 printing `NOTHING SCORED` - no vector count is produced from bytes the registry rejects |
| are the contract bytes in this checkout the bytes the pin names? | `node scripts/ci/draft-pins.mjs --check <checkout>…` | the labelled draft job goes red |
| is the development suite about to be executed the suite the pin names? | `node scripts/ci/suite-pin.mjs --check <checkout>…`, and the same check inside `scripts/capability/draft-vectors.mjs` before it scores anything | the labelled draft job goes red, and nothing is scored |
| does the owning repository's live default branch still publish those bytes? | `node scripts/ci/draft-pin-freshness.mjs`, advisory by design and separate from acceptance | nothing goes red: it reports `DRIFT` and leaves the re-pin to a human |

`node scripts/ci/draft-pins.mjs --check <FHT checkout> <FHGM checkout>` is what
proves the bytes being read are the bytes the pin names; the CI job runs it against
checkouts of the pinned commits, and it was verified locally to report `DRIFT` on a
stale checkout and `MATCH` on the pinned one.

That check answers "is this checkout the commit we pinned". It cannot answer the
other question, which is whether the pin is still what the owning repository
publishes today, and a draft legitimately moves: `node
scripts/ci/draft-pin-freshness.mjs` asks it, digesting each target's live default-branch
bytes - the two contracts, both development-suite manifests this build quotes, and the
FHGM transport overlay - against the SHA-256 in `drafts/provenance.json`, and
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
posture. The released 291-vector ledger and all recorded pins are unchanged.
