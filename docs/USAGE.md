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

`selectSchema` reads only the record's `schema` value and matches it exactly,
under either spelling of the specification repository's name. A release this
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
