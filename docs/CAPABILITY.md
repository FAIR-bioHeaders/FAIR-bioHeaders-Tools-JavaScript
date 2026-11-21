# Capability study: JavaScript against the released family contracts

Executed on this host on 2026-11-14 before any implementation was chosen, and
re-runnable:

```sh
npm run capability:ajv        # draft/2020-12 dialect, the released contracts and the two pinned drafts
npm run capability:digest     # SHA-512/256, proved against the shared vectors
npm run capability:yaml       # R12/R13 read, differentially against the toolkit
npm run capability:toolkit    # validity and strip bytes, against the toolkit CLI
npm run capability:draft -- --fht <checkout> --fhgm <checkout>   # the two development suites, through the lane
```

Each script exits non-zero on a failed expectation and exits 3 with a message when
its external reference (a Python with the released toolkit) is absent — none of
them reports a pass it did not compute.

## (0) What the two drafts are, and what reading them does not mean

This consumer exposes FHT and the historical FHGM extension only in development
lanes, with no released selection in its registry and no released support claim. Rule V7 gives a reader one way
to recognise them - an explicit opt-in lane, reading bytes pinned by commit and
SHA-256, warning on every record - and this build implements that lane while
keeping every one of those negatives true. `docs/MATRIX.md` states the resulting
capability cell by cell; `docs/CONFORMANCE.md` holds the draft-suite counts, kept
apart from the shared 291.

Findings from executing the lane against the pinned bytes:

| Question | Finding |
| --- | --- |
| Do the draft contracts need a different validator configuration? | No. Both declare `"$schema": …/draft/2020-12/schema`, both compile under the same `strict: true, strictRequired: false, strictTypes: false, validateFormats: true, allowUnionTypes: true` configuration the released bytes force, and both keep their remote-free `$ref` graphs local (29 refs in `fht.json`, 15 in the FHGM record contract, all `#/…`). |
| Is `format` still asserted inside the lane? | Yes, and it is checked rather than assumed: a record with `dateCreated: "2022-13-45"` is refused by the pinned FHT contract with `/dateCreated: must match format "date" (format)`, and the same record with a valid date passes. |
| Does the draft contract really close the schema URL (C2)? | Yes, and since the 2026-11-18 re-pin more tightly than before: `properties.schema` is now a **const** admitting only the raw-main citation (`/schema: must be equal to constant (const)` refuses an arbitrary URL, a release-tag URL or a w3id URL alike), while the pinned raw-main citation passes. Under the previous bytes it was a pattern that still admitted the tag and w3id forms. |
| Where is the lane stricter than the draft contract? | It no longer has to be, and the row changed with the bytes. Until 2026-11-16 this build vendored an `fht.json` whose *pattern* admitted a release-tag citation of its own repository and a w3id-shaped URL - neither of which exists, because the registry publishes no FHT release - so the divergence lived here: V7 recognised the raw-main citation and nothing else, and those release-shaped values stayed "any other value" under V5, read as FHR with the lane open or shut. The re-pinned contract makes `properties.schema` a raw-main-only **const** (FHT-Specification#54), so the contract itself now rejects every release-shaped form; the suite pins that reading with `fht-fasta-schema-shared-raw-tag` and the w3id cases. The reader-side rule is unchanged and still independent: `test/draft-lane.test.mjs` asserts all six release-shaped URLs never select V7 whatever the contract says, because selection is the lane's own boundary, not the draft's. |
| Does the FHGM transport overlay admit a current FHGFF3 header? | It does now, and that is a change of fact rather than of reading: the overlay this build vendored until 2026-11-16 pinned the v0.5.0 citation and `schemaVersion` `"1.1"` outright, so a `v0.6.0`/`1.2` carrier failed the overlay while satisfying R15, and this row recorded that divergence for the `v0.8.0` cycle to settle. FHGM-Specification#17 settled it the other way round, on 2026-11-15, and FHGM-Specification#26 widened it again: the overlay this build pins since the 2026-11-18 re-pin (sha256 `533b3120f4a86590…`, 3191 B, superseding `d1619cced91b4ef5…`, 2613 B) admits **either** released base as a closed pairing - the v0.5.0 citation set with 1.1, or the v0.6.0 citation set with 1.2 **or 1.1**, because the v0.6.0 release accepts 1.1 records per the shared docs/SCHEMA-VERSIONS.md, and its URI set carries the raw tag URL under the FHR-Specification historical repository name as the same release identity - and refuses a citation and a stated version that contradict each other (a v0.5.0 citation stating 1.2), with no fallback between the branches. So `overlay: true` is now the same width as the R15 reading on both bases, and what it adds is the pairing check R15 cannot make, because R15 reads only the stated version. It stays opt-in for that reason: the default verdict remains the published rule, not another repository's draft. `test/fhgm.test.mjs` asserts all three admitted pairings, the remaining contradiction and the inadmissible 1.0; upstream's `v0.6.0-citation-stating-1.1` and `fhr-specification-alias-v0.6.0` vectors pin the same reading. Note the carrier here cites a **released** FHGFF3 identity - a tag or w3id URL of a published contract is admissible; rule V7 forbids release forms for the unreleased *draft*, not for the released carrier underneath it. |
| Does the FHGM record contract express everything the checker enforces? | Not entirely, and the same is true upstream: model-id uniqueness (K3), feature-target resolution (K4) and predecessor resolution (K6) are checker rules, not schema constraints. This build implements K3, K5 and K6 natively, and K4 against a feature layer: by default the lane indexes the enclosing file's own feature rows for two facts per row - `type` and `ID` (`src/features.js`) - and a caller holding the layer elsewhere injects `options.features` or the `geneIds` shorthand. With no layer K4 is `not-checked`, with an untrustworthy one `unchecked`, never a pass and never a rejection. SO terms, coordinates and biology still belong to gff3-validator: reading two columns resolves a pointer and judges no feature. |
| What does the lane refuse to do? | Read a draft whose bytes no longer match the recorded digest: `verifyDraftBytes()` and `loadDraft()` report the mismatch (`drafts/<file>: sha256 …, expected …; the draft moved and this build was not re-pinned`) instead of quietly choosing newer bytes. Verified locally by appending one byte to a copy of the overlay: `check:vendoring --drafts-only` exits 1, and exits 0 again once restored. And the draft-lane runner now checks those digests itself, once, before it reads a single vector: it refuses with exit 2 and prints `NOTHING SCORED`. That guard was added because the per-reading refusal, on its own, was caught inside the vector loop and turned into "this file is invalid" - a run that exited 1 having printed `FHGM: 4 pass, 39 fail` against a tampered contract, four of them right for the wrong reason. A count with rows that are correct for reasons the build cannot name is not evidence, so it is not printed. |
| Does any of this move the default? | No. `test/goldens/default-gate.json` holds a per-vector digest of all 291 shared vectors plus the three examples, captured from the pre-lane tree through the public API (`node scripts/golden-default-off.mjs print` → aggregate `cefb059e520e76fe49321e3015b525f68e883429f0bbf88cbed5beb0ae503baf`), and `test/default-gate.test.mjs` fails on any difference. The aggregate after the lane landed is the same digest, which is the byte-identity claim in one line. |
| Does anything notice when a pin stops describing the draft? | Two things, at two different scopes. `src/drafts.js` re-verifies every digest before a read, so a vendored file that no longer matches its own registry entry is refused (`docs/CONFORMANCE.md`, "Draft-lane evidence"). And `node scripts/ci/draft-pin-freshness.mjs` asks the question the first one cannot: does the owning repository's **live default branch** still hold the bytes this build names? It digests five targets now - `fht.json`, the FHT suite manifest, `fhgm-model.schema.json`, the FHGM suite manifest and the FHGM transport overlay - and prints `MATCH` or `DRIFT` for each. Run here on 2026-11-16 after the re-pin: `5 pinned target(s) compared: match 5`, exit 0, with both nonsense-path controls answering 404 as they must. The same script run from the pre-re-pin tree (`origin/main` at `d8552f6`) reported `4 pinned target(s) compared: match 2, drift 2` and exited 1 - the FHT suite manifest and the FHGM transport overlay had both moved upstream while this build still described the old bytes - and the fourth target that would have been the FHGM suite manifest did not exist, because that registry stated no FHGM suite pin to check. So the re-pin both repaired two drifts and added a fifth probe: there is now a live claim to compare for every pinned file. It is advisory and it repairs nothing: a draft is allowed to move, so CI runs it as a `continue-on-error` job that can never redden the released-contract result, and re-pinning stays a deliberate, reviewed commit. The run reports inconclusive (exit 2), with no verdict at all, if the control fails, if a request cannot be completed, if a URL redirects instead of serving, or if this build's own `drafts/` copies disagree with `drafts/provenance.json`. Note what "match" does not mean: it says the pin describes the owning repository's current default branch, and it says nothing about whether that branch is stable. Both drafts are actively moving - FHT-Specification#8's boxes 3, 4, 6 and 7 are open - so a second re-pin pass is expected, and a green freshness run today is not a promise about tomorrow. |

## Environment

| Component | Version |
| --- | --- |
| Node.js | v24.22.1 (`/opt/homebrew/opt/node@24/bin/node`), npm 11.19.1 |
| `ajv` | 8.20.0 (MIT) |
| `ajv-formats` | 3.0.1 (MIT) |
| `js-yaml` | 5.5.0 (MIT) |
| reference toolkit | `fair-bioheaders` 0.11.0 from PyPI (no `direct_url.json`: index-installed, not a checkout), Python 3.15.0 |
| contracts | FAIR-bioHeaders-Specification `v0.6.0` (`fhr.json` `694ab5af…`, `fhp.json` `92a0b3cb…`, `fhgff3.json` `1942be4c…`), `main` at `a60bc02` schema-identical to the tag |
| pinned drafts (V7 lane only) | Deliberately refreshed 2026-11-20; independent contract/suite last-touch commits, exact SHA-256, byte counts and measured 93-vector FHT / 92-vector FHGM evidence are recorded in [CONFORMANCE.md](CONFORMANCE.md) and `drafts/provenance.json`. FHT C1 exact arithmetic is an owning-reader predicate in addition to JSON Schema. Released schemas and default selection remain unchanged. |

All three dependency versions are exact pins in `package.json`, not ranges, so a
future `npm install` on a clean tree gets what was measured here.

## (i) The dialect is draft/2020-12, and `ajv` honours it

Confirmed from the released bytes rather than from this document: `fhr.json`,
`fhp.json` and `fhgff3.json` each declare
`"$schema": "https://json-schema.org/draft/2020-12/schema"`, at `v0.6.0` and back
to `v0.3.0` — every release this library bundles. So a draft-07 validator is not a
candidate without proof, and the plain `ajv` entry point is not that proof:

```text
NOTE  plain `ajv` (draft-07 entry point) on the released fhp.json:
      no schema with key or ref "https://json-schema.org/draft/2020-12/schema"
```

The 2020-12 entry point (`ajv/dist/2020`) compiles and evaluates all 17 bundled
copies and both pinned draft contracts. `npm run capability:ajv` reports
**55 pass, 0 fail**; each check that a
construct *fires* is paired with the same record at a version where it must pass,
so a validator that silently ignored a conditional would fail the script instead
of passing it:

- `$defs`/`$ref` and the legacy `definitions`/`$ref` (which is what `fhr.json`
  uses) are both dereferenced: patching the referenced definition invalidates the
  shared minimal example.
- `patternProperties` accepts `x-refget-commonName`, `x-a.b-c_1`; refuses `X-Note`,
  bare `x-`, `x-_note`, a key with a space, a non-ASCII letter and a key containing
  a line feed (`propertyNames` covers the last). Nested objects stay closed: an
  `x-` key inside `taxon` or a `derivedFrom` item is refused.
- the version gates fire: an `x-` key is refused in a record stating `'2.0'`
  (FHR) or `'1.0'` (FHP/FHGFF3) and accepted at `'2.1'`/`'1.1'`/`'1.2'` — the same
  bytes flip on `schemaVersion` alone. A dotted BUSCO dataset version is accepted
  at FHP/FHGFF3 `'1.2'` and refused at `'1.1'` and `'1.0'`, while the undotted form
  stays valid at every minor; malformed dotted forms are refused at `1.2` too.
- `contains` with `minContains` — a 2019-09-and-later keyword pair — is
  load-bearing for the FHGFF3 genome link (two `annotates` parents refused, one
  accepted, `annotates` on a non-FHR parent refused). Relabelling the same bytes as
  draft-07 for the probe changed the outcome for one of these cases, which is why
  the dialect is not a formality.
- `format` is an annotation in 2020-12: with `validateFormats: false`,
  `dateCreated: "2022-13-45"` and `relatedLink: ["not a URI"]` both pass. This
  library therefore asserts `date` through `ajv-formats` and `uri` through its
  own RFC 3986 grammar (`src/uri.js`), as `docs/SCHEMA-VERSIONS.md` requires, and
  confirms that R14's accepted schemes (`urn:`, `doi:`, `ftp://`) survive
  `format: uri` while `javascript:` stays schema-valid and only warns. The
  `ajv-formats` 3.0.1 `uri` check was replaced on 2026-11-18 because it refuses a
  URI whose hier-part is empty (`urn:`, `doi:`, `mailto:`, `x:`), which RFC 3986
  allows and the toolkit accepts (jsonschema's checker, through `rfc3987`'s `URI`
  rule). Measured against `rfc3987` 1.3.8 on 45,673 generated strings: no
  disagreement. The one difference kept on purpose: `rfc3987` anchors with
  Python's `$`, which also matches before a final line feed, so the toolkit
  accepts `"https://example.org/\n"`; this library does not.
- NaN and ±Infinity reaching the validator are refused, in ranged and un-ranged
  fields alike; the reader also refuses them before validation (R13), because
  `docs/FORMAT.md` says a range check is not the mechanism to rely on.

Configuration that the released bytes require, with the exact complaints they
provoke under `ajv` 8's default strict mode:

```text
NOTE  ajv 8 default strict mode on the released fhp.json: strict mode: required
      property "completeness" is not defined at
      "…/main/fhp.json#/allOf/1/if" (strictRequired)
```

and `strictTypes` objects to `then: {properties: {completeness: …}}` whose target
is a `$ref` without its own `type`:

```text
strict mode: missing type "object" for keyword "properties" at "#/allOf/1/then/properties/completeness" (strictTypes)   # fhp-1.2.json
strict mode: missing type "array" for keyword "contains" at "#/anyOf/1/properties/derivedFrom" (strictTypes)            # fhgff3-1.2.json
```

Both are compile-time style checks, not semantics, so `src/validate.js` relaxes
exactly those two keys and nothing else. Measured on `ajv` 8.20.0 against the
vendored `v0.6.0` bytes, with `ajv`'s `logger` captured so "it compiled" and "it
compiled and said nothing" are separate answers (2026-11-14):

| configuration | the released bytes |
| --- | --- |
| `strict: true` + `strictRequired: false` + `strictTypes: false` (**this library**) | FHR, FHP, FHGFF3 compile, 0 complaints |
| `strict: true`, relaxations not applied | FHP **throws** `required property "completeness" is not defined at "#/allOf/1/if" (strictRequired)`; FHGFF3 **throws** `required property "genomeReference" is not defined at "#/anyOf/0" (strictRequired)`; FHR compiles |
| `strictTypes: true` with `strictRequired` still relaxed | FHP and FHGFF3 **throw** the `strictTypes` complaints quoted above |
| `strict: false` | compiles, complaints not produced |
| `strict: 'log'`, relaxations kept | compiles, **0 complaints** — indistinguishable from this library on these bytes |
| `strict: 'log'`, relaxations not applied | compiles, 5 complaints logged for FHP and 11 for FHGFF3 — **not** thrown |

An earlier revision of this document said `strict: 'log'` "does not downgrade them —
they still throw". It does. `ajv` 8's `checkStrictMode` throws only when the mode is
the boolean `true`; for any other truthy mode it calls `logger.warn`. That row is
also the reason the configuration is a value rather than a call-site literal. Every
other drift you can inject into it is visible to a test — a draft-07 entry point,
`validateFormats: false`, or either relaxation removed all fail loudly — but
`strict: 'log'` alongside the two explicit relaxations changes nothing a vector can
observe: with it written into `AJV_CONFIG`, `node scripts/check-test-report.mjs`
reported `441 leaf tests, passed 378, failed 0` and exit 0 before this was
defended. So the configuration is exported and frozen and the study reads it from
the export:

```js
export const AJV_ENTRY = 'ajv/dist/2020';
export const AJV_CONFIG = Object.freeze({ strict: true, strictRequired: false,
  strictTypes: false, validateFormats: true, allowUnionTypes: true, allErrors: false });
export const AJV_FORMATS = Object.freeze(['date', 'uri']);
export function createCompiler(overrides = {}) { /* the only construction site */ }
```

`test/ajv-config.test.mjs` asserts the value key by key, asserts that an un-relaxed
strict violation is still *thrown* rather than logged (on a schema carrying an
unknown keyword, which is where `true` and `'log'` differ), and asserts that
`scripts/capability/ajv-dialect.mjs` imports the configuration instead of restating
it. Until now that script wrote the same literals out at four of its five 2020-12
construction sites (and a partial fifth for the strict-mode counterfactual), and none
of the five carried `allErrors`, so its results described a configuration the library
did not use. With the export in place the study prints the object it measured
(`configuration under study — src/validate.js AJV_CONFIG: {...}`) and its 55 checks
are unchanged in outcome. Verified: `strict: 'log'` written into `AJV_CONFIG` now
exits 1 with `AJV_CONFIG.strict must be the boolean true, not "log"` and
`AJV_CONFIG must make an un-relaxed strict violation an error, saw compiled in
silence (and 1 complaint(s) logged)`.

`allowUnionTypes` is needed because the contracts use `type` arrays (the legacy
software string-or-array field). Vendored copies share one `$id` — their raw-main URL
— so `ajv` refuses a second `addSchema`; each copy is compiled with `$id` removed and
keyed by type and release. The files on disk keep their released bytes, which is what
`npm run check:vendoring` verifies.

## (ii) SHA-512/256 is native, and byte-equal to the reference

`node:crypto` exposes the algorithm directly — `crypto.getHashes()` lists
`sha512-256` — so R4 needs no dependency and no hand-written compression
function:

```text
node v24.22.1
crypto.getHashes() lists sha512-256: true

/Users/molik/Code/FHR/FAIR-bioHeaders-Tools-JavaScript/conformance
  valid sequence vectors recomputed: 87; mismatches: 0
  R1/R3/R4 tamper vectors recomputed: 21; stated==computed (must be 0): 0
  fasta-lf.fhr.fasta, one file four readings:
    covered bytes            524
    node sha512-256 base64   Z1p/siczUlN/N+lDB5Kg6vFRrztGErgLw9H4MfVfZeU=
    stated on the checksum line Z1p/siczUlN/N+lDB5Kg6vFRrztGErgLw9H4MfVfZeU=
    sha512 truncated to 32 bytes by hand sZkFu4VcinT6cCs6KkkRTjO//nkqbrpY57wlpjgEuzY= (R4 says this is not it)
    sha256                   2f8hYDHpJbjJkv6GrY4cRm1YSIlEE4B6NTJIALx/rp8= (also not it)

all digests match
```

That is every valid FASTA/GFA/FHP/FHGFF3 vector (87) recomputed with Node's digest
and compared to the digest the shared manifest states, plus the 21 R1/R3/R4 tamper
vectors confirming that a mismatch is still *detected* rather than accidentally
reproduced.

Two further proofs against the released toolkit itself, not just against the
manifest the suite's generator wrote:

```text
validity compared on 217 vectors; strip compared on 77 valid vectors
no disagreements with the released toolkit
```

`npm run capability:toolkit` runs `fhr-fasta-validate`, `fhr-gfa-validate` and
`fhr-gff3-validate` from `fair-bioheaders` 0.11.0 over every uncompressed sequence
vector and compares accept/reject with `inspectBytes`, then runs the matching
`*-strip` command and compares the resulting bytes with `stripBytes` byte for byte.
Compressed vectors are excluded from that loop because the CLI reads them through
its own transport handling; the digest script covers them by decompressing and
comparing against the stated digest (which is what makes them pass at all).

One detail worth recording, because it is the difference between a pass and an
accidental pass: R2 excludes only the *root-level* checksum line. A first reading
of the rule that excluded any indented `checksum:` line — the classic misreading —
fails **32 of the 87** valid sequence vectors, because FHGFF3 and FHP headers carry
a nested `checksum` for each `derivedFrom` parent and `fasta-nested-checksum` puts
one inside a block scalar. Those are ordinary covered metadata. The root indentation
is therefore computed from the header block's content lines, as `docs/FORMAT.md`
words it, and only a line at exactly that indentation is a candidate.

## (iii) The YAML layer

`js-yaml` 5.5.0's default schema is YAML 1.2 core, which is what R12 asks for, and
its `parseEvents`/`constructFromEvents` pair gives the handles the FHR profile
needs: `{json: false}` makes duplicate keys an error (R8), `maxAliases: 0` refuses
aliases (R8), `maxDepth` bounds nesting (the 64-level reader limit), events expose
`anchorStart`/`tagStart` so anchors and explicit tags can be refused (R8, R12), and
`SCALAR_STYLE.PLAIN` plus `getScalarValue` say which scalars are plain and what
their text is.

R12 is the part no single library can answer: it compares two dialects.
`js-yaml`'s own YAML 1.1 tag definitions turned out **not** to be PyYAML's
resolver. Each row below is a case where borrowing `js-yaml`'s 1.1 table made this
reader disagree with the released toolkit, found by the differential, and what the
tables now do instead:

| scalar | borrowed 1.1 reading | toolkit | what `src/scalars.js` does |
| --- | --- | --- | --- |
| `010`, `00`, `01`, `017` | int, and the value comparison let `00`/`01` through | refused | YAML 1.1 resolves the octal channel (`010` → 8), and every leading-zero decimal integer is refused as well, because that is what the toolkit refuses |
| `._0` | 1.1 float (its fraction pattern admits a leading `_`) | read as a string | YAML 1.1's float patterns are transcribed from PyYAML's resolver, which requires a digit after the point |
| `+.5`, `-.5` | 1.1 float | refused | 1.1's float pattern needs digits before the point in that form, so it reads a string and disagrees with 1.2 |
| `=` | 1.1 str | refused | 1.1's `value` resolver tag is kept distinct, so the dialects disagree |
| `<<` in value position | 1.1 str | refused | 1.1's `merge` resolver tag is kept distinct; a plain `<<` in key position is refused as an R8 merge key first, and a quoted `'<<'` key is an ordinary string, as in the toolkit |
| `1.7976931348623157e309` (a value that overflows to infinity) | `js-yaml`'s core float tag refuses the overflow, so the borrowed pair disagreed in the mirror image of the toolkit's direction | refused | the outcome happened to agree by accident of one library's tables; `plainScalarOverflows` now refuses it explicitly under R13, which says a value that overflows to infinity is invalid, so the refusal no longer depends on which way a resolver happens to fall |

So both tables are written out there from the dialects themselves — YAML 1.2 core
from the specification's core-schema patterns, YAML 1.1 from the resolver PyYAML
registers (plus the `y`/`n` booleans the toolkit adds), with a timestamp read as
`str` because R12 keeps date-like plain scalars as strings — and integers are
resolved as `BigInt`, so the comparison is exact rather than double-precision.
`js-yaml` still does the actual parsing and value construction; the tables only
decide whether the two dialects agree. The sexagesimal forms were re-probed rather
than assumed: `1:30` is the integer 90 to YAML 1.1 and a string to 1.2 (refused),
`1:05:30.5` is YAML 1.1's sexagesimal float and a string to 1.2 (refused), while
`0:1` and `1:60` match neither dialect's pattern and stay ordinary strings
(accepted) — which is what the toolkit does in each case.

The verification is a reader-level differential against the installed toolkit:
`load_yaml("k: " + text)` plus `check_finite` versus `loadHeaderYaml`, so parse
errors and R13 land on the same footing as R12:

```text
80709 scalars compared against fair-bioheaders 0.11.0, 0 disagreements
```

The corpus is the 90 named scalars (R12 and R13's own examples, the values the
shared vectors use, and neighbours a hand-written table gets wrong) plus a
deterministic length-1-to-3 combination sweep over the characters the resolvers
dispatch on (`--sweep`). Run without `--sweep` it is fast enough for a pre-commit
check; with it, about 6 seconds.

Escaping and number handling, measured rather than assumed:

- R11: `js-yaml` decodes `\x3E` and `\x40` in double-quoted scalars to `>` and `@`,
  keeps them literal in single quotes (correct YAML), and accepts the lowercase
  `\x3e` form and `\u2028`. Ordinary `>` and `@` in a plain scalar parse normally,
  and this library warns (R11 is a recommendation, so the file stays valid).
  Divergence recorded: `js-yaml` also accepts the `\e` escape (to U+001B), which
  YAML 1.2 does not define; no vector covers it, and no writer here emits it.
- the historic defect: a bare `n:` key. Under 1.2 it is the string `"n"`, under 1.1
  the boolean `false`. It is refused here as an R12 disagreement in key position —
  which is why the portability check runs on keys, not only values.
- R12 hazards all refuse correctly: `010`, `1_000`, `0b101`, `0o17`, `1:30`,
  `10:30:00`, `1e3`, `1.5e3` (YAML 1.1 wants a signed exponent — `1.5e+3` is the
  portable form), `yes`/`no`/`on`/`off`/`y`/`n` in any case. `TRUE` is a boolean in
  both dialects and stays valid unquoted, as in the toolkit.
- R6/R7: header lines are decoded UTF-8 with `fatal: true`, U+0085/U+2028/U+2029 are
  refused on the line text, and bytes outside the header block are never decoded —
  the `fasta-non-utf8-outside-header` valid vector depends on that distinction.
- JS number identity: `1.0 === 1` is true, which is exactly what V6 needs (FHR 1
  writers wrote `schemaVersion: 1` or `1.0`, and the rule says both are the number
  1); `'1.0' === 1.0` is false, so the string form never satisfies V6.
  `Number.isInteger(1.0)` is true, so an `integer`-typed slot accepts it.
  `JSON.stringify({v: 1.0})` yields `{"v":1}`: a round trip that has to keep the
  written text (a future microdata or JSON-LD writer) cannot use plain
  stringification. Integers above 2^53-1 round and are reported as a
  `precision warning`. `-0` survives as `-0` in `js-yaml` (it passes `minimum: 0`
  and stringifies as `0`); Python reads `-0` as `0`, and no vector covers it.

## Packaging metadata, as actually produced

`npm pack --dry-run` on the tree as committed:

```text
npm notice 📦  fair-bioheaders@0.0.0
npm notice Tarball Contents
npm notice 20.9kB LICENSE
npm notice 11.8kB README.md
npm notice 7.2kB llms.txt
npm notice 1.8kB package.json
npm notice (plus src/*.js, schemas/*.json, examples/*.json, docs/*.md)
npm notice Tarball Details
npm notice name: fair-bioheaders
npm notice version: 0.0.0
npm notice filename: fair-bioheaders-0.0.0.tgz
npm notice package size: 56.2 kB
npm notice unpacked size: 314.7 kB
npm notice total files: 31
```

`license` is the SPDX id `MPL-2.0`, matching the `LICENSE` file, and `npm pack`
accepted it without a licence warning. `npm publish --dry-run` gets as far as
`npm warn publish This command requires you to be logged in to
https://registry.npmjs.org/ (dry-run)` and stops there, which is the intended state:
nothing is published, there is no publish step in CI, and the published name stays a
maintainer decision. `npm view fair-bioheaders` returned 404 on 2026-11-14, so the
name is unclaimed; no ownership of it is asserted here.
`scripts/check-license.mjs` re-checks both places, the six provenance-split terms and
the canonical MPL-2.0 body digest on every CI run.
