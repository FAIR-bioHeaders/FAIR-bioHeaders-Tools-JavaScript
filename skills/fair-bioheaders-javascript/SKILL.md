---
name: fair-bioheaders-javascript
description: Read, check and strip FAIR-bioHeaders metadata headers from JavaScript on Node.js - FHR headers in reference genome FASTA or GFA, FHP headers in protein FASTA, FHGFF3 headers in GFF3. Use when the user wants to verify a `;~` or `#~` header and its SHA-512/256 checksum in a Node.js or JavaScript project, parse header metadata into a JavaScript object, or strip a header so samtools/htslib, Picard, bedtools or Biopython will open the file. Do NOT use it to write a header (this library has no writer), to validate GFF3 features (use gff3-validator), to read FHT or FHGM metadata as a released contract (neither is released; the V7 draft lane is recognition, not support), or to describe the fhref.org browser tools as JavaScript validation (they run CPython under Pyodide).
---

# FAIR-bioHeaders in JavaScript

A FAIR-bioHeaders header is a block of YAML lines at the top of a data file:
`;~key: value` in FASTA, `#~key: value` in GFA and GFF3 (after `##gff-version 3`).
The metadata validates against a per-type JSON Schema (draft 2020-12), and a
SHA-512/256 checksum covers every byte of the file except the root checksum line.
This library reads that, checks it, and can take it out again. Node's own
`crypto`, `zlib` and `ajv` do the work; no Python, no WebAssembly.

Specification: [FAIR-bioHeaders-Specification](https://github.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification),
rules R1-R15 in `docs/FORMAT.md`, P1-P2 in `docs/FHP.md`, G1-G3 in `docs/FHGFF3.md`,
V1-V6 in `docs/SCHEMA-VERSIONS.md`.

## Supported contracts, as released

| Header | File | Schema to cite in `schema` | `schemaVersion` | This library |
| --- | --- | --- | --- | --- |
| FHR | reference genome FASTA or GFA | `https://w3id.org/fair-bioheaders/fhr/v0.6.0` | `'2.1'` | yes |
| FHP | protein FASTA | `https://w3id.org/fair-bioheaders/fhp/v0.6.0` | `'1.2'` | yes |
| FHGFF3 | GFF3 annotation | `https://w3id.org/fair-bioheaders/fhgff3/v0.6.0` | `'1.2'` | yes |
| FHT | transcriptome | - | - | **no: draft, no released contract.** Readable only through the opt-in `{drafts: ['FHT']}` lane against pinned bytes |
| FHGM | gene-model records inside an FHGFF3 header | - | - | **no: draft, no released contract.** Same lane; K4 (feature-layer resolution) is declared not implemented |

Read versions from the shared registry
(`schemas/versions.json` at a release tag), never from memory. FHT is scheduled as a
future `v0.7.0` and FHGM as `v0.8.0`; until those releases exist, a draft has no
`schemaVersion`, no w3id URL, no registry row and no support claim, and rule V7 keeps
it that way. If a user asks you to add FHT or FHGM **support** here, stop and say the
contract is unreleased - do not invent a version, a URL, a registry row or a
`drafts/provenance.json` entry that looks like a release.

What this library *does* have is the reader lane V7 defines, which is recognition and
not adoption: `inspectBytes(bytes, {container, drafts: ['FHT']})`. Use it only when the
user explicitly asked to read a draft - never to make a default reading "just work" -
and keep the three properties intact: the lane is opt-in per call, the bytes are the
ones `drafts/provenance.json` pins by commit and SHA-256, and every record read that
way carries the warning naming them. A V7 reading reports `release: null` and
`schemaVersion: null`; say "read against a pinned draft", never "validated against the
FHT contract". FHGM verdicts arrive in a separate `reading.fhgm` block: the file's own
FHGFF3 result is untouched, and K4 stays not-supported-yet because resolving a
`featureId` needs the GFF3 feature layer, which belongs to `gff3-validator`.

## Rules for using it

- **Never invent metadata.** Species, authors, ORCIDs, accessions, versions, dates,
  SeqCol digests and parent checksums come from the user or from files they point at.
  Ask for anything missing.
- **Never write or edit a checksum by hand, and do not add a writer to this library
  as a side effect.** It is read/check/strip only. To create or change a header, use
  the Python toolkit (`pip install fair-bioheaders`, `bioheaders combine`). Any header
  edit requires recomputation and can break downstream parent links.
- **A valid header is not validated data.** FHGFF3 checking says nothing about GFF3
  features, sequence-ontology terms or biology: that is
  [`gff3-validator`](https://github.com/FAIR-bioHeaders/gff3-validator). And a checksum
  is integrity, not authentication: it identifies bytes, not an author.
- **`inspectFile`/`inspectBytes` do not throw on a bad file.** Check `reading.valid`,
  then read `reading.errors` (each names its rule) and `reading.warnings`.
- **An unavailable contract is `unsupported-version`, not a failure of another
  schema.** V4: `reading.schema.rule === 'V4'` and the message lists what this build
  bundles. Never fall back to the current schema to make the error go away.
- **Report warnings, do not silently upgrade them to errors.** R11 (raw `>`/`@`),
  R14 (link scheme), the non-empty-required warnings and the JavaScript
  integer-precision warning keep a file valid. Refusing them would reject records the
  released contracts accept.
- **Do not describe the fhref.org browser tools as JavaScript validation.** They run
  the Python toolkit under Pyodide; the family has ruled
  ([fair-bioheaders.github.io#23](https://github.com/FAIR-bioHeaders/fair-bioheaders.github.io/issues/23))
  that validation must not be claimed as performed in JavaScript for that path. This
  library is separate and native; do not present one as evidence for the other.
- **Pass the container when the file name does not say.** `container: 'fasta' | 'gfa' |
  'gff3'`. FHR and FHP share the FASTA container: `container: 'fasta'` is correct for
  both, and the record's `schema` URL decides which contract applies.

## Recipes

Check a file, reporting the rule each finding comes from:

```js
import { inspectFile } from 'fair-bioheaders';

const reading = inspectFile('genome.fhr.fasta');
if (!reading.valid) {
  for (const error of reading.errors) console.error('invalid:', error);
  process.exitCode = 1;
} else {
  console.log(`${reading.schema.type} ${reading.schema.schemaVersion} against ${reading.schema.release} (${reading.schema.rule})`);
  console.log(`checksum ${reading.checksum.computed} matches: ${reading.checksum.matches}`);
  for (const warning of reading.warnings) console.warn(warning);
}
```

Strip a header so a strict tool can open the file:

```js
import { writeFileSync } from 'node:fs';
import { stripFile } from 'fair-bioheaders';

writeFileSync('genome.plain.fasta', stripFile('genome.fhr.fasta'));
```

Ordinary comments, blank lines, GFF3 directives and all data bytes are preserved
byte for byte; gzip or BGZF input comes back uncompressed. In Biopython the
alternative to stripping is `SeqIO.parse(path, "fasta-pearson")`.

Take the checksum of bytes you already have:

```js
import { computeChecksum } from 'fair-bioheaders';

const { stated, computed } = computeChecksum(new Uint8Array(buffer), 'fasta');
if (stated !== computed) console.error('the file does not match its own header');
```

Validate a record you parsed yourself:

```js
import { selectSchema, validateRecord } from 'fair-bioheaders';

const selection = selectSchema(record);        // V1-V6; throws with result 'unsupported-version'
const result = validateRecord(record, selection);
// result.valid, result.errors, result.warnings, result.schema
```

## Verifying your change

Acceptance is the shared vector suite, vendored byte-for-byte with provenance:

```sh
npm test                    # unit tests + one case per vector (63 reported skipped)
npm run conformance         # per-format table: fasta 98, gfa 56, fhp-fasta 36, fhgff3 38 pass
npm run check:vendoring     # vendored bytes still match their recorded SHA-256
```

Optional, and skipped with exit 3 rather than passing silently, when the reference
toolkit is not installed:

```sh
FHR_PYTHON=…/python npm run capability:yaml -- --sweep   # R12/R13 against bioheaders.load_yaml
FHR_TOOLKIT_BIN=…/bin npm run capability:toolkit         # validity and strip bytes against the CLI
```

If a vector fails, treat it as a bug in this library or in the vector - and report
it, per the suite's own README. Never edit a file under `conformance/` or `schemas/`
to make a check pass: those are other repositories' published bytes. Never claim a
format passes that the runner reports as not-run.
