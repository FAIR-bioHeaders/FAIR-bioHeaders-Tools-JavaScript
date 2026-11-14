/**
 * Tests for the byte-level header and checksum rules (R1-R7, R10, G1).
 *
 * These are unit tests of this library's own helpers. The acceptance test for
 * conformance is the shared vector suite, run by `npm run conformance`; see
 * `docs/CONFORMANCE.md`.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { computeChecksum, digest, findChecksumLine, headerText, sha512_256Available } from '../src/checksum.js';
import { assertNoByteOrderMark, headerLines, isGff3VersionLine, splitLines } from '../src/lines.js';

const bytes = (text) => new TextEncoder().encode(text);

/**
 * `Uint8Array.includes` searches for one element, not a subarray, so byte
 * substring checks need their own helper.
 *
 * @param {Uint8Array} haystack
 * @param {Uint8Array} needle
 * @returns {boolean}
 */
function containsBytes(haystack, needle) {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

const HEADER = [
  ';~genome: Synthetic',
  ';~taxon:',
  ';~  name: Homo sapiens',
  ';~version: 1.0.0',
].join('\n');

/**
 * @param {string[]} lines
 * @param {string} checksum
 * @returns {Uint8Array}
 */
function fasta(lines, checksum = 'A'.repeat(43) + '=') {
  return bytes([...lines, `;~checksum: ${checksum}`, '>Contig1', 'ACGT'].join('\n') + '\n');
}

describe('R1 line model', () => {
  it('ends a line at LF, CRLF, or a CR not followed by LF', () => {
    const data = bytes('a\r\nb\rc\nd');
    const ranges = splitLines(data).map(({ start, end }) => new TextDecoder().decode(data.subarray(start, end)));
    assert.deepEqual(ranges, ['a\r\n', 'b\r', 'c\n', 'd']);
  });

  it('keeps a final line with no terminator', () => {
    const data = bytes('a\nb');
    assert.equal(splitLines(data).length, 2);
  });
});

describe('R7 byte order mark', () => {
  it('refuses a leading BOM', () => {
    assert.throws(() => assertNoByteOrderMark(new Uint8Array([0xef, 0xbb, 0xbf, 0x3b])), /byte order mark/);
  });

  it('accepts a file without one', () => {
    assert.doesNotThrow(() => assertNoByteOrderMark(bytes(';~genome: x')));
  });
});

describe('R2 and R5 checksum line', () => {
  it('finds the single root-level line', () => {
    const data = fasta(HEADER.split('\n'));
    assert.equal(findChecksumLine(data, 'fasta').value, `${'A'.repeat(43)}=`);
  });

  it('refuses two root-level lines', () => {
    const data = fasta([...HEADER.split('\n'), `;~checksum: ${'B'.repeat(43)}=`]);
    assert.throws(() => findChecksumLine(data, 'fasta'), /exactly one root-level/);
  });

  it('refuses a missing line', () => {
    const data = bytes(`${HEADER}\n>Contig1\nACGT\n`);
    assert.throws(() => findChecksumLine(data, 'fasta'), /found 0/);
  });

  it('leaves a nested checksum line covered', () => {
    const nested = [...HEADER.split('\n'), ';~derivedFrom:', ";~  checksum: 'BBBB'", ';~  relationship: translatedFrom'];
    const data = fasta(nested);
    assert.equal(findChecksumLine(data, 'fasta').candidate.text.trim().startsWith('checksum'), true);
    assert.equal(findChecksumLine(data, 'fasta').value, `${'A'.repeat(43)}=`);
    // The nested line is part of the covered bytes.
    assert.ok(containsBytes(computeChecksum(data, 'fasta').covered, bytes("checksum: 'BBBB'")));
  });

  it('refuses a tab between the colon and the value', () => {
    const data = bytes(`${HEADER}\n;~checksum:\t${'A'.repeat(43)}=\n>Contig1\nACGT\n`);
    assert.throws(() => findChecksumLine(data, 'fasta'), /FORMAT.md R4 and R5/);
  });

  it('refuses a non-canonical base64 value', () => {
    // 42 chars then 'B' then '=': 'B' is not one of the canonical final letters.
    assert.throws(() => findChecksumLine(fasta(HEADER.split('\n'), `${'A'.repeat(42)}B=`), 'fasta'), /R4 and R5/);
    assert.doesNotThrow(() => findChecksumLine(fasta(HEADER.split('\n'), `${'A'.repeat(42)}I=`), 'fasta'));
  });

  it('accepts the value quoted, and with spaces before the colon', () => {
    assert.equal(findChecksumLine(fasta(HEADER.split('\n')), 'fasta').value, `${'A'.repeat(43)}=`);
    const quoted = bytes(`${HEADER}\n;~checksum : '${'A'.repeat(43)}='  \n>Contig1\nACGT\n`);
    assert.equal(findChecksumLine(quoted, 'fasta').value, `${'A'.repeat(43)}=`);
  });

  it('rejects a header line after the first record (R10)', () => {
    const data = bytes(`${HEADER}\n>Contig1\nACGT\n;~genome: late\n`);
    assert.throws(() => headerLines(data, 'fasta'), /R10/);
  });

  it('rejects a concatenated file (R10)', () => {
    const one = fasta(HEADER.split('\n'));
    const data = new Uint8Array([...one, ...one]);
    assert.throws(() => headerLines(data, 'fasta'), /R10/);
  });
});

describe('R6 header encoding', () => {
  it('refuses U+2028 in a header line', () => {
    const data = bytes(`${HEADER}\n;~documentation: a\u2028b\n;~checksum: ${'A'.repeat(43)}=\n>Contig1\nACGT\n`);
    assert.throws(() => headerLines(data, 'fasta'), /U\+0085, U\+2028 or U\+2029/);
  });

  it('refuses invalid UTF-8 in a header line', () => {
    const data = new Uint8Array([...bytes(`${HEADER}\n;~documentation: a`), 0xff, 0xfe, ...bytes(`b\n;~checksum: ${'A'.repeat(43)}=\n>Contig1\nACGT\n`)]);
    assert.throws(() => headerLines(data, 'fasta'), /not valid UTF-8/);
  });

  it('does not decode bytes outside the header', () => {
    const data = new Uint8Array([...bytes(`${HEADER}\n`), ...bytes(`;~checksum: ${'A'.repeat(43)}=\n`), ...bytes([0xff, 0xfe]), ...bytes('>Contig1\nACGT\n')]);
    assert.equal(headerLines(data, 'fasta').length, 5);
  });
});

describe('R4 digest', () => {
  it('uses SHA-512/256, not SHA-512 truncated or SHA-256', () => {
    const payload = bytes('ACGT');
    const sha512_256 = createHash('sha512-256').update(payload).digest('base64');
    assert.equal(digest(payload), sha512_256);
    assert.notEqual(digest(payload), createHash('sha512').update(payload).digest().subarray(0, 32).toString('base64'));
    assert.notEqual(digest(payload), createHash('sha256').update(payload).digest('base64'));
  });

  it('is available in this Node build', () => {
    assert.equal(sha512_256Available(), true);
  });
});

describe('R3 coverage', () => {
  it('excludes exactly the checksum line and its terminator', () => {
    const data = fasta(HEADER.split('\n'));
    const { covered } = computeChecksum(data, 'fasta');
    assert.equal(covered.includes(bytes('checksum')), false);
    assert.equal(data.length - covered.length, `;~checksum: ${'A'.repeat(43)}=\n`.length);
  });

  it('does not care where in the block the checksum line sits', () => {
    const last = fasta(HEADER.split('\n'));
    const first = bytes(`;~checksum: ${'A'.repeat(43)}=\n${HEADER}\n>Contig1\nACGT\n`);
    assert.equal(computeChecksum(last, 'fasta').computed, computeChecksum(first, 'fasta').computed);
  });
});

describe('G1 GFF3 version line', () => {
  it('accepts 3 and 3.MINOR.PATCH with trailing spaces or tabs', () => {
    for (const line of ['##gff-version 3', '##gff-version 3.1.26', '##gff-version 3\t', '##gff-version 3 ']) {
      assert.equal(isGff3VersionLine(line), true, line);
    }
  });

  it('refuses 30, 3x and 3.1', () => {
    for (const line of ['##gff-version 30', '##gff-version 3x', '##gff-version 3.1', '#~genome: x']) {
      assert.equal(isGff3VersionLine(line), false, line);
    }
  });

  it('ends the header block at ##FASTA', () => {
    const data = bytes(['##gff-version 3', '#~genome: x', '#~checksum: ' + 'A'.repeat(43) + '=', 'seq1\t.\tgene\t1\t2\t.\t+\t.\tID=g1', '##FASTA', '>seq1', 'ACGT'].join('\n') + '\n');
    assert.equal(headerLines(data, 'gff3').length, 2);
    const late = bytes(['##gff-version 3', 'seq1\t.\tgene\t1\t2\t.\t+\t.\tID=g1', '#~genome: late', '#~checksum: ' + 'A'.repeat(43) + '='].join('\n') + '\n');
    assert.throws(() => headerLines(late, 'gff3'), /R10/);
  });
});

describe('header text', () => {
  it('is the header lines with prefixes and terminators removed', () => {
    const data = fasta(HEADER.split('\n'));
    const expected = ['genome: Synthetic', 'taxon:', '  name: Homo sapiens', 'version: 1.0.0', `checksum: ${'A'.repeat(43)}=`].join('\n');
    assert.equal(headerText(data, 'fasta'), expected);
  });
});
