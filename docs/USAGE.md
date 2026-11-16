# Using this library

Everything below was run against the tree as committed; the outputs are real.

## Reading and checking a file

```js
import { inspectFile } from 'fair-bioheaders';

const reading = inspectFile('genome.fhr.fasta');

reading.valid;            // true or false — nothing throws for a bad file
reading.errors;           // ['checksum mismatch: … (R3, R4)', …]
reading.warnings;         // ['R14 warning: metadata.relatedLink[1] is "javascript:…"', …]
reading.metadata;         // the header block as a plain object
reading.checksum;         // { stated, computed, matches }
reading.schema;           // { type: 'FHR', release: 'v0.6.0', schemaVersion: '2.1', rule: 'V3' }
reading.container;        // 'fasta'
```

The container is taken from the extension (`.fasta`, `.fa`, `.fna`, `.fas` →
`fasta`; `.gfa` → `gfa`; `.gff3` → `gff3`, with `.gz`/`.bgz` transport removed
first). Pass it explicitly when the name says nothing:

```js
import { readFileSync } from 'node:fs';
import { inspectBytes } from 'fair-bioheaders';

const reading = inspectBytes(new Uint8Array(readFileSync('stdin-copy')), { container: 'gfa' });
```

`gfa` means "a GFA file with an FHR header". FHR and FHP share the FASTA
container, so `container: 'fasta'` covers both and the record's own `schema` URL
decides which contract it is checked against — that is rule P2, and it is why a
protein file citing `fhr.json` fails as FHR rather than being relabelled.

## What `warnings` holds, and why it is not `errors`

Four things a conforming validator must report without rejecting the file:

| Warning | Why it is a warning |
| --- | --- |
| `R11 warning: …` | a raw `>` or `@` in a FASTA header line. kseq-based readers (BWA, minimap2, seqtk, `samtools dict`) start a record there. The file stays valid; writers escape it as `\x3E`/`\x40` |
| `R14 warning: …` | a `format: uri` value whose scheme is not `http`, `https`, `ftp`, `urn:`, `doi:` or `info:`. Rejecting it would invalidate records the released schemas accept, so it waits for the next major `schemaVersion` |
| `precision warning: …` | an integer beyond 2^53-1, which a JavaScript number cannot hold exactly. Python and Java readers keep the exact value; this build says so out loud instead of being quietly wrong |
| `FHR: warning: schemaVersion 1 via the raw-main schema URL is read as FHR 1 (v0.3.1); …` | the V6 compatibility path: deprecated, not invalid |
| `<TYPE>: warning: schema … is an unreleased draft (commit …, sha256 … of those bytes); read against that pinned draft, not a released schema` | the V7 lane: the record was read against a pinned draft, and the result is not a released-contract result |
| `derivedFrom[i]: unchecked - the parent file was not supplied (rule C3)` | an FHT draft parent link nobody recomputed; the record stays valid and the link is not called verified |

Plus the non-empty-required warnings of
[`docs/SCHEMA-VERSIONS.md`](https://github.com/FAIR-bioHeaders/FAIR-bioHeaders-Specification/blob/main/docs/SCHEMA-VERSIONS.md):
`genome`, `version`, `proteome`, `annotation` empty, `taxon` with neither `name`
nor `uri`, an empty author list or an author with no name. Such a record is
schema-valid and does not describe the data, so validators warn.

## Checking only the checksum

```js
import { readFileSync } from 'node:fs';
import { computeChecksum } from 'fair-bioheaders';

const bytes = new Uint8Array(readFileSync('genome.fhr.fasta'));
const { stated, computed, covered, candidate } = computeChecksum(bytes, 'fasta');

stated === computed;   // the file's own integrity claim
covered.length;        // what R3 says is hashed: everything but the checksum line
candidate.line;        // which line that was, if you need to report it
```

`computeChecksum` throws a `HeaderError` naming the rule (R2, R5) when the header
block has no single root-level checksum line, or the line holds anything else.
`digest(bytes)` gives the base64 SHA-512/256 of any byte string, if you want the
primitive directly.

## Selecting a contract yourself

```js
import { selectSchema, validateRecord, describeSupport, CURRENT_RELEASE } from 'fair-bioheaders';

const selection = selectSchema(record);      // { type, release, rule } or throws V4
validateRecord(record, selection);           // { valid, errors, warnings, schema }
CURRENT_RELEASE;                             // 'v0.6.0'
describeSupport('FHP');                      // 'main (v0.6.0), v0.4.0, v0.4.1, v0.4.2, v0.5.0, v0.6.0'
```

`selectSchema(record)` reads only the record's `schema` value and matches it exactly,
under either spelling of the specification repository's name; `selectSchema(record,
{drafts: [...]})` additionally recognises the pinned draft citations. A release this
build does not have throws a `HeaderError` with `result: 'unsupported-version'`
whose message names the value and lists what is available; the record is never
checked against a different contract. Use `selectSchema()` and then
`validateRecord()` rather than picking a schema yourself — a record's
`schemaVersion` is part of the selection (V6), not just its URL.

## Stripping

```js
import { writeFileSync } from 'node:fs';
import { stripFile } from 'fair-bioheaders';

writeFileSync('genome.plain.fasta', stripFile('genome.fhr.fasta'));
```

Every `;~`/`#~` line of the leading header block goes, with its terminator.
Ordinary comments, blank lines, `##gff-version 3`, other GFF3 directives and all
data bytes are preserved byte for byte. Gzip or BGZF input is stripped as its
decompressed bytes and returned **uncompressed** — this library does not
re-compress. A strict FASTA reader (htslib, Picard, bedtools, the Bowtie2/HISAT2/
STAR index builders, Biopython's default `fasta` format) needs exactly this; in
Biopython the alternative is `SeqIO.parse(path, "fasta-pearson")`.

Stripping needs no contract, so it works on a file citing a release this build
does not bundle — but it still refuses a header block that violates R2, R5, R6,
R7, R10 or G1, because "remove whatever looks like a header" on a malformed file
is how data gets lost.

## The rule-V7 draft lane

FHT and FHGM are drafts: no released contract, no registry row, no `schemaVersion`
claim and no w3id URL, and neither is supported here. The lane below is the one way
this library recognises them, and it is a caller decision.

```js
import { inspectFile, inspectBytes, draftSupport, draftSuitePin, verifyDraftBytes, checkFhgmModels, verifyParentLinks } from 'fair-bioheaders';

draftSupport();
// [{ type: 'FHT', citation: '…/FHT-Specification/main/fht.json', commit: '226f923c…', sha256: '59ad9641…', status: 'draft' }, …]

// The suite is a separate pin from the contract, and it is the one that names the
// development suite `scripts/capability/draft-vectors.mjs` scores. Both drafts state one
// as of the re-pin of 2026-11-16; a draft that stated none would report `stated: false`,
// and the runner would label its run UNPINNED instead of attributing a revision it never
// checked. The values below are printed, not transcribed: `node -e` over `draftSuitePin`.
draftSuitePin('FHT');
// { type: 'FHT', repository: 'FHT-Specification', stated: true, partial: false,
//   commit: 'be9bcc82…', manifest: 'conformance/manifest.json', sha256: '9fd8c0b2…',
//   bytes: 65615, vectors: 72, rules: ['C1', 'C2', 'C3'] }
draftSuitePin('FHGM');
// { type: 'FHGM', repository: 'FHGM-Specification', stated: true, partial: false,
//   commit: 'c503ecf3…', manifest: 'development/conformance/manifest.json',
//   sha256: '0d279015…', bytes: 51114, vectors: 43,
//   rules: ['B1', 'K1', 'K2', 'K3', 'K4', 'K5', 'K6'] }

const reading = inspectFile('rna.fht.fasta', { drafts: ['FHT'] });
reading.schema;  // { type: 'FHT', release: null, schemaVersion: null, rule: 'V7' }
reading.warnings // ['FHT: warning: schema … is an unreleased draft (commit …, sha256 … of those bytes); read against that pinned draft, not a released schema']

// C3, only with parents you hand over: nothing here goes looking for a file.
verifyParentLinks(reading.metadata, {
  type: 'FHT',
  resolveParent: (link) => ({ bytes: myParentBytesByName[link.checksum] ?? null }),
}); // links[i].verdict is 'checked-pass' | 'checked-fail' | 'unchecked'

// FHGM: not a header type. The file stays a released FHGFF3 file.
const annotation = inspectFile('models.fhgff3.gff3', { drafts: ['FHGM'] });
annotation.valid;      // the released FHGFF3 result — no draft verdict touches it
annotation.fhgm.valid; // the draft verdict on x-fhgm-models
annotation.fhgm.rules; // { B1, K1, K2, K3, K4: 'pass'|'reject'|'not-checked'|'unchecked', K5, K6 }
```

What the lane will not do:

- **open itself.** With no `drafts` option, a draft citation is "any other value"
  under V5 and is read as FHR, exactly as it was before the lane existed.
  `{drafts: true}` means "every draft this build pins", and `{drafts: ['FHX']}` is
  an error rather than a no-op — a caller that asked for a lane it did not get must
  hear about it.
- **read a moved draft.** `src/drafts.js` re-verifies the vendored bytes against
  `drafts/provenance.json` before compiling them, and a digest mismatch is reported
  (`the draft moved and this build was not re-pinned`) instead of being read.
- **score a suite it cannot check.** `scripts/capability/draft-vectors.mjs` first checks
  this build's own `drafts/` copies against `drafts/provenance.json` and exits 2 printing
  `NOTHING SCORED` if any digest disagrees, then verifies the development suite against
  `suiteCommit` / `suiteManifestSha256` (through `scripts/ci/suite-pin.mjs`) and exits 2 on
  a mismatch, so a draft count never names a revision nobody checked and never counts
  vectors read through bytes the registry rejects. A draft whose row states no suite pin is
  scored and labelled `UNPINNED`, never `verified` - no draft in this build's registry is
  in that state since 2026-11-16, FHGM included.
- **grant a verdict it cannot reach.** A vector whose expectation needs FHGM K4 and whose
  reading has no usable feature layer, or one whose `layers.gff3` expectation asks for a
  feature-layer rejection this library does not compute, stays not-run with that reason
  printed. Neither is ever passed by assumption, and neither is quietly dropped from the
  table.
- **take a release form.** A w3id URL or a release-tag URL for either type is not
  recognised with the lane open; it falls through to V5. A draft reading reports
  `release: null` and `schemaVersion: null` and names the commit and digest it was
  actually taken against.

K6 resolves predecessor pointers only against snapshots the caller supplies:
`{ fhgm: { predecessors: [{ checksum, header }] } }`. A pointer with no supplied
history is `unresolvable`, which is a rejection under the draft rule - and it is
never reported as verified. K4 resolves a `featureId` against the GFF3 feature
layer: by default the lane indexes the file's own rows for their `ID` and `type`
(`src/features.js`); a caller holding the layer elsewhere passes
`{ fhgm: { features } }` (row facts `[{id, type}]` or GFF3 content) or the older
`{ fhgm: { geneIds } }` shorthand, and `{ fhgm: { features: null } }` closes it.
Without a usable layer K4 reports `not-checked` or `unchecked` — never a pass,
never a rejection.

To run the owning repositories' development suites through the lane - separate,
labelled draft evidence, never counted with the shared 291:

```sh
node scripts/capability/draft-vectors.mjs --fht ../FHT-Specification --fhgm ../FHGM-Specification
node scripts/ci/draft-pins.mjs --check ../FHT-Specification ../FHGM-Specification   # are the pins still live?
```

Both exit 3 with a message when nothing is given; neither reports a pass it did not
compute.

## Writing headers is out of scope

There is no `combine` and no checksum-to-write. If you need to create or edit a
header, use the Python toolkit (`pip install fair-bioheaders`, `bioheaders
combine metadata.yaml genome.fa -o genome.fhr.fa`) or implement the write side
here in its own reviewed change. **Never write or edit a checksum by hand**, and
re-run whatever produced the file after any edit: header edits invalidate the
checksum and can invalidate downstream parent links in other files.

## Testing your own integration

Point the runner at the vectors rather than trusting a hand-written case:

```sh
node scripts/run-conformance.mjs --format fhp-fasta
node scripts/run-conformance.mjs --id fasta-extension-fields --id fhgff3-both-links
node scripts/run-conformance.mjs --suite /path/to/FAIR-bioHeaders-Specification/conformance
```

`--id` and `--format` select; the table always reports `not-run` with a reason for
`microdata` and `jsonld`, so a future reader path cannot half-land silently.

To check that the whole suite actually ran - that no vector lost its test and that
nothing was skipped outside the declared set:

```sh
npm run test:ci            # scripts/check-test-report.mjs --json test-report.json
```

It exits 1 on zero tests, on a manifest vector with no test, on a duplicate, and on
any skip that is not the declared not-run reason. The same declaration
(`src/serializations.js`) is what the runner, `npm test`, the acceptance matrix and
this guard all read, so a format cannot be implemented in one table and forgotten in
another.

To see what the default (lane-off) behaviour is, and to prove a lane change did not
move it:

```sh
node scripts/golden-default-off.mjs print   # recomputes the aggregate digest
npm run test                                # test/default-gate.test.mjs compares it to the golden
```

Regenerating the golden (`... write`) is a change to default behaviour: say so in the
PR, with the reason.
