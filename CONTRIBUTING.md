# Contributing

Start with an issue describing the use case or the failure and a small reproducible
example — for a reader, that example is usually a file. Open a focused branch and
PR with the behaviour, the compatibility implication and the checks you ran. Link
the relevant work in
[FAIR-bioHeaders-Specification](https://github.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification)
when a change spans repositories, and `Refs`
[FAIR-bioHeaders-Specification#52](https://github.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification/issues/52)
(the umbrella issue for the per-language libraries). Do not put private genome data,
credentials or unrelated formatting into fixtures.

David and Adam are the maintainers and jointly hold schema and release authority
([GOVERNANCE](https://github.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification/blob/main/GOVERNANCE.md));
the steering-group option described there is not active. Sensitive findings use
[SECURITY.md](SECURITY.md), not an issue.

## Setup and checks

```sh
npm ci --ignore-scripts     # exact pins; no lifecycle scripts run
npm test                    # unit tests + one case per shared conformance vector
npm run test:ci             # the same suite, accounted: zero tests / missing vector / unexplained skip fails
npm run conformance         # per-format table over all 291 vectors
npm run check:vendoring     # vendored copies AND pinned drafts vs their recorded SHA-256
npm run check:drafts        # just the draft pins
npm run check:matrix        # docs/MATRIX.md still matches src/types.js
npm run check:docs          # docs/llms.txt vs the registry, the counts, and the draft guard
npm run check:license       # LICENSE and package.json agree
```

`npm run test:ci` is what the primary CI job runs, and it is stricter than
`npm test`: it fails on an empty run, on a manifest vector with no test, and on any
skip outside the declared not-run set. If you add a format, add it to
`src/serializations.js` with its reason - that one declaration is read by the
runner, the test suite, the guard and the matrix, which is the point.

Two checks (`capability:ajv`, `capability:digest`) need nothing but the installed
dependencies and run in the primary CI job. The draft-lane runner needs checkouts of
the two development suites and reports nothing at all without them (exit 3). Next to
it, `node scripts/ci/draft-pin-freshness.mjs` needs neither a checkout nor a
dependency: it digests each pinned target's live default-branch bytes and prints
`MATCH` or `DRIFT`, as an advisory CI job with `continue-on-error`. Live drift is
detected there, never repaired - see "Changing the draft lane".

Four more checks compare this reader against the released Python toolkit. They are
**not** part of `npm test` — they need a Python with `fair-bioheaders` installed —
and each exits 3 with a message rather than reporting a pass when the reference is
missing:

```sh
FHR_PYTHON=/path/to/.venvs/converter-0.12.0/bin/python npm run capability:yaml -- --sweep
FHR_TOOLKIT_BIN=/path/to/.venvs/converter-0.12.0/bin  npm run capability:toolkit
npm run capability:ajv      # needs nothing but the installed dependencies
npm run capability:digest   # needs nothing but the installed dependencies
```

Run the toolkit comparisons before merging anything that touches `src/lines.js`,
`src/checksum.js`, `src/scalars.js`, `src/yaml.js`, `src/selection.js` or
`src/validate.js`, and paste the output into the PR. They are how the R12 tables in
this library were found to be wrong twice, and how a fix to them is proved rather
than asserted.

## Changing the draft lane

The lane is the part of this library most able to create a false claim by accident,
so the rules are narrow and each is checked:

- `schemas/provenance.json` lists released contracts only; the drafts live in
  `drafts/provenance.json` with `releaseTag`, `w3id` and `registryRow` set to `null`
  - `scripts/check-vendoring.mjs` fails if one acquires a release shape;
- re-pinning a draft means changing the bytes, the commit and the digest in the same
  commit as the prose that quotes them, because `scripts/check-docs.mjs` refuses a
  document that names a lane without naming the pin it reads;
- **the digest is the pin; the count is a note about it.** Move the SHA-256 and the commit
  from bytes you actually downloaded, then re-read the vector count out of those same
  bytes. Never the reverse: a re-pin driven by a count is how a build comes to name a
  suite it never checked, and `scripts/ci/suite-pin.mjs` refuses a manifest whose digest
  matches while its `vectors` array disagrees with `suiteVectors`.
- measure with the contents API at a `ref`, not with the branch-named CDN and not with a
  `HEAD` content-length. `GET /repos/<owner>/<repo>/contents/<path>?ref=main` answers with
  the git blob sha and the body; decode the body to a file, hash the bytes on disk, and
  compare the recomputed blob sha with the one the API states - that is what proves the
  download is whole. `raw.githubusercontent.com/main/…` was observed on 2026-11-16 serving
  pre-merge bytes for minutes after a merge, and a content-length is an assertion about a
  response, not a measurement of a file;
- a suite pin may legitimately name a different commit from its contract, and stating one
  is not the same as stating the other. Where the two are equal the registry repeats the
  value so the check is uniform; where a commit moved only one of them, that is what the
  `suiteCommitNote` says, with the blob shas that prove it;
- the suite is a **second** pin, and it is enforced rather than merely recorded.
  `suiteCommit`, `suiteManifest` and `suiteManifestSha256` are exposed by `draftEntry()`
  and `draftSuitePin()`; `node scripts/ci/suite-pin.mjs --check <checkout>` verifies a
  checkout against them; and `scripts/capability/draft-vectors.mjs` runs that check before
  it scores anything and exits 2 when the manifest does not digest to the recorded value.
  It also digests this build's own `drafts/` copies before it opens a single vector and
  exits 2 with `NOTHING SCORED`: the per-reading refusal is caught inside the vector loop,
  so without that first check a tampered contract still produced a count - `FHGM: 4 pass,
  39 fail`, observed on 2026-11-16 - and four rows right for the wrong reason read as
  evidence.
  A draft that states no suite pin is reported `UNPINNED`, never `verified` - after the
  re-pin of 2026-11-16 no draft in this registry is in that state, so the branch is now a
  guard for a future draft rather than a description of a present one. `UNPINNED` is a
  label `scripts/capability/draft-vectors.mjs` prints for an absence in this build's own
  registry, which is the only way a stale literal in a test could reach it: the test in
  `test/draft-suite-pin.test.mjs` therefore copies the tree to a temporary directory,
  deletes the suite fields from the copy's `drafts/provenance.json`, and runs the copy's
  runner - and a test that filtered the live registry for an unpinned draft would run zero
  iterations and pass by saying nothing. The reported counts are FHT **72**
  from the suite pin `be9bcc825f55db92…` and FHGM **43** from `c503ecf38deaba28…`; the
  superseded pins they replaced (`24d3b033ab951ef7…`, 66 vectors, and the 31-vector FHGM
  suite this build previously scored with no pin stated at all) and the 65-vector
  pre-rename manifest at the contract revision are all `DRIFT` to the guard and are not
  scored. The three owners of "is the pin checked" are listed in
  `docs/CONFORMANCE.md`; keep it that way, because two half-owners is how the FHT count
  came to be reported against a revision nothing had verified;
- live drift is **detected, not repaired**. `node scripts/ci/draft-pin-freshness.mjs`
  compares each pinned digest with the owning repository's live default-branch bytes and
  prints `MATCH` or `DRIFT`, and CI runs it as an advisory, `continue-on-error` job
  because a draft is allowed to move. Nothing re-pins automatically, the job writes no
  commit and pushes nothing, and a drift there is a signal for the deliberate re-pin
  above - never a change to what the lane reads, and never a red acceptance run;
- a default (lane-off) reading must not change. `test/goldens/default-gate.json` is
  a per-vector digest of all 291 shared vectors captured through the public API from
  the pre-lane tree; `test/default-gate.test.mjs` recomputes and compares. Do not
  regenerate the golden to make a test pass - if it moved, the change is a
  default-behaviour change and needs saying so out loud;
- an FHGM verdict never alters the FHGFF3 result, and a K4 or a predecessor verdict
  is never implied: K4 resolves a `featureId` only against a feature layer the
  reading actually got - the file's own rows by default, or one the caller injects -
  and reports `not-checked` with none or `unchecked` with an untrustworthy layer,
  while an unsupplied predecessor link is `unresolvable` or `unchecked`,
  never `verified`;
- the primary CI job stays native. `test/workflow.test.mjs` reads the workflow and
  fails if a foreign runtime appears in it, if an acceptance command disappears from
  it, if a step is allowed to fail softly, or if a job that installs Python stops
  calling itself supplemental.

## What belongs here, and what belongs somewhere else

| Change | Where it goes |
| --- | --- |
| a new metadata field, enum value, constraint or changed meaning | FAIR-bioHeaders-Specification, as a labelled schema addition with its own cycle — never adopted downstream first |
| a rule you believe the shared vectors state incorrectly | FAIR-bioHeaders-Specification, with the vector id; this library follows the suite, it does not arbitrate it |
| FHT or FHGM contract design | their own repositories (FHT-Specification, FHGM-Specification) and FAIR-bioHeaders-Specification#204 for FHGM: this library changes no draft's bytes and takes no position on their content |
| a draft becoming "supported" | not here at all: the V7 lane recognises pinned bytes behind an explicit caller decision, and support arrives only with publication (`v0.7.0`, `v0.8.0`) and a registry row written by the specification repository |
| vendoring draft records or draft vectors | no: rule V7 keeps a record that cites a draft in the development repository that owns it. The development suites are read from a checkout the caller points at (`scripts/capability/draft-vectors.mjs`), never copied in |
| GFF3 feature, SO-term or biology validation | `gff3-validator` |
| writing a header, computing a new checksum, JSON-LD/schema.org/microdata output | the Python toolkit (`fair-bioheaders`); if a JavaScript writer is needed, open an issue here first |
| this library's own reader, checker and stripper, its docs, skills and CI | here |

A change that would need a new vector is two changes: the vectors come from
`scripts/make_conformance.py` in the specification repository and are regenerated
and reviewed there, then vendored here by re-copying from a pinned revision. Adding a
hand-written case to `conformance/` is not how this repository grows.

## Vendored copies

`schemas/`, `conformance/` and `examples/` are byte-for-byte copies of files from
FAIR-bioHeaders-Specification, each with a `provenance.json` naming the repository,
release or commit, source path and SHA-256. The rules:

- never edit a vendored file; if it looks wrong, the copy is wrong or upstream is,
  and both are fixed outside this tree;
- a refresh is a re-copy from a stated revision plus the rewritten provenance in the
  same commit, so `npm run check:vendoring` passes on the result and the diff shows
  exactly which contract bytes moved;
- `.gitattributes` keeps these paths free of line-ending conversion — several
  vectors are CR or CRLF cases on purpose;
- `conformance/**` carries no generated-at timestamps, so a re-copy is reviewable as
  content, not as churn.

## Code style

Plain ESM JavaScript with JSDoc types, no build step and no transpilation: what is
committed is what runs. Node built-ins are imported with the `node:` prefix. Every
rejection names the rule it enforces (`FORMAT.md` R1-R15, `FHP.md` P1-P2,
`FHGFF3.md` G1-G3, `SCHEMA-VERSIONS.md` V1-V6) in its message, because that string is
what a caller reports and what the vector table compares against — a message that
loses its rule id is a behavioural change.

Comments explain a rule or a measured constraint, never a line of code. Where a
decision came from a capability finding (the ajv strict-mode relaxations, the two
YAML dialect tables, the `$id` collision between release copies), the comment points
at [`docs/CAPABILITY.md`](docs/CAPABILITY.md) rather than restating it.

Keep required metadata and runtime dependencies small, and prefer an interoperable
increment to a speculative framework — the same reading of the context paper the
toolkit uses. New runtime dependencies need a licence check against MPL-2.0 stated in
the PR; if a genuine conflict exists, it is a maintainer decision, not something to
resolve by quietly dropping the file.

## Documentation and citation

Behaviour changes move docs with them: README's API and limits tables, `llms.txt`
(which is the machine-readable summary, and duplicates the version facts — keep them
in step), the relevant `docs/` page, and `skills/fair-bioheaders-javascript/SKILL.md`
if the workflow an agent follows changed. State versions as read from
`schemas/versions.json` at a release, never from memory, and never let an implemented
subset read as full-family support.

Release preparation authorises nothing: no npm publication, no tag, no merge, no
DOI. Keep companion PRs linked where a change spans repositories.

## Licence of contributions

New FAIR BioHeaders project contributions from March 2025 onward are MPL-2.0,
subject to [LICENSE](LICENSE) and its provenance split. Historical USDA-ARS material
stays public domain within the United States, third-party material keeps its own
licences and notices, previously distributed versions keep the permissions they were
distributed under, and a file's most recent modification date does not determine the
status of its parts. Do not label all contributors as government employees, and do not
import historical or third-party material without carrying its notice.
