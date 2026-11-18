/**
 * Tests for the file-level reader: what a caller sees when a file is checked,
 * and what `strip` leaves behind.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, it } from 'node:test';

import { computeChecksum } from '../src/checksum.js';
import { containerOf, inspectBytes, inspectFile, stripBytes } from '../src/reader.js';
import { MINIMAL_FHR_LINES, buildFhgff3File, buildRawFasta, buildSequenceFile, fhgmHeader, fhtRecord } from '../testutil/fixtures.mjs';

const bytes = (text) => new TextEncoder().encode(text);

/**
 * A complete, self-consistent FHR FASTA file. The checksum is recomputed by the
 * helper below, so these fixtures never state a digest by hand.
 *
 * @param {object} [options]
 * @param {string[]} [options.header] header lines, without the `;~` prefix
 * @param {string} [options.data] payload after the header block
 * @param {string} [options.ending] line terminator
 * @returns {Uint8Array}
 */
function fhrFile(options = {}) {
  const ending = options.ending ?? '\n';
  const header = options.header ?? [
    'schema: https://w3id.org/fair-bioheaders/fhr/v0.6.0',
    "schemaVersion: '2.1'",
    'genome: Fixture genome (not a real assembly)',
    'taxon:',
    '  name: Homo sapiens',
    "version: '1.0.0'",
    'metadataAuthor:',
    '- name: Fixture author (not a real person)',
    'assemblyAuthor:',
    '- name: Fixture author (not a real person)',
    "dateCreated: '2026-11-14'",
    'masking: not-masked',
  ];
  const data = options.data ?? '>Contig1 fixture\nACGTACGTAC\nGGTTAACCAT\n';
  const body = [...header, `checksum: ${'A'.repeat(43)}=`].map((line) => (line.startsWith(';~') || line.startsWith('#~') ? line : `;~${line}`)).join(ending) + ending + data;
  const draft = bytes(body);
  // The checksum line is excluded from the covered bytes and the placeholder is
  // the same 44 characters as the value that replaces it, so substituting it
  // after the digest is computed leaves the covered bytes untouched.
  const { computed } = computeChecksum(draft, 'fasta');
  return bytes(new TextDecoder().decode(draft).replace(`${'A'.repeat(43)}=`, computed));
}

describe('containerOf', () => {
  it('reads the container from the name, through the compression transport', () => {
    assert.equal(containerOf('genome.fhr.fasta'), 'fasta');
    assert.equal(containerOf('proteins.fhp.fasta'), 'fasta');
    assert.equal(containerOf('assembly.gfa'), 'gfa');
    assert.equal(containerOf('annotations.fhgff3.gff3'), 'gff3');
    assert.equal(containerOf('annotations.fhgff3.gff3.gz'), 'gff3');
    assert.equal(containerOf('x.bgz'.replace('x.bgz', 'genome.fna.bgz')), 'fasta');
    assert.equal(containerOf('proteins.fhp.faa'), 'fasta');
    assert.equal(containerOf('proteins.FAA.gz'), 'fasta');
    assert.equal(containerOf('annotations.fhgff3.gff'), 'gff3');
    assert.equal(containerOf('annotations.gff.bgz'), 'gff3');
    assert.throws(() => containerOf('annotations.gf'));
    assert.throws(() => containerOf('README.md'));
  });
});

describe('inspectBytes', () => {
  it('accepts a self-consistent FHR FASTA file and reports the contract it used', () => {
    const reading = inspectBytes(fhrFile(), { container: 'fasta' });
    assert.equal(reading.valid, true, JSON.stringify(reading.errors));
    assert.equal(reading.checksum.matches, true);
    assert.equal(reading.schema.type, 'FHR');
    assert.equal(reading.schema.release, 'v0.6.0');
    assert.equal(reading.schema.rule, 'V3');
    assert.equal(reading.metadata.genome, 'Fixture genome (not a real assembly)');
  });

  it('survives CRLF, and a checksum computed after normalising the endings does not match (R1)', () => {
    const crlf = fhrFile({ ending: '\r\n', data: '>Contig1 fixture\r\nACGTACGTAC\r\n' });
    const original = inspectBytes(crlf, { container: 'fasta' });
    assert.equal(original.valid, true, JSON.stringify(original.errors));
    const normalised = bytes(new TextDecoder().decode(crlf).replaceAll('\r\n', '\n'));
    const rewritten = inspectBytes(normalised, { container: 'fasta' });
    assert.equal(rewritten.valid, false);
    assert.match(rewritten.errors.join(' '), /checksum mismatch/);
  });

  it('reads gzip and BGZF transport as the same content (R1)', () => {
    const plain = fhrFile();
    const gz = new Uint8Array(gzipSync(plain));
    const reading = inspectBytes(gz, { container: 'fasta' });
    assert.equal(reading.valid, true, JSON.stringify(reading.errors));
    assert.equal(reading.checksum.computed, inspectBytes(plain, { container: 'fasta' }).checksum.computed);
  });

  it('reports a tampered byte instead of validating it', () => {
    const file = fhrFile();
    const tampered = new Uint8Array(file);
    tampered[tampered.length - 3] = tampered[tampered.length - 3] === 0x41 ? 0x42 : 0x41; // a residue
    const reading = inspectBytes(tampered, { container: 'fasta' });
    assert.equal(reading.valid, false);
    assert.match(reading.errors.join(' '), /checksum mismatch/);
  });

  it('refuses a header line after the first record', () => {
    const file = new Uint8Array([...fhrFile(), ...bytes(';~genome: late\n')]);
    const reading = inspectBytes(file, { container: 'fasta' });
    assert.equal(reading.valid, false);
    assert.match(reading.errors.join(' '), /R10/);
  });

  it('refuses a byte order mark and reports it as R7', () => {
    const file = new Uint8Array([0xef, 0xbb, 0xbf, ...fhrFile()]);
    const reading = inspectBytes(file, { container: 'fasta' });
    assert.equal(reading.valid, false);
    assert.match(reading.errors.join(' '), /byte order mark/);
  });

  it('reports an unavailable contract as unsupported-version, never as a schema failure', () => {
    const file = fhrFile({
      header: [
        'schema: https://w3id.org/fair-bioheaders/fhr/v0.0.0',
        "schemaVersion: '2.1'",
        'genome: Fixture genome (not a real assembly)',
        'taxon:',
        '  name: Homo sapiens',
        "version: '1.0.0'",
        'metadataAuthor:',
        '- name: Fixture author (not a real person)',
        "dateCreated: '2026-11-14'",
        'masking: not-masked',
      ],
    });
    const reading = inspectBytes(file, { container: 'fasta' });
    assert.equal(reading.valid, false);
    assert.equal(reading.schema.rule, 'V4');
    assert.match(reading.errors.join(' '), /unsupported schema version/);
  });

  it('warns about a raw > in a FASTA header and still accepts the file (R11)', () => {
    const file = fhrFile({
      header: [
        'schema: https://w3id.org/fair-bioheaders/fhr/v0.6.0',
        "schemaVersion: '2.1'",
        'genome: Fixture genome (not a real assembly)',
        'taxon:',
        '  name: Homo sapiens',
        "version: '1.0.0'",
        'metadataAuthor:',
        '- name: Fixture author (not a real person)',
        'assemblyAuthor:',
        '- name: Fixture author (not a real person)',
        "dateCreated: '2026-11-14'",
        'masking: not-masked',
        'documentation: contigs > 1000 bp',
      ],
    });
    const reading = inspectBytes(file, { container: 'fasta' });
    assert.equal(reading.valid, true, JSON.stringify(reading.errors));
    assert.ok(reading.warnings.some((line) => line.includes('R11')));
  });

  it('refuses a GFF3 header before ##gff-version 3 (G1)', () => {
    const file = bytes(`#~genome: x\n##gff-version 3\n#~checksum: ${'A'.repeat(43)}=\n`);
    const reading = inspectBytes(file, { container: 'gff3' });
    assert.equal(reading.valid, false);
    assert.match(reading.errors.join(' '), /G1/);
  });

  it('refuses a FHP record that cites the FHR contract (P2)', () => {
    const file = fhrFile({
      header: [
        'schema: https://w3id.org/fair-bioheaders/fhr/v0.6.0',
        "schemaVersion: '2.1'",
        'proteome: Fixture proteome',
        'sourceType: predicted',
        'taxon:',
        '  name: Homo sapiens',
        "version: '1.0.0'",
        'metadataAuthor:',
        '- name: Fixture author (not a real person)',
        "dateCreated: '2026-11-14'",
        'masking: not-masked',
      ],
    });
    const reading = inspectBytes(file, { container: 'fasta' });
    assert.equal(reading.valid, false);
    assert.match(reading.errors.join(' '), /genome|required/);
  });
});

describe('plain scalars ending in .nan or .inf', () => {
  it('reads release.nan and see build.NaN as strings, and the file stays valid', () => {
    const lines = MINIMAL_FHR_LINES.filter((line) => line !== 'checksum: COMPUTE');
    const data = buildRawFasta([...lines, 'documentation: see build.NaN', 'x-build: release.nan', 'x-other: run.inf', 'checksum: COMPUTE']);
    const reading = inspectBytes(data, { container: 'fasta' });
    assert.deepEqual(reading.errors, []);
    assert.equal(reading.valid, true);
    assert.equal(reading.metadata['x-build'], 'release.nan');
    assert.equal(reading.metadata.documentation, 'see build.NaN');
  });

  it('still refuses a bare .nan (R13)', () => {
    const lines = MINIMAL_FHR_LINES.filter((line) => line !== 'checksum: COMPUTE');
    const reading = inspectBytes(buildRawFasta([...lines, 'x-build: .nan', 'checksum: COMPUTE']), { container: 'fasta' });
    assert.equal(reading.valid, false);
    assert.match(reading.errors.join(' '), /R13/);
  });
});

describe('R11 on comment lines', () => {
  const lines = MINIMAL_FHR_LINES.filter((line) => line !== 'checksum: COMPUTE');
  it('warns about a raw > or @ in a ;~# comment, and the file stays valid', () => {
    const reading = inspectBytes(buildRawFasta([...lines, '# mail a@example.org', '  # see > here', 'checksum: COMPUTE']), { container: 'fasta' });
    assert.equal(reading.valid, true, JSON.stringify(reading.errors));
    const r11 = reading.warnings.filter((line) => line.startsWith('R11'));
    assert.equal(r11.length, 2, JSON.stringify(reading.warnings));
    assert.match(r11[0], /comment on header line 13/);
    assert.match(r11[1], /comment on header line 14/);
  });

  it('says nothing about a comment without them, or about a GFA comment', () => {
    const reading = inspectBytes(buildRawFasta([...lines, '# plain comment', 'checksum: COMPUTE']), { container: 'fasta' });
    assert.deepEqual(reading.warnings.filter((line) => line.startsWith('R11')), []);
  });
});

describe('inspectFile options', () => {
  it('passes drafts through, so the V7 lane opens for a file on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fhb-'));
    try {
      const path = join(dir, 'rna.fht.fasta');
      writeFileSync(path, buildSequenceFile(fhtRecord()).bytes);
      assert.equal(inspectFile(path).schema.rule, 'V5', 'lane shut by default');
      const reading = inspectFile(path, { drafts: ['FHT'] });
      assert.equal(reading.schema.rule, 'V7');
      assert.equal(reading.schema.type, 'FHT');
      assert.deepEqual(reading, inspectBytes(readFileSync(path), { container: 'fasta', drafts: ['FHT'] }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes fhgm through, so the FHGM verdict appears for a file on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fhb-'));
    try {
      const path = join(dir, 'models.fhgff3.gff3');
      writeFileSync(path, buildFhgff3File(fhgmHeader()).bytes);
      assert.equal(inspectFile(path).fhgm, undefined);
      const reading = inspectFile(path, { drafts: ['FHGM'], fhgm: { features: null } });
      assert.equal(typeof reading.fhgm, 'object');
      assert.deepEqual(reading, inspectBytes(readFileSync(path), { container: 'gff3', drafts: ['FHGM'], fhgm: { features: null } }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes parents through to the C3 check', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fhb-'));
    try {
      const parent = buildSequenceFile({ ...fhtRecord({ transcriptome: 'Synthetic parent transcript set' }), schemaVersion: '1.0' });
      const child = buildSequenceFile(fhtRecord({ derivedFrom: [{ headerType: 'FHT', checksum: parent.checksum, relationship: 'filteredFrom' }] }));
      const path = join(dir, 'child.fht.fasta');
      writeFileSync(path, child.bytes);
      assert.equal(inspectFile(path, { drafts: ['FHT'] }).parentLinks.links[0].verdict, 'unchecked');
      let asked = 0;
      const reading = inspectFile(path, { drafts: ['FHT'], parents: () => { asked += 1; return { bytes: parent.bytes }; } });
      assert.ok(asked > 0, 'the resolver handed to inspectFile must be called');
      assert.equal(reading.parentLinks.links[0].verdict, 'checked-pass');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('stripBytes', () => {
  it('removes the header lines and keeps every other byte', () => {
    const data = fhrFile();
    const stripped = stripBytes(data, { container: 'fasta' });
    const text = new TextDecoder().decode(stripped);
    assert.equal(text.includes(';~'), false);
    assert.equal(text, '>Contig1 fixture\nACGTACGTAC\nGGTTAACCAT\n');
    assert.ok(stripped.length < data.length);
  });

  it('keeps ordinary comments and blank lines where they were (R10)', () => {
    const data = fhrFile({ data: '; an ordinary comment\n\n>Contig1 fixture\nACGT\n' });
    const text = new TextDecoder().decode(stripBytes(data, { container: 'fasta' }));
    assert.equal(text, '; an ordinary comment\n\n>Contig1 fixture\nACGT\n');
  });

  it('keeps the GFF3 version line and directives, and only removes #~ lines', () => {
    const gff3 = [
      '##gff-version 3',
      '#~schema: https://w3id.org/fair-bioheaders/fhgff3/v0.6.0',
      '#~checksum: ' + `${'A'.repeat(43)}=`,
      '##sequence-region seq1 1 4',
      'seq1\t.\tgene\t1\t4\t.\t+\t.\tID=g1',
    ].join('\n');
    const bytes2 = computeChecksum(bytes(gff3), 'gff3');
    const file = bytes(gff3.replace(`${'A'.repeat(43)}=`, bytes2.computed));
    const text = new TextDecoder().decode(stripBytes(file, { container: 'gff3' }));
    assert.equal(text, ['##gff-version 3', '##sequence-region seq1 1 4', 'seq1\t.\tgene\t1\t4\t.\t+\t.\tID=g1'].join('\n'));
  });

  it('works on a file whose contract this build does not have', () => {
    const file = fhrFile({
      header: [
        'schema: https://w3id.org/fair-bioheaders/fhr/v0.0.0',
        "schemaVersion: '2.1'",
        'genome: Fixture genome (not a real assembly)',
        'taxon:',
        '  name: Homo sapiens',
        "version: '1.0.0'",
        'metadataAuthor:',
        '- name: Fixture author (not a real person)',
        "dateCreated: '2026-11-14'",
        'masking: not-masked',
      ],
    });
    const stripped = stripBytes(file, { container: 'fasta' });
    assert.equal(new TextDecoder().decode(stripped).includes(';~'), false);
  });

  it('decompresses gzip transport and returns plain bytes', () => {
    const stripped = stripBytes(new Uint8Array(gzipSync(fhrFile())), { container: 'fasta' });
    assert.equal(new TextDecoder().decode(stripped), '>Contig1 fixture\nACGTACGTAC\nGGTTAACCAT\n');
  });
});
