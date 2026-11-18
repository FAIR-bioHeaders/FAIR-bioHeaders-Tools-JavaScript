# Security policy

Report suspected vulnerabilities privately; do not open a public issue for one.

This repository is a reader. The security-relevant surface is that it parses
untrusted files: a header block from someone else's FASTA, GFA or GFF3. Findings
about that — unbounded memory or CPU on crafted input, a rule this build enforces
weaker than the specification states, a way a header can be made to *look* valid
when it is not — are in scope. So is any divergence between this library's verdict
and the released toolkit's, because a header check that passes the wrong file is the
failure mode the checksum exists to prevent.

Out of scope for this policy and better filed as an ordinary issue: schema
correctness questions with no security impact, and the shared specification's own
rule text.

## Private reporting channel

Email [molik@fhref.org](mailto:molik@fhref.org), the family's
maintainer-confirmed reporting address, and identify the affected repository and
version or commit. This address is taken from
[`FAIR-bioHeaders-Specification/SECURITY.md`](https://github.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification/blob/main/SECURITY.md)
and [`FAIR-bioHeaders-Tools/SECURITY.md`](https://github.com/FAIR-bioHeaders/FAIR-bioHeaders-Tools/blob/main/SECURITY.md);
this repository has no separate channel. Do not assume GitHub private
vulnerability reporting is enabled here. If a report involves David Molik, contact
[Adam Wright](mailto:wright@fhref.org) at [wright@fhref.org](mailto:wright@fhref.org)
instead; if it involves Adam Wright, use the address above. Do not copy a maintainer
who is the subject of a report.

Include the affected version or commit, a reproduction — a minimal file is better
than a description — the observed and expected behaviour, and any impact. Avoid
posting private genome data, credentials or exploit details in a public issue;
if a reproducer cannot be shared, say so and describe how to generate it.

Maintainers acknowledge receipt, assess severity, coordinate the fix and
disclosure, and credit the reporter with consent. No response deadline is
promised by this policy, because none has been agreed: this is not a supported
product line and there is no SLA to quote.

## What this build already refuses, and what it does not

Refused by design, each with a rule id from the shared specification: duplicate
mapping keys, anchors, aliases and merge keys (R8); a mapping key that is not a
string (`1:`, `~:`, `true:`), because metadata is a JSON object; explicit YAML
tags, and any plain scalar the two YAML dialects read differently (R12);
non-finite numbers (R13); more than one YAML document; header blocks beyond
1 MiB or 10,000 lines, and YAML beyond 20,000 nodes or 64 levels of nesting (the
reader limits of `docs/FORMAT.md`); invalid UTF-8 in a header line (R6); a byte
order mark (R7); a header line after the first record (R10).

Not provided, and not claimed:

- **No authentication of any kind.** A checksum covers bytes; it does not identify
  an author and is not a signature. `docs/FORMAT.md` says so, and nothing here adds
  a trust signal. A file that verifies is a well-formed file, not a trustworthy one.
- **Whole-file buffering.** There is no streaming reader, so a very large sequence
  file is held in memory, decompressed. The limits above bound the *header*, not the
  payload. Do not feed this library unbounded streams; that is a known property, not
  a bug to be discovered.
- **No sandbox claim.** Parsing untrusted YAML is confined to `js-yaml`'s core
  schema with aliases refused and depth and node counts bounded; that is a design
  choice against the billion-laughs class of input, not a proof. `__proto__` keys are
  held as own data properties by `js-yaml` 5.5.0, so no object's prototype changes.
  At the top level, and inside any object the contract closes, such a key is then
  refused as an unknown key. Inside an `x-` extension value, which the contracts
  leave open, it is **accepted** as ordinary data, as the toolkit accepts it:
  `x-p: {__proto__: {polluted: 1}}` reads as an object with an own property named
  `__proto__`, and `Object.prototype` is untouched. Both halves are asserted in
  `test/yaml.test.mjs`, and if a future dependency version changes them, that test
  is where the claim dies. A consumer that copies metadata with `Object.assign` or
  a property-by-property assignment turns that own property into a prototype
  setter; copy with spread or `structuredClone`, which define properties instead.
- **No vulnerability reporting history to point at**, because the repository was
  created on 2026-11-14 and has no release, no advisory list and no deployed users.
  Anyone adopting it is adopting unreviewed pre-release code.

## Hardening notes for maintainers

- Dependencies are exact pins (`ajv` 8.20.0, `ajv-formats` 3.0.1, `js-yaml` 5.5.0)
  with `package-lock.json` committed, and CI installs with `npm ci --ignore-scripts`.
  A dependency bump is a reviewed change, not a renovate merge: `js-yaml`'s tag
  resolution and `ajv`'s strict mode have both already been shown to change
  conformance outcomes for this specification (see
  [`docs/CAPABILITY.md`](docs/CAPABILITY.md)), so re-run `npm test` **and**
  `npm run capability:toolkit` on any bump.
- Vendored contract and vector copies are digest-checked by `npm run check:vendoring`.
  A silent change to `schemas/fhp-1.2.json` would change which files this library
  calls valid, so provenance drift is a security event here, not a cosmetic one.
- Nothing in this repository makes network requests at run time: no schema fetching,
  no telemetry, no update checks.
