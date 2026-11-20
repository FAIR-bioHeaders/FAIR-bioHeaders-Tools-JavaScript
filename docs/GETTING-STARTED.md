# Install and use the JavaScript library

Use Node.js 20 or newer (Node 24 is the development line) and npm. Native
SHA-512/256 comes from `node:crypto`; browser, Deno and Bun builds are not supplied.
This is source installation, not an npm-registry release claim.

```sh
git clone https://github.com/FAIR-bioHeaders/FAIR-bioHeaders-Tools-JavaScript.git
cd FAIR-bioHeaders-Tools-JavaScript
npm ci --ignore-scripts
node scripts/check-test-report.mjs --json test-report.json
```

For a separate consumer, run `npm pack`, then install the resulting tarball with
`npm install /absolute/path/to/fair-bioheaders-0.0.0.tgz`. The package is ESM; use
`.mjs` files or `"type": "module"`. This avoids claiming ownership of a registry name.

## Complete example

From the source checkout, run this as an `.mjs` file. It uses a vendored valid
shared vector, requires a passing header/checksum result, then deliberately
changes a body byte and requires rejection. It writes no input or output file.

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectBytes, stripBytes } from 'fair-bioheaders';

const bytes = new Uint8Array(readFileSync('conformance/valid/fasta-quoted-value.fhr.fasta'));
const options = { container: 'fasta' };
const result = inspectBytes(bytes, options);
assert.equal(result.valid, true);
assert.equal(result.checksum.matches, true);
const body = stripBytes(bytes, options);
assert.ok(body.length > 0);
const changed = bytes.slice();
changed[changed.length - 2] ^= 1;
assert.equal(inspectBytes(changed, options).valid, false);
console.log(result.schema.type, result.schema.release, body.length);
```

## Important operations and failures

| API | Inputs, result and side effects |
| --- | --- |
| `inspectBytes(bytes, options)` | Uint8Array plus explicit `container` (or `name` for inference); returns a Reading with `valid`, errors, warnings, metadata, checksum and selected schema. Does not write files. |
| `inspectFile(path, options)` | Reads disk synchronously; infers container from extension unless overridden. Filesystem/setup errors can throw. |
| `inspectFileAsync(path, options)` / `inspectStream(source, options)` | Promise of Reading; streamed input, including gzip. Stream must be an async iterable of bytes. Caller controls deadlines and input size. |
| `stripBytes(bytes, options)` / `stripFile(path, options)` | Returns uncompressed bytes without the header. Throws on malformed header structure, BOM or decompression limits; does not establish schema/checksum validity. Validate first when that is required. |
| `stripFileTo(input, output, options)` | Promise of `{bytesWritten}`. Writes a sibling temporary file and renames over output on success; may replace an existing output. Structural stripping only. |
| `selectSchema(record, options)` / `validateRecord(record, selection)` | Resolve against local pinned contracts and validate the record. Neither recomputes file checksums. |
| `computeChecksum(bytes, container)` / `digest(bytes)` | Compute file-covered checksum or primitive SHA-512/256. A checksum provides integrity, not author authentication. |

See [USAGE](USAGE.md) for warning/error fields, helper APIs, draft pins and parent
resolvers, [MATRIX](MATRIX.md) for formats, and [SECURITY](../SECURITY.md) for private
reporting. `HeaderError` carries a rule when applicable. Invalid records generally
produce Reading errors; programmer options and filesystem failures can throw.
A failed Reading can contain empty metadata/checksum fields and a placeholder
FHR type when processing stopped before selection. Errors are not an exhaustive
list: an unsupported schema may replace earlier diagnostic detail. Always require
`valid === true` before interpreting fields as validated; `matches: false` alone
does not distinguish an unperformed comparison from a mismatch.

## Limits and maintenance

Synchronous gzip decompression defaults to 1 GiB maximum output;
`maxDecompressedBytes` overrides it. Streaming avoids holding the whole body but
provides no total decompressed-byte or execution-time cap. Historical FHGM K4
keeps a feature index that grows with feature count; do not describe it as bounded
by header size. Bound untrusted workloads externally. No GFF3 biology checks,
writer, HTML or JSON-LD reader is provided. The historical draft lane is opt-in
through `{drafts: [...]}` and never adopts current upstream publications.

Maintainers should start at `reader.js` (orchestration), `scan.js` (incremental
header handling), `yaml.js` (safe parse/limits), `selection.js` and `registry.js`
(pinned resolution), and `checksum.js` (covered bytes). These live under `src/`.
Run the accounted native suite and vendoring/matrix/docs checks before a PR;
another actual model reviews, CI must pass, and a human performs the merge.
