# Capability study: JavaScript against the released family contracts

Executed on this host on 2026-11-14 before any implementation was chosen, and
re-runnable:

```sh
npm run capability:ajv        # draft/2020-12 dialect and the released contracts
npm run capability:digest     # SHA-512/256, proved against the shared vectors
npm run capability:yaml       # R12/R13 read, differentially against the toolkit
npm run capability:toolkit    # validity and strip bytes, against the toolkit CLI
```

Each script exits non-zero on a failed expectation and exits 3 with a message when
its external reference (a Python with the released toolkit) is absent — none of
them reports a pass it did not compute.

## Environment

| Component | Version |
| --- | --- |
| Node.js | v24.22.1 (`/opt/homebrew/opt/node@24/bin/node`), npm 11.19.1 |
| `ajv` | 8.20.0 (MIT) |
| `ajv-formats` | 3.0.1 (MIT) |
| `js-yaml` | 5.5.0 (MIT) |
| reference toolkit | `fair-bioheaders` 0.11.0 from PyPI (no `direct_url.json`: index-installed, not a checkout), Python 3.15.0 |
| contracts | FAIR-bioHeaders-Specification `v0.6.0` (`fhr.json` `694ab5af…`, `fhp.json` `92a0b3cb…`, `fhgff3.json` `1942be4c…`), `main` at `a60bc02` schema-identical to the tag |

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
copies. `npm run capability:ajv` reports **42 pass, 0 fail**; each check that a
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
  library therefore asserts `date` and `uri` through `ajv-formats`, as
  `docs/SCHEMA-VERSIONS.md` requires, and confirms that R14's accepted schemes
  (`urn:`, `doi:`, `ftp://`) survive `format: uri` while `javascript:` stays
  schema-valid and only warns.
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

and `strictTypes` similarly objects to `then: {properties: {completeness: …}}`
whose target is a `$ref` without its own `type`. Both are compile-time style
checks, not semantics, and `strict: 'log'` does not downgrade them — they still
throw. So `src/validate.js` uses:

```js
new Ajv2020({ strict: true, strictRequired: false, strictTypes: false,
              validateFormats: true, allowUnionTypes: true })
```

plus `addFormats(ajv, {formats: ['date', 'uri']})`. `allowUnionTypes` is needed
because the contracts use `type` arrays (the legacy software string-or-array
field). Vendored copies share one `$id` — their raw-main URL — so `ajv` refuses a
second `addSchema`; each copy is compiled with `$id` removed and keyed by type and
release. The files on disk keep their released bytes, which is what
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
| `<<` in value position | 1.1 str | refused | 1.1's `merge` resolver tag is kept distinct; in key position it is refused as an R8 merge key first |
| `1.7976931348623157e309` | 1.2 core float overflows to Infinity, 1.1 reads a string, so the pair "agrees" on a value the toolkit refuses | refused | R12 fires on the tag pair, with a separate R13 overflow refusal behind it for notations that do resolve alike |
| `1:05:30.5`, `1:60`, `0:1` | sexagesimal handling differed | matches this build now | 1.1's sexagesimal integer and float channels are resolved exactly as PyYAML's patterns state, so `0:1` and `1:60` stay strings and `1:30` is the integer 90 |

So both tables are written out there from the dialects themselves — YAML 1.2 core
from the specification's core-schema patterns, YAML 1.1 from the resolver PyYAML
registers (plus the `y`/`n` booleans the toolkit adds), with a timestamp read as
`str` because R12 keeps date-like plain scalars as strings — and integers are
resolved as `BigInt`, so the comparison is exact rather than double-precision.
`js-yaml` still does the actual parsing and value construction; the tables only
decide whether the two dialects agree.

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
