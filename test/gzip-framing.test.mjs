/** R1 complete-member and final-NUL padding controls; all fixtures are private. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';
import { describe, it, mock } from 'node:test';
import { decompress, inspectBytes, inspectFile, inspectFileAsync, inspectStream, stripBytes, stripFile, stripFileTo } from '../src/reader.js';
import { MINIMAL_FHR_LINES, buildRawFasta } from '../testutil/fixtures.mjs';

const plain = Buffer.from(buildRawFasta([...MINIMAL_FHR_LINES], '>c1 synthetic\nACGT\n'));
const member = gzipSync(plain);
const zeros = Buffer.alloc(4);
const r1 = (error) => error?.rule === 'R1' && /invalid gzip or BGZF input/.test(error.message);
async function* chunks(bytes, size) {
  for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
}
async function inDir(body) {
  const dir = mkdtempSync(join(tmpdir(), 'fhr-gzip-framing-'));
  try { await body(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const corruptedCrc = Buffer.from(member); corruptedCrc[corruptedCrc.length - 8] ^= 1;
const corruptedSize = Buffer.from(member); corruptedSize[corruptedSize.length - 4] ^= 1;
const invalid = {
  'NUL then garbage': Buffer.concat([member, zeros, Buffer.from('JUNK')]),
  'NUL then another member': Buffer.concat([member, zeros, gzipSync(Buffer.from('>hidden\nTTTT\n'))]),
  'direct trailing garbage': Buffer.concat([member, Buffer.from('JUNK')]),
  'truncated header': member.subarray(0, 5),
  'truncated deflate data': member.subarray(0, Math.floor(member.length / 2)),
  'truncated trailer': member.subarray(0, -2),
  'corrupt CRC': corruptedCrc,
  'corrupt ISIZE': corruptedSize,
};
describe('R1 gzip framing', () => {
  for (const [label, bytes] of Object.entries(invalid)) {
    it(`rejects ${label} across memory, file, stream and strip APIs`, { timeout: 15000 }, async () => {
      assert.throws(() => decompress(bytes), r1);
      assert.throws(() => stripBytes(bytes, { container: 'fasta' }), r1);
      const memory = inspectBytes(bytes, { container: 'fasta' });
      assert.equal(memory.valid, false);
      assert.match(memory.errors[0], /^R1: invalid gzip or BGZF input/);
      for (const size of [1, 7, 65536]) {
        const stream = await inspectStream(chunks(bytes, size), { container: 'fasta' });
        assert.equal(stream.valid, false, `${label}, chunks ${size}`);
        assert.match(stream.errors[0], /^R1: invalid gzip or BGZF input/);
      }
      await inDir(async (dir) => {
        const input = join(dir, 'input.fasta.gz'); const output = join(dir, 'output.fasta');
        writeFileSync(input, bytes); writeFileSync(output, 'existing destination');
        assert.equal(inspectFile(input).valid, false);
        assert.equal((await inspectFileAsync(input)).valid, false);
        assert.throws(() => stripFile(input), r1);
        await assert.rejects(stripFileTo(input, output), r1);
        assert.equal(readFileSync(output, 'utf8'), 'existing destination');
        assert.deepEqual(readdirSync(dir).sort(), ['input.fasta.gz', 'output.fasta']);
      });
    });
  }
  it('keeps complete concatenated members and final all-NUL padding valid', async () => {
    const split = Math.floor(plain.length / 2);
    const multiple = Buffer.concat([gzipSync(plain.subarray(0, split)), gzipSync(plain.subarray(split))]);
    for (const bytes of [member, multiple, Buffer.concat([member, zeros]), Buffer.concat([multiple, zeros])]) {
      assert.deepEqual(Buffer.from(decompress(bytes)), plain);
      assert.equal(inspectBytes(bytes, { container: 'fasta' }).valid, true);
      for (const size of [1, 7, 65536]) assert.equal((await inspectStream(chunks(bytes, size), { container: 'fasta' })).valid, true);
      await inDir(async (dir) => {
        const input = join(dir, 'input.fasta.gz'); const output = join(dir, 'output.fasta');
        writeFileSync(input, bytes);
        assert.equal(inspectFile(input).valid, true);
        assert.equal((await inspectFileAsync(input)).valid, true);
        await stripFileTo(input, output);
        assert.deepEqual(readFileSync(output), Buffer.from(stripBytes(plain, { container: 'fasta' })));
      });
    }
  });
  it('retains the aggregate in-memory decompression bound over multiple members', () => {
    const bytes = Buffer.concat([gzipSync(Buffer.alloc(70000, 65)), gzipSync(Buffer.alloc(70000, 66))]);
    assert.throws(() => decompress(bytes, { maxDecompressedBytes: 100000 }), (error) => error.rule === 'limits');
  });
  it('drains the compressed source after NUL padding and reports a late source failure', async () => {
    let closed = false;
    async function* source() {
      try { yield member; yield zeros; await setImmediate(); throw new Error('late compressed-source failure'); }
      finally { closed = true; }
    }
    await assert.rejects(inspectStream(source(), { container: 'fasta' }), /late compressed-source failure/);
    assert.equal(closed, true);
  });
  it('drains one million tiny padding chunks within a bounded child-process heap', { timeout: 45000 }, () => {
    const reader = new URL('../src/reader.js', import.meta.url).href;
    const fixture = new URL('../testutil/fixtures.mjs', import.meta.url).href;
    const script = `
      import { gzipSync } from 'node:zlib';
      import { inspectStream } from ${JSON.stringify(reader)};
      import { MINIMAL_FHR_LINES, buildRawFasta } from ${JSON.stringify(fixture)};
      const compressed = gzipSync(buildRawFasta([...MINIMAL_FHR_LINES], '>c1\\nACGT\\n'));
      const zero = new Uint8Array([0]); let sent = 0;
      async function* source() { yield compressed; for (; sent < 1048576; sent++) yield zero; }
      const result = await inspectStream(source(), { container: 'fasta' });
      console.log(JSON.stringify({valid: result.valid, sent}));
    `;
    const child = spawnSync(process.execPath, ['--max-old-space-size=128', '--input-type=module', '-e', script], {
      encoding: 'utf8', timeout: 40000, maxBuffer: 1 << 20,
    });
    assert.equal(child.status, 0, `child failed: ${child.signal} ${child.error ?? ''} ${child.stderr}`);
    assert.deepEqual(JSON.parse(child.stdout.trim()), { valid: true, sent: 1048576 });
  });

  it('cancels a pending source next before waiting for its producer after a write failure', { timeout: 5000 }, async () => {
    await inDir(async (dir) => {
      const originalOpen = fsPromises.open;
      let signalPending; let failWrite; let returned = false; let destroyed = false;
      const pending = new Promise((resolve) => { signalPending = resolve; });
      const gate = new Promise((resolve, reject) => { failWrite = () => reject(new Error('blocked destination failure')); });
      let first = true;
      const source = {
        [Symbol.asyncIterator]() { return this; },
        next() {
          if (first) { first = false; return Promise.resolve({ done: false, value: member }); }
          signalPending();
          return new Promise(() => {}); // return can cancel even while next is pending
        },
        return() { returned = true; return Promise.resolve({ done: true }); },
        destroy() { destroyed = true; },
      };
      mock.method(fs, 'createReadStream', () => source);
      mock.method(fsPromises, 'open', async (...args) => {
        const handle = await originalOpen(...args);
        handle.write = async () => gate;
        return handle;
      });
      syncBuiltinESMExports();
      try {
        const output = join(dir, 'output.fasta'); writeFileSync(output, 'existing destination');
        const work = stripFileTo(join(dir, 'synthetic.fasta.gz'), output);
        await pending;
        failWrite();
        await assert.rejects(work, /blocked destination failure/);
        assert.equal(returned, true);
        assert.equal(destroyed, true);
        assert.equal(readFileSync(output, 'utf8'), 'existing destination');
        assert.deepEqual(readdirSync(dir), ['output.fasta']);
      } finally { mock.restoreAll(); syncBuiltinESMExports(); }
    });
  });

  it('backpressures compressed input behind a blocked output write and cleans up a failed write', { timeout: 15000 }, async () => {
    const dna = randomBytes(1 << 20).map((byte) => 'ACGT'.charCodeAt(byte & 3));
    const payload = Buffer.concat([Buffer.from('>large\n'), dna, Buffer.from('\n')]);
    const bytes = gzipSync(buildRawFasta([...MINIMAL_FHR_LINES], payload.toString()));
    const size = 4096; const total = Math.ceil(bytes.length / size);
    assert.ok(total > 4, 'positive control must need more than the stream buffers');
    await inDir(async (dir) => {
      const originalOpen = fsPromises.open;
      let sent = 0; let sourceClosed = false; let signalWrite; let releaseWrite;
      const reachedWrite = new Promise((resolve) => { signalWrite = resolve; });
      const gate = new Promise((resolve) => { releaseWrite = resolve; });
      let block = true; let failWrite = false;
      mock.method(fs, 'createReadStream', () => Readable.from((async function* () {
        try { for (const part of chunksSync(bytes, size)) { sent += 1; yield part; } }
        finally { sourceClosed = true; }
      })(), { objectMode: false, highWaterMark: size }));
      mock.method(fsPromises, 'open', async (...args) => {
        const handle = await originalOpen(...args); const write = handle.write.bind(handle);
        handle.write = async (...data) => {
          if (block) { block = false; signalWrite(); await gate; }
          if (failWrite) throw new Error('synthetic destination write failure');
          return write(...data);
        };
        return handle;
      });
      syncBuiltinESMExports();
      try {
        const output = join(dir, 'output.fasta');
        const work = stripFileTo(join(dir, 'synthetic.fasta.gz'), output);
        await reachedWrite; await setImmediate();
        assert.ok(sent < total, `producer must wait for output, read ${sent}/${total}`);
        releaseWrite(); await work;
        assert.deepEqual(readFileSync(output), payload);
        assert.equal(sourceClosed, true);
        sourceClosed = false; failWrite = true;
        writeFileSync(output, 'existing destination');
        await assert.rejects(stripFileTo(join(dir, 'synthetic.fasta.gz'), output), /synthetic destination write failure/);
        assert.equal(sourceClosed, true);
        assert.equal(readFileSync(output, 'utf8'), 'existing destination');
        assert.deepEqual(readdirSync(dir), ['output.fasta']);
      } finally { releaseWrite(); mock.restoreAll(); syncBuiltinESMExports(); }
    });
  });
});
function* chunksSync(bytes, size) {
  for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
}
