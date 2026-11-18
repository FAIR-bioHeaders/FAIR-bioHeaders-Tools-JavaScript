# Agent instructions

## Independent review and merge authorization (2026-11-18)

The maintainer's independent-review rule (2026-11-18) applies only to
FAIR-bioHeaders repositories and agents operated by David Molik (`molikd`) or
Adam Wright (`adamjohnwright`). A PR submitted by either maintainer or their
agents may satisfy the approval gate through an independent **different model**:
Copilot, or a model operated by David or Adam. The approving model/agent must be
other than the submitter; an agent must not self-approve its PR, and another
instance of the same model does not satisfy the different-model requirement.
Record author/reviewer model provenance when needed to establish independence.
David and Adam themselves may self-approve their PRs; this exception does not
apply to their agents.

An eligible agent may merge only after that approval requirement is met, all
applicable CI checks are green, and its own validation of the current changes
passes, including changes after review. Recheck the exact head, base branch,
findings and dependencies immediately before merging. Missing checks are not
passing checks, and branch protection must not be bypassed. Read every overall
review and inline finding, reply with its disposition and fix/evidence, resolve
handled threads, and post an overall response. Merge authorization does not grant
contract adoption, curator acceptance, release, publication or deployment
authority; those retain their separate maintainer gates.

Authority: [approval by another, different model](https://github.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification/issues/268#issuecomment-6984337685)
and [human self-approval exception](https://github.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification/issues/268#issuecomment-6984418624).

Port source: FAIR-bioHeaders-Specification commit
`0d0d6b43efdee96bc7548f1f7c65fdafb2a31f32` ([specification PR #269](https://github.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification/pull/269)).

## Provenance of this file, and what it does not claim

This file is **not** a byte-identical member of the shared `AGENTS.md` family. The
byte-identity requirement for the six specification repositories was retired by
maintainer decision on 2026-11-14 in favour of keeping the shared sections *in
step*, and this repository is a consumer library rather than a specification
repository, so it was never one of the six holders. Its shared sections below are
adapted from `FAIR-bioHeaders-Specification/AGENTS.md` at `origin/main`
`a60bc02ad94c364e4bff30d43561c60663d72beb` (2026-11-14), with the local wording
needed for a JavaScript consumer, and from `FAIR-bioHeaders-Tools/AGENTS.md` for
the toolkit-side operational rules. Relative links in the source have been made
absolute where they do not resolve from this tree. No CI here gates text identity
against any other repository, and none should be added: cross-holder comparisons
are advisory reports, not checks.

## Repository identity and ownership

Determine the repository from its Git remote before applying this file. This is
**FAIR-bioHeaders-Tools-JavaScript**: one of the four per-language library
repositories (with `FAIR-bioHeaders-Tools-R`, `-Java` and `-Julia`) created
2026-11-14 under the same rules and documentation surface as the family.

| Repository | Role for this project |
| --- | --- |
| FAIR-bioHeaders-Specification | publication authority: the released contracts, the version registry, the format rules and the shared conformance vectors |
| FAIR-bioHeaders-Tools | the Python toolkit and the family's reference implementation; not a dependency of this package |
| this repository | a native JavaScript reader/validator/stripper for the released contracts, consumable on its own, plus the explicit rule-V7 lane for the two drafts |

David and Adam jointly hold schema and release authority
([GOVERNANCE.md](https://github.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification/blob/main/GOVERNANCE.md));
the optional steering group described there is not active. The
[2024 FHR paper](https://doi.org/10.1093/bib/bbae122) motivates small required
metadata, provenance close to data and interoperability. Preserve supplied metadata
and sequence bytes; do not invent identifiers, authors, source material, software,
SeqCol digests or scientific relationships.

## What this library is, and the boundary that must not blur

It is a new, independently consumable JavaScript library. It is **not** the browser
tooling on `fair-bioheaders.github.io`, and it is **not** `gff3-validator`'s Pyodide
build. The family has already ruled
([fair-bioheaders.github.io#23](https://github.com/FAIR-bioHeaders/fair-bioheaders.github.io/issues/23))
that the website's FH\* validation must not be claimed as validation performed by
JavaScript, because that page runs CPython under Pyodide. Keep that boundary
explicit in README, `llms.txt`, docs and code comments, in both directions:

- every check here is native JavaScript on `node:crypto`, `node:zlib` and `ajv`;
  nothing shells out to Python or loads WebAssembly;
- the existing web tools are not prior art for this library and are not cited as
  evidence that it works;
- a result from this library is never described as the website's result;
- GFF3 feature, SO-term and biology validation belong to `gff3-validator`. This
  library validates no feature. The FHGM draft lane alone reads two columns below
  the header - each feature row's `type` and `ID` - because FHGM K4 resolves a
  record `featureId` against them: by default the lane indexes the file's own
  bytes (`src/features.js`), a caller may inject its own resolver through
  `options.features`, and a missing or untrustworthy layer leaves K4
  `not-checked`/`unchecked`, never a pass and never a rejection.

## Drafts take no release form (rule V7)

FHT and FHGM are drafts. They have no released contract, no row in
`schemas/versions.json`, no `schemaVersion`, no w3id URL and no support claim —
here or in any documentation, skill or packaging metadata in this repository.
A scheduled future release (FHT as `v0.7.0`, FHGM as `v0.8.0`) is a decision about
*those* types, not a licence to publish them here.

This library implements the V7 lane, because V7 is a published rule about reader
behaviour and the maintainer direction of 2026-11-14
([FAIR-bioHeaders-Specification#211](https://github.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification/issues/211)
round 10, this repository's #2 and #3) asks each language library to recognise the
drafts the way the reference toolkit does. Earlier guidance here said "do not
implement the V7 opt-in lane"; that was this repository's own scope decision at
PR #1, and it is superseded deliberately, not silently — everything below is the
change. What implementing the lane means, and what it must never mean:

- **opt-in only.** The lane opens on an explicit caller decision:
  `inspectBytes(bytes, { container, drafts: ['FHT'] })`, or `{ drafts: true }` for
  every pinned draft. It is never the default, there is no environment switch, and
  `schemas/provenance.json` stays a registry of released contracts only.
- **digest-pinned.** The draft bytes are vendored under `drafts/` with their own
  `drafts/provenance.json` recording the owning repository, the commit and the
  SHA-256. `src/drafts.js` re-verifies the digest before reading and reports drift
  instead of quietly reading something newer; `npm run check:drafts` and
  `node scripts/ci/draft-pins.mjs --check <checkout>` are what notice it. Two
  revisions are pinned per draft and both are on the API: `commit`/`sha256` for the
  contract bytes, and `suiteCommit`/`suiteManifest`/`suiteManifestSha256` for the
  development suite `scripts/capability/draft-vectors.mjs` executes. A pin no code
  reads is documentation, not a control, which is why the suite half is exposed
  through `draftSuitePin()` and enforced by
  `node scripts/ci/suite-pin.mjs --check <checkout>` - the runner refuses to score a
  suite whose manifest does not digest to the recorded value.
- **loud.** Every record read through the lane carries the V7 warning naming the
  citation, the commit and the digest, and saying the result is not a
  released-contract result. A V7 reading reports `release: null` and
  `schemaVersion: null`.
- **no release form, ever.** A w3id URL or a release-tag URL for a type the registry
  does not list is still "any other value" under V5, with the lane open or shut. Do
  not add FHT or FHGM to `schemas/provenance.json`, do not mint them a
  `schemaVersion`, a tag URL or an alias, and never write that either type is
  supported.
- **default behaviour unchanged.** `test/goldens/default-gate.json` is a per-vector
  digest of the lane-off reading of all 291 shared vectors, captured from the
  pre-lane tree; `test/default-gate.test.mjs` fails on any difference. Regenerating
  that golden *is* a change to default behaviour: it needs its own reviewed
  reason, never a drive-by rewrite.
- **FHGM is not a header type.** Its records carry no `schema`, ride inside an
  FHGFF3 header under the R15 key `x-fhgm-models`, and the file is routed by its
  released FHGFF3 citation under V1 to V3. The FHGM verdict is a separate block and
  must never be blended into, or allowed to alter, the released FHGFF3 result.
- **no draft vectors vendored here.** A record that cites a draft stays in the
  development repository that owns it (V7). The draft suites are run as separate,
  labelled evidence — `node scripts/capability/draft-vectors.mjs --fht <checkout>
  --fhgm <checkout>` — and their counts are never added to the shared 291.

`scripts/check-docs.mjs` enforces the release-form half: a w3id or release-tag URL
for a draft, a registry row, a stated draft `schemaVersion`, a support claim, or a
document that names the lane without naming its pin and its opt-in condition fails
the build. Do not relax that guard to land a change; if a documented fact reads as
a release form, the fact is the bug.

## Schema additions and their own development cycle

A new optional field, structured alternative, enum value, constraint, required
field or changed meaning is a schema-contract change, even when motivated by a UI,
exporter, parser fix or documentation task. Identify it explicitly as a **schema
addition** in its issue and PR. Supporting an already adopted field in this
consumer is implementation work, not a new field.

Schema additions have their own proposal, review, compatibility, versioning and
release cycle in FAIR-bioHeaders-Specification. Keep them separately reviewable
from routine fixes, packaging and dependency updates; link dependent implementation
PRs rather than silently adopting a field downstream. Never edit a vendored file in
`schemas/`, `conformance/` or `examples/` to make a test pass: those are copies of
another repository's published bytes.

## Versions and selection

Use the shared specification's [`docs/SCHEMA-VERSIONS.md`](https://github.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification/blob/main/docs/SCHEMA-VERSIONS.md)
and [`schemas/versions.json`](https://github.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification/blob/main/schemas/versions.json):
contract versions are per type, distinct from repository release tags and from
biological resource versions. Do not assign a new version merely for implementing
an existing contract, and do not give this package a version because the contracts
moved: `package.json` stays `0.0.0` until a maintainer releases it.

Selection is by the record's own `schema` value, per V1-V6, against the vendored
copies. Never substitute current `main` for an unknown release; report
`unsupported-version` instead (V4). Do not fetch schemas at run time.

V7 sits beside V1, not inside it: it is a caller decision (`{drafts: [...]}`), it
recognises only the pinned raw-main citation of the repository that owns the draft,
and it widens nothing else — see the section above. `src/types.js` is the single
declaration of which of the five types is released and which is a draft, which
serialization each belongs to, and what each operation can do; `docs/MATRIX.md` is
rendered from it by `scripts/make-matrix.mjs`, so the published capability matrix
cannot drift from the code. Adding a type at publication is a row there plus a
provenance row — not a rewrite.

## Dialect and digest are constraints, not preferences

- The contracts declare `"$schema": "https://json-schema.org/draft/2020-12/schema"`.
  Keep validation on ajv's 2020-12 build with `format` **asserted** (`date`, `uri`):
  in 2020-12 `format` is an annotation, so a default validator silently accepts
  `dateCreated: "2022-13-45"`. A draft-07 validator is not a candidate without
  proof — the released bytes refuse it, and `contains`/`minContains` in
  `fhgff3.json` is 2019-09-and-later. `docs/CAPABILITY.md` records the exact
  configuration and the two strict-mode relaxations the released bytes require.
- The checksum is SHA-512/256 (`node:crypto`'s `sha512-256`), over the exact bytes
  except the root checksum line and its terminator, as canonical padded base64,
  compared as a string. Never "optimise" it to a SHA-512 truncation or SHA-256, and
  never write or edit a checksum by hand.
- R12 compares two YAML dialects, so the tables in `src/scalars.js` are the check.
  `js-yaml`'s own YAML 1.1 tag table is not equivalent to PyYAML's resolver; the
  divergences found and how they were verified are recorded in `docs/CAPABILITY.md`.

## Verification

From this checkout:

```sh
npm ci --ignore-scripts
npm test                    # unit tests + the shared vectors, one test per vector
npm run test:ci            # the same suite, accounted: zero tests, a missing vector or
                            # an unexplained skip fails, even when nothing failed
npm run conformance         # per-format pass/fail/not-run table over the shared 291
npm run check:vendoring     # vendored bytes AND pinned drafts vs their provenance
npm run check:drafts        # just the draft pins, against their recorded digests
npm run check:docs          # docs/llms.txt vs the registry and the manifest, and the draft guard
npm run check:matrix        # docs/MATRIX.md is what src/types.js renders; edit the code, not the doc
npm run matrix              # regenerate docs/MATRIX.md after changing the registry
npm run check:license       # LICENSE and package.json agree; body matches canonical MPL-2.0
```

Optional, and skipped with exit 3 (never silently passed) when the reference is
absent:

```sh
FHR_PYTHON=…/bin/python npm run capability:yaml        # R12/R13 vs the toolkit
FHR_TOOLKIT_BIN=…/bin npm run capability:toolkit       # validity and strip bytes vs the CLI
node scripts/ci/draft-pins.mjs --check <FHT checkout> <FHGM checkout>   # draft pins vs live bytes
npm run capability:draft -- --fht <FHT checkout> --fhgm <FHGM checkout> # the two draft suites, through the lane
node scripts/ci/draft-pin-freshness.mjs   # advisory: pinned digests vs the owning repositories' live default branch
```

The last one is a network read of two public repositories and nothing else; it gates
nothing, repairs nothing, and exits 2 rather than naming a winner when its own probe
control did not answer. CI runs it as an advisory job, separate from acceptance.

`npm run capability:ajv` and `npm run capability:digest` run inside the primary CI job:
they are native JavaScript and need no reference. The two Python differentials run only
in the labelled supplemental job; they are evidence, never the oracle, and no test here
depends on them.

The draft-lane run is *labelled draft evidence*, not acceptance: it reads the
development suites that live in the repositories owning FHT and FHGM, verifies each
stated suite manifest against its own pin before scoring anything, and its counts are
never added to the shared 291. The measured counts are FHT **82 pass / 0 fail / 0
not-run**, from the suite pin `86438f21`, and FHGM **58 pass / 4 fail / 0 not-run**,
from `06176262` - the four failures being expectations FHGM-Specification#29 added to
`layers.model` that this build has not implemented yet, each named in
`docs/CONFORMANCE.md` rather than smoothed over. The re-pin of 2026-11-18 **moved both
contract byte sets** (`59ad9641`→`4156353a` for FHT, `bf1553ca`→`b7075e58` for FHGM) -
a suite moving does not usually move a contract, but this one could not be scored
without it, and a re-pin that changes contract bytes is exactly the louder change the
previous wording anticipated. See
`docs/CONFORMANCE.md` for both, and for the FHT vectors whose *expectations* upstream
still marks unreviewed. FHGM's K4 runs
against the reading's feature layer (the file's own rows by default); when a layer
is absent or untrustworthy the vector stays not-run with that state as the reason -
converting a not-run into a pass by assumption is forbidden, not merely discouraged.
The same holds for `layers.gff3`, the feature-layer verdict this library does not
compute at all: an expectation of `reject` there is left not-run, never granted.
A pin is a digest and a commit first and a count second: measure the bytes from a real
download (contents API at a `ref`, hash the file on disk), re-read the count out of
those same bytes, and let `scripts/ci/suite-pin.mjs` refuse any manifest where the two
disagree.

The issue #8 ruling was reaffirmed on 2026-11-16: a requested draft without a
complete suite pin is refused before any suite is scored. The API still describes
absent provenance honestly; no tooling may treat that absence as permission to
print an unpinned count. Keep synthetic layer tests reachable by pinning their
own manifest bytes, rather than bypassing this guard.

Record the checks actually run, with counts, and say plainly what was not run:
`microdata` (26 vectors) and `jsonld` (37) are not implemented here and must stay
reported as not-run rather than being dropped from the table. A reported hole is a deliverable; a hole
filled with a claim is a defect. For `AGENTS.md`-only changes,
inspect the diff, links and repository identity and run `git diff --check`;
executable suites are unnecessary unless behaviour changed.

Publishing is not part of these changes: npm publication, tags, registry release
rows and deployments retain separate maintainer gates. Project status updates and
conditionally authorized merges follow the scoped workflow below.

## Licensing

MPL-2.0, stated in **both** places and agreeing: the `LICENSE` file and
`license` in `package.json` (`MPL-2.0`, a valid SPDX id). New FAIR BioHeaders
contributions from March 2025 onward are MPL-2.0; historical USDA-ARS material
stays public domain within the United States; third-party material keeps its own
licenses and notices; previously distributed versions keep the permissions under
which they were distributed; and a file's most recent modification date does not
settle the status of its parts. `LICENSE` here carries that split and records what
this repository does and does not contain — do not replace it with generic
boilerplate, and do not adopt a blanket public-domain dedication. The sibling
repository `FAIR-bioHeaders-Tools-R` shipped `License: GPL-3` with no `LICENSE`
file in its first scaffold; check both places in every change to packaging
metadata. David Molik left USDA in February 2025; do not classify all contributors
as government employees.

Dependency licences are recorded as verified from the installed packages, not from
memory (`ajv` MIT, `ajv-formats` MIT, `js-yaml` MIT as of 2026-11-14). If a
candidate dependency genuinely conflicts with MPL-2.0, raise it as a maintainer
decision instead of resolving it silently.

## Issues, project and code review

- Add every issue you work on to the connected project (project #9, "FAIR
  BioHeaders — 2026 refresh") and keep `Status` current; set `Outcome` when it
  closes. This repository's work belongs to
  [FAIR-bioHeaders-Specification#52](https://github.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification/issues/52);
  do not re-scope that issue from here.
- Link every PR to its issue. Use `Closes #N` only for complete acceptance; for
  partial work use `Refs #N` and `#N remains open`. Never put a closing keyword
  before an issue reference inside a negated sentence: GitHub can still recognize
  it. Do not do unreported work.
- Explicit project boundaries override generic routing: specification #206/#228
  and Tools #150 belong only to Project 12; specification #248/#249, Tools
  #169/#170 and Janeway plugin #1–#5 belong only to Project 13; Adam-owned Tools
  #171 is outside Project 9. Do not re-add these under the rule above.
- After each work run, post a status comment: what changed, which checks ran with
  their results and counts, commit/PR links, blockers, next action. Do not rely on
  chat history, and date every status claim.
- On review: read the whole review and every inline comment first; fix each finding
  in a **new commit**; do not amend or force-push over reviewed commits; reply with
  the commit hash; resolve the thread; then summarise dispositions. Treat optional
  suggestions as required unless genuinely out of scope, and say why with a
  scoped follow-up link. Give an overall response even when no findings exist.
- Never push directly to `main`. Conditional merges follow the independent
  review authorization above; adoption and publication keep separate gates.

## Local scope of this repository

Only this tree. Concretely:

- the public surface is ESM JavaScript on Node 20+, with no build step and no
  generated files; there is no bundler, no TypeScript emit and no browser entry;
- `src/` is the library, `scripts/run-conformance.mjs` is the acceptance runner,
  `scripts/check-test-report.mjs` is the accounting guard, `scripts/make-matrix.mjs`
  renders `docs/MATRIX.md`, `scripts/capability/` holds the dependency study, the
  toolkit differentials and the draft-lane runner, `scripts/ci/` holds the workflow
  glue;
- `testutil/` holds the test fixture builders. It is deliberately outside `test/`:
  `node --test` treats every file under `test/` as a test file, so a helper there
  would run as a zero-test file and pollute the accounting;
- `schemas/`, `conformance/` and `examples/` are vendored, read-only copies with
  their own `provenance.json`; refresh means re-copying from a pinned upstream
  revision and updating that provenance in the same commit, and
  `npm run check:vendoring` is what notices drift;
- `drafts/` holds the rule-V7 draft contracts: pinned bytes with their own
  `provenance.json`, digested like everything else, never a released copy and
  never listed in `schemas/provenance.json`;
- implementation scope today is read + validate + checksum-verify + strip, in one
  bounded pass over the input (`src/scan.js`), with streaming input
  (`inspectStream`, `inspectFileAsync`) and streaming strip output (`stripFileTo`).
  A writer (`combine`), a CLI, JSON-LD/microdata readers, gzip output, published
  type declarations and browser support are all explicitly *not* implemented — see `docs/CONFORMANCE.md` for the consequences
  rather than an empty promise;
- shared cross-repository policy can be discussed anywhere, but contract changes
  start in FAIR-bioHeaders-Specification, type-specific design in the owning
  development repository, and toolkit coordination in FAIR-bioHeaders-Tools.
