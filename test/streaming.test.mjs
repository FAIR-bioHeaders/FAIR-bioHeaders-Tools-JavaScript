/**
 * The single-pass reader: bounded memory, streaming input, bounded in-memory
 * decompression and files over 2 GiB.
 *
 * Every streaming result is compared with the in-memory reading of the same
 * bytes, split into chunks of awkward sizes, so a chunk boundary inside a CRLF,
 * a prefix, a checksum line or a gzip member cannot change a verdict.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, ftruncateSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { afterEach, describe, it, mock } from 'node:test';
import { gzipSync } from 'node:zlib';

import { HeaderScanner } from '../src/scan.js';
import { computeChecksum } from '../src/checksum.js';
import { decompress, inspectBytes, inspectFile, inspectFileAsync, inspectStream, stripBytes, stripFile, stripFileTo } from '../src/reader.js';
import { containerFor } from '../src/serializations.js';
import { HeaderError } from '../src/errors.js';
import { MINIMAL_FHR_LINES, buildFhgff3File, buildRawFasta, fhgmHeader } from '../testutil/fixtures.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUITE = join(ROOT, 'conformance');
const manifest = JSON.parse(readFileSync(join(SUITE, 'manifest.json'), 'utf8'));
const vectors = manifest.vectors.filter((vector) => containerFor(vector.format) !== null);

/**
 * @param {Uint8Array} bytes
 * @param {number} size
 */
async function* chunked(bytes, size) {
  for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
}

/** @param {(dir: string) => Promise<void>|void} body */
async function inTempDir(body) {
  const dir = mkdtempSync(join(tmpdir(), 'fhb-stream-'));
  try {
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('streaming reads the shared vectors exactly as the in-memory reader does', () => {
  it(`gives the same reading for every runnable vector, in chunks of 1, 2, 3, 7 and 4096 bytes`, async () => {
    assert.ok(vectors.length > 0);
    for (const vector of vectors) {
      const raw = new Uint8Array(readFileSync(join(SUITE, vector.file)));
      const container = containerFor(vector.format);
      const want = inspectBytes(raw, { container });
      for (const size of [1, 2, 3, 7, 4096]) {
        assert.deepEqual(await inspectStream(chunked(raw, size), { container }), want, `${vector.id} in ${size}-byte chunks`);
      }
      assert.deepEqual(inspectFile(join(SUITE, vector.file), { container }), want, `${vector.id} through inspectFile`);
      assert.deepEqual(await inspectFileAsync(join(SUITE, vector.file), { container }), want, `${vector.id} through inspectFileAsync`);
    }
  });

  it('strips every valid vector to the same bytes through stripBytes, stripFile and stripFileTo', async () => {
    await inTempDir(async (dir) => {
      for (const vector of vectors.filter((row) => row.expected === 'valid')) {
        const path = join(SUITE, vector.file);
        const container = containerFor(vector.format);
        const want = stripBytes(new Uint8Array(readFileSync(path)), { container });
        assert.deepEqual(new Uint8Array(stripFile(path, { container })), new Uint8Array(want), vector.id);
        const out = join(dir, `${vector.id}.out`);
        const { bytesWritten } = await stripFileTo(path, out, { container });
        assert.equal(bytesWritten, want.length, vector.id);
        assert.deepEqual(new Uint8Array(readFileSync(out)), new Uint8Array(want), vector.id);
      }
    });
  });
});

describe('the scanner across chunk boundaries', () => {
  const lines = MINIMAL_FHR_LINES.filter((line) => line !== 'checksum: COMPUTE');

  it('reads CRLF and lone-CR files the same in any split', () => {
    for (const eol of ['\r\n', '\r']) {
      const text = new TextDecoder().decode(buildRawFasta([...lines, 'checksum: COMPUTE'])).replaceAll('\n', eol);
      const bytes = new TextEncoder().encode(text);
      const whole = computeChecksum(bytes, 'fasta');
      for (let split = 1; split < bytes.length; split += 1) {
        const scanner = new HeaderScanner('fasta');
        scanner.push(bytes.subarray(0, split));
        scanner.push(bytes.subarray(split));
        const parted = scanner.finish();
        assert.equal(parted.computed, whole.computed, `${JSON.stringify(eol)} split at ${split}`);
        assert.deepEqual(parted.candidate, whole.candidate);
      }
    }
  });

  it('keeps no more than the header block, whatever follows it', () => {
    const scanner = new HeaderScanner('fasta');
    scanner.push(buildRawFasta([...lines, 'checksum: COMPUTE'], ''));
    const sequence = new TextEncoder().encode('>s\n' + 'ACGT'.repeat(1 << 18) + '\n');
    for (let k = 0; k < 64; k += 1) scanner.push(sequence);
    const result = scanner.finish();
    assert.equal(result.lines.length, MINIMAL_FHR_LINES.length);
    assert.ok(result.size > 64 * (1 << 20));
  });

  it('reports the first rule broken, in file order, and is spent after it', () => {
    const scanner = new HeaderScanner('fasta');
    scanner.push(new TextEncoder().encode('>s\nACGT\n'));
    assert.throws(() => scanner.push(new TextEncoder().encode(';~late: 1\n')), (error) => error instanceof HeaderError && error.rule === 'R10');
    assert.throws(() => scanner.finish(), (error) => error.rule === 'R10');
  });
});

describe('bounded decompression', () => {
  // 16 MiB of line feeds behind a valid header: about 16 KiB of gzip. Whole-file
  // line arrays turned this shape into a heap exhaustion the caller could not catch.
  const header = buildRawFasta([...MINIMAL_FHR_LINES], '>c1\nACGT\n');
  const bomb = gzipSync(Buffer.concat([header, Buffer.alloc(16 << 20, 0x0a)]), { level: 9 });

  it('reads a small gzip file that inflates to many short lines, in memory', () => {
    assert.ok(bomb.length < 1 << 20, `the input is small (${bomb.length} bytes)`);
    const reading = inspectBytes(bomb, { container: 'fasta' });
    assert.equal(reading.valid, false);
    assert.match(reading.errors.join(' '), /checksum mismatch/);
  });

  it('refuses to inflate past maxDecompressedBytes, as a reading, not a crash', () => {
    const reading = inspectBytes(bomb, { container: 'fasta', maxDecompressedBytes: 1 << 20 });
    assert.equal(reading.valid, false);
    assert.match(reading.errors[0], /^limits: gzip\/BGZF input decompresses to more than 1048576 bytes/);
    assert.throws(() => decompress(bomb, { maxDecompressedBytes: 1 << 20 }), (error) => error instanceof HeaderError && error.rule === 'limits');
    assert.throws(() => stripBytes(bomb, { container: 'fasta', maxDecompressedBytes: 1 << 20 }), /maxDecompressedBytes/);
  });

  it('streams the same input with no limit, to the same reading', async () => {
    assert.deepEqual(await inspectStream(chunked(bomb, 65536), { container: 'fasta' }), inspectBytes(bomb, { container: 'fasta' }));
  });

  it('bounds the sync file reader too, and inspectFileAsync streams it', async () => {
    await inTempDir(async (dir) => {
      const path = join(dir, 'bomb.fasta.gz');
      writeFileSync(path, bomb);
      assert.match(inspectFile(path, { maxDecompressedBytes: 1 << 20 }).errors[0], /maxDecompressedBytes/);
      assert.deepEqual(await inspectFileAsync(path), inspectBytes(bomb, { container: 'fasta' }));
    });
  });

  it('reports a corrupt gzip stream as R1 even when its content breaks a rule first', async () => {
    const late = Buffer.concat([buildRawFasta([...MINIMAL_FHR_LINES]), Buffer.from(';~late: 1\n'), Buffer.alloc(1 << 16, 0x41)]);
    const corrupt = gzipSync(late).subarray(0, -12);
    const memory = inspectBytes(corrupt, { container: 'fasta' });
    assert.match(memory.errors[0], /^R1: invalid gzip or BGZF input/);
    assert.deepEqual(await inspectStream(chunked(corrupt, 100), { container: 'fasta' }), memory);
  });
});

describe('the FHGM lane reads the feature rows from the stream', () => {
  it('gives K4 the same verdict from a stream as from bytes', async () => {
    const header = { ...fhgmHeader(), schema: 'https://w3id.org/fair-bioheaders/fhgff3/v0.5.0', schemaVersion: '1.1' };
    const rows = ['toy\tpilot\tgene\t10\t30\t.\t+\t.\tID=toy%2Da', 'toy\tpilot\tlncRNA\t10\t30\t.\t+\t.\tID=toy-a-rna;Parent=toy%2Da'];
    for (const tail of ['', '##FASTA\n>toy\nACGT\n', 'not\ta\trow\n']) {
      const { bytes } = buildFhgff3File(header, { rows, tail });
      const want = inspectBytes(bytes, { container: 'gff3', drafts: ['FHGM'] });
      assert.equal(typeof want.fhgm, 'object');
      for (const size of [1, 5, 4096]) {
        assert.deepEqual(await inspectStream(chunked(bytes, size), { container: 'gff3', drafts: ['FHGM'] }), want, `${JSON.stringify(tail)} in ${size}-byte chunks`);
      }
    }
  });
});

describe('stripFileTo', () => {
  afterEach(() => {
    mock.restoreAll();
    syncBuiltinESMExports();
  });

  /**
   * Make every FileHandle that `stripFileTo` opens write at most one byte per
   * call - a legitimate short write - and count the writes that came up short.
   */
  function oneBytePerWrite() {
    const realOpen = fsPromises.open;
    const counts = { short: 0 };
    mock.method(fsPromises, 'open', async (...args) => {
      const handle = await realOpen(...args);
      const write = handle.write.bind(handle);
      return new Proxy(handle, {
        get(target, key) {
          if (key !== 'write') {
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
          }
          return (buffer, offset = 0, length = buffer.length - offset, position = null) => {
            if (length > 1) counts.short += 1;
            return write(buffer, offset, Math.min(length, 1), position);
          };
        },
      });
    });
    syncBuiltinESMExports();
    return counts;
  }

  it('finishes every buffer when the file handle writes short, in the streaming loop and at the end', async () => {
    await inTempDir(async (dir) => {
      // The small file ends on a short line with no newline, which the scanner
      // holds back and hands over only when it finishes, so the final write loop
      // runs; the large one, several chunks of sequence, is written inside the
      // read loop.
      const small = buildRawFasta([...MINIMAL_FHR_LINES], '>seq1 synthetic fixture\nACGTACGTAC\nAC');
      const large = buildRawFasta([...MINIMAL_FHR_LINES], `>seq1 synthetic fixture\n${'ACGTACGTAC\n'.repeat(300_000)}`);
      for (const [name, plain] of [['small.fasta', small], ['large.fasta', large]]) {
        const want = stripBytes(plain, { container: 'fasta' });
        writeFileSync(join(dir, name), plain);
        const counts = oneBytePerWrite();
        const { bytesWritten } = await stripFileTo(join(dir, name), join(dir, `out-${name}`));
        mock.restoreAll();
        syncBuiltinESMExports();
        assert.ok(counts.short > 0, `${name}: the wrapper must have shortened at least one write`);
        assert.equal(bytesWritten, want.length, `${name}: bytesWritten counts the bytes actually written`);
        assert.deepEqual(new Uint8Array(readFileSync(join(dir, `out-${name}`))), new Uint8Array(want), `${name}: the output holds every stripped byte`);
      }
    });
  });

  it('leaves no output and no partial file when the header block is refused', async () => {
    await inTempDir(async (dir) => {
      const input = join(dir, 'bad.fasta');
      writeFileSync(input, ';~a: 1\n;~checksum: x\n>s\nACGT\n');
      const output = join(dir, 'out.fasta');
      await assert.rejects(stripFileTo(input, output), (error) => error instanceof HeaderError && error.rule === 'R5');
      assert.equal(existsSync(output), false);
      assert.deepEqual(readdirSync(dir), ['bad.fasta']);
    });
  });

  it('writes a gzip input out uncompressed', async () => {
    await inTempDir(async (dir) => {
      const plain = buildRawFasta([...MINIMAL_FHR_LINES]);
      const input = join(dir, 'x.fasta.gz');
      writeFileSync(input, gzipSync(plain));
      await stripFileTo(input, join(dir, 'x.fasta'));
      assert.deepEqual(new Uint8Array(readFileSync(join(dir, 'x.fasta'))), new Uint8Array(stripBytes(plain, { container: 'fasta' })));
    });
  });
});

describe('a file over 2 GiB', () => {
  // A sparse file: the header, then 2 GiB + 1 MiB of zero bytes that take no disk
  // space. readFileSync refuses anything over 2 GiB, so before the single-pass
  // reader inspectFile could not open this file at all.
  const SIZE = 2 ** 31 + 2 ** 20;

  it('is read by inspectFile and inspectFileAsync, with its checksum verified', async () => {
    await inTempDir(async (dir) => {
      const lines = MINIMAL_FHR_LINES.map((line) => `;~${line}\n`);
      const withoutChecksum = Buffer.from(lines.filter((line) => !line.startsWith(';~checksum')).join(''));
      const hash = createHash('sha512-256').update(withoutChecksum);
      const zeros = Buffer.alloc(1 << 24);
      for (let left = SIZE - withoutChecksum.length; left > 0; left -= zeros.length) hash.update(left >= zeros.length ? zeros : zeros.subarray(0, left));
      const checksum = hash.digest('base64');
      const header = Buffer.from(lines.join('').replace(';~checksum: COMPUTE\n', `;~checksum: ${checksum}\n`));
      const path = join(dir, 'big.fasta');
      const fd = openSync(path, 'w');
      try {
        writeSync(fd, header);
        ftruncateSync(fd, SIZE - withoutChecksum.length + header.length);
      } finally {
        closeSync(fd);
      }
      const reading = inspectFile(path);
      assert.deepEqual(reading.errors, []);
      assert.equal(reading.checksum.computed, checksum);
      assert.equal(reading.valid, true);
      assert.deepEqual(await inspectFileAsync(path), reading);
    });
  });
});

describe('opening every draft lane does not index a sequence file', () => {
  // A FASTA or GFA body is never a GFF3 feature layer. With `{ drafts: true }`
  // the FHGM lane is open, but the file's own feature rows are only wanted for an
  // FHGFF3 header in a GFF3 file: a million sequence lines must not each become
  // a retained malformed-row diagnostic. Run in a child with a 64 MB heap.
  const script = `
    import { inspectStream } from './src/index.js';
    import { buildRawFasta, MINIMAL_FHR_LINES } from './testutil/fixtures.mjs';
    const drafts = JSON.parse(process.argv[1]);
    const bytes = buildRawFasta([...MINIMAL_FHR_LINES], '>seq1 synthetic fixture\\n' + 'A\\n'.repeat(1_000_000));
    async function* chunks() { for (let at = 0; at < bytes.length; at += 65536) yield bytes.subarray(at, at + 65536); }
    const reading = await inspectStream(chunks(), { container: 'fasta', drafts });
    process.stdout.write(JSON.stringify({ valid: reading.valid, errors: reading.errors, fhgm: 'fhgm' in reading }));
  `;
  for (const drafts of [['FHT'], true]) {
    it(`streams a 2 MB FASTA of one-base lines in a 64 MB heap with drafts: ${JSON.stringify(drafts)}`, () => {
      const run = spawnSync(process.execPath, ['--max-old-space-size=64', '--input-type=module', '-e', script, JSON.stringify(drafts)], { cwd: ROOT, encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr.slice(-2000));
      assert.deepEqual(JSON.parse(run.stdout), { valid: true, errors: [], fhgm: false });
    });
  }
});
