/**
 * The two-column feature-row index FHGM K4 resolves against (`src/features.js`).
 *
 * This file proves the scanner reads exactly the facts K4 needs and nothing
 * else: which identifier a row carries, which type a row declares, and whether
 * the layer can be trusted at all. It also pins the boundary - a row with the
 * wrong field count makes the index unusable rather than silently wrong, and
 * content below `##FASTA` is sequence, not features.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GENE_ROW_TYPES, indexGff3FeatureRows, isGeneRowType } from '../src/features.js';

const GENE = 'toy\tpilot\tgene\t10\t30\t.\t+\t.\tID=toy-a';
const RNA = 'toy\tpilot\tlncRNA\t10\t30\t.\t+\t.\tID=toy-a-rna;Parent=toy-a';
const EXON = 'toy\tpilot\texon\t10\t30\t.\t+\t.\tParent=toy-a-rna';

describe('indexGff3FeatureRows', () => {
  it('records the id and type of every ID-carrying row, in file order, escaped as written', () => {
    const index = indexGff3FeatureRows(['##gff-version 3', GENE, RNA, EXON].join('\n'));
    assert.deepEqual(index.problems, []);
    assert.deepEqual(index.rows, [
      { id: 'toy-a', type: 'gene', line: 2 },
      { id: 'toy-a-rna', type: 'lncRNA', line: 3 },
    ], 'the exon carries no ID and contributes no entry');
  });

  it('keeps percent escapes in the id: decoding is the K4 comparison step, not the scanner step', () => {
    const index = indexGff3FeatureRows('toy\tpilot\tgene\t10\t30\t.\t+\t.\tID=toy%2Da');
    assert.deepEqual(index.rows, [{ id: 'toy%2Da', type: 'gene', line: 1 }]);
  });

  it('stops at the ##FASTA line, skips directives, header lines and blanks, and survives CRLF', () => {
    const text = [
      '##gff-version 3',
      '#~schema: "https://w3id.org/fair-bioheaders/fhgff3/v0.5.0"',
      '#~checksum: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      '# a plain comment',
      '##sequence-region toy 1 100',
      '',
      `${GENE}\r`,
      '##FASTA',
      `${RNA.replace('toy-a-rna', 'toy-b-rna')}`,
    ].join('\n');
    const index = indexGff3FeatureRows(text);
    assert.deepEqual(index.problems, []);
    assert.deepEqual(index.rows, [{ id: 'toy-a', type: 'gene', line: 7 }], 'only the row above ##FASTA is a feature row, and the CR is not part of the id');
  });

  it('reports a row without nine fields as a problem and keeps scanning', () => {
    const index = indexGff3FeatureRows([GENE, 'toy\tpilot\tgene\t10\t30\t.', `${RNA}\textra`, GENE].join('\n'));
    assert.equal(index.rows.length, 2, 'only trustworthy rows are indexed; the short and the long row contribute nothing');
    assert.equal(index.problems.length, 2, 'the row with six fields and the row with ten are each reported');
    assert.match(index.problems[0], /line 2.*holds 6/);
    assert.match(index.problems[1], /line 3.*holds 10/);
  });

  it('refuses compressed bytes and non-content instead of mis-scanning them', () => {
    const gzipped = indexGff3FeatureRows(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]));
    assert.equal(gzipped.rows.length, 0);
    assert.match(gzipped.problems[0], /compressed/);
    assert.match(indexGff3FeatureRows(42).problems[0], /text or bytes/);
    assert.deepEqual(indexGff3FeatureRows(new TextEncoder().encode(`${GENE}\n`)).rows, [{ id: 'toy-a', type: 'gene', line: 1 }], 'decompressed bytes are the other honest input');
  });

  it('counts repeated ID attributes on one row the way the owning checker does', () => {
    const index = indexGff3FeatureRows('toy\tpilot\tgene\t10\t30\t.\t+\t.\tID=toy-a;ID=toy-a');
    assert.equal(index.rows.length, 2, 'GFF3 forbids it, but the index reports what the row says; feature-syntax judgment belongs to gff3-validator');
  });
});

describe('gene row types', () => {
  it('are the name and the SO accession, and nothing else', () => {
    assert.deepEqual([...GENE_ROW_TYPES], ['gene', 'SO:0000704']);
    assert.equal(isGeneRowType('gene'), true);
    assert.equal(isGeneRowType('SO:0000704'), true);
    assert.equal(isGeneRowType('mRNA'), false);
    assert.equal(isGeneRowType('lncRNA'), false);
    assert.equal(isGeneRowType('GENE'), false, 'the type field is case-sensitive: this index invents no equivalence');
  });
});
