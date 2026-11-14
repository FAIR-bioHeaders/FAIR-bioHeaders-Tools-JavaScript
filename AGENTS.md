# Agent instructions

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
| this repository | a native JavaScript reader/validator/stripper for the released contracts, consumable on its own |

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
  library reads the FHGFF3 header and nothing below it.

## Drafts take no release form (rule V7)

FHT and FHGM are drafts. They have no released contract, no row in
`schemas/versions.json`, no `schemaVersion`, no w3id URL and no support claim —
here or in any documentation, skill or packaging metadata in this repository. Do
not add them to `schemas/provenance.json`, do not implement the V7 opt-in lane, and
do not describe a draft URL as "supported": under V5 such a value is read as FHR,
which is the default behaviour rule V7 requires when the lane is off. Scheduled
future releases (FHT as `v0.7.0`, FHGM as `v0.8.0`) are decisions about *those*
types, not licenses to pre-implement them here.

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
npm run conformance         # per-format pass/fail/not-run table
npm run check:vendoring     # vendored bytes vs their recorded provenance
npm run check:docs          # docs/llms.txt vs the registry and the manifest, and the draft guard
npm run check:license       # LICENSE and package.json agree; body matches canonical MPL-2.0
```

Optional, and skipped with exit 3 (never silently passed) when the reference is
absent:

```sh
FHR_PYTHON=…/bin/python npm run capability:yaml        # R12/R13 vs the toolkit
FHR_TOOLKIT_BIN=…/bin npm run capability:toolkit       # validity and strip bytes vs the CLI
npm run capability:ajv                                 # 2020-12 constructs and the version gates
npm run capability:digest                              # digests against every valid vector
```

Record the checks actually run, with counts, and say plainly what was not run:
`microdata` and `jsonld` vectors are not implemented here and must stay reported as
not-run rather than being dropped from the table. For `AGENTS.md`-only changes,
inspect the diff, links and repository identity and run `git diff --check`;
executable suites are unnecessary unless behaviour changed.

Publishing is not part of any change here: no npm publication, no tags, no merges,
no registry row, no board edits. Those are maintainer actions.

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
- Link every PR to its issue (`Refs #N`). Do not do unreported work.
- After each work run, post a status comment: what changed, which checks ran with
  their results and counts, commit/PR links, blockers, next action. Do not rely on
  chat history, and date every status claim.
- On review: read the whole review and every inline comment first; fix each finding
  in a **new commit**; do not amend or force-push over reviewed commits; reply with
  the commit hash; resolve the thread; then summarise dispositions. Treat optional
  suggestions as required unless genuinely out of scope, and say why.
- Do not push to `main` or merge a PR without maintainer approval.

## Local scope of this repository

Only this tree. Concretely:

- the public surface is ESM JavaScript on Node 20+, with no build step and no
  generated files; there is no bundler, no TypeScript emit and no browser entry;
- `src/` is the library, `scripts/run-conformance.mjs` is the acceptance runner,
  `scripts/capability/` holds the dependency study and the toolkit differentials;
- `schemas/`, `conformance/` and `examples/` are vendored, read-only copies with
  their own `provenance.json`; refresh means re-copying from a pinned upstream
  revision and updating that provenance in the same commit, and
  `npm run check:vendoring` is what notices drift;
- implementation scope today is read + validate + checksum-verify + strip. A
  writer (`combine`), a CLI, JSON-LD/microdata readers, streaming input, Node
  `Readable`/`Writable` helpers, published type declarations and browser support are
  all explicitly *not* implemented — see `docs/CONFORMANCE.md` for the consequences
  rather than an empty promise;
- shared cross-repository policy can be discussed anywhere, but contract changes
  start in FAIR-bioHeaders-Specification, type-specific design in the owning
  development repository, and toolkit coordination in FAIR-bioHeaders-Tools.
