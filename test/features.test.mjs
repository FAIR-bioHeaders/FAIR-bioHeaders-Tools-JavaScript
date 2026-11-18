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

import { GENE_ROW_TYPES, MAX_LISTED_PROBLEMS, indexGff3FeatureRows, isGeneRowType } from '../src/features.js';

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

  it('lists the first malformed rows and only counts the rest, from text and from bytes alike', () => {
    const text = 'A\n'.repeat(1000);
    for (const source of [text, new TextEncoder().encode(text)]) {
      const index = indexGff3FeatureRows(source);
      assert.equal(index.problems.length, MAX_LISTED_PROBLEMS + 1, 'a malformed layer does not grow by one message per line');
      assert.match(index.problems[0], /line 1.*holds 1/);
      assert.match(index.problems[MAX_LISTED_PROBLEMS - 1], new RegExp(`line ${MAX_LISTED_PROBLEMS}\\b`));
      assert.equal(index.problems[MAX_LISTED_PROBLEMS], `${1000 - MAX_LISTED_PROBLEMS} further malformed lines are not listed`);
    }
  });

  it('refuses compressed bytes and non-content instead of mis-scanning them', () => {
    const gzipped = indexGff3FeatureRows(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]));
    assert.equal(gzipped.rows.length, 0);
    assert.match(gzipped.problems[0], /compressed/);
    assert.match(indexGff3FeatureRows(42).problems[0], /text or bytes/);
    assert.deepEqual(indexGff3FeatureRows(new TextEncoder().encode(`${GENE}\n`)).rows, [{ id: 'toy-a', type: 'gene', line: 1 }], 'decompressed bytes are the other honest input');
  });

  it('indexes only the first ID tag of a row, the way the owning checker does (#11, item 2-prime)', () => {
    // gff3-validator/checks/attributes.py keeps the first value of a repeated
    // tag (and reports the repeat itself as GFF-ATT-004, a syntax judgement
    // this index does not make), so features.py sees one identifier per row.
    // The parity fixture is repeated_id_tag.gff3: 'gene:A' -> found,
    // 'gene:B' -> not-found. The old version of this test pinned the divergent
    // behaviour and only ever used the same value twice (issue #11, 17:31
    // correction): a same-value repeat is exactly as unaddressable a second
    // identifier as a distinct one.
    const same = indexGff3FeatureRows('toy\tpilot\tgene\t10\t30\t.\t+\t.\tID=toy-a;ID=toy-a');
    assert.deepEqual(same.rows, [{ id: 'toy-a', type: 'gene', line: 1 }], 'a repeated tag with the same value is one entry, not a duplicate row');
    assert.deepEqual(same.problems, [], 'a repeated ID tag is a syntax question for gff3-validator, not a defect of this layer');

    const distinct = indexGff3FeatureRows('toy\tpilot\tgene\t10\t30\t.\t+\t.\tID=gene:A;ID=gene:B');
    assert.deepEqual(distinct.rows, [{ id: 'gene:A', type: 'gene', line: 1 }], 'the second, distinct ID tag is not an addressable identifier');

    const bytes = indexGff3FeatureRows(new TextEncoder().encode(`${'toy\tpilot\tgene\t10\t30\t.\t+\t.\tID=gene:A;ID=gene:B'}\n`));
    assert.deepEqual(bytes.rows, [{ id: 'gene:A', type: 'gene', line: 1 }], 'the bytes path shares the scanner and answers the same');
  });

  it('does not index an ID tag that carries no value (#11, item 3)', () => {
    // attributes.py sets `attributes.id` only `if "ID" in tags and tags["ID"]`:
    // an empty value is not an identifier. The parity fixture is
    // empty_id.gff3: '' -> not-found. Indexing it here gave a matching surface
    // no valid record can even name, and one the suite could not falsify.
    const bare = indexGff3FeatureRows('toy\tpilot\tgene\t10\t30\t.\t+\t.\tID=');
    assert.deepEqual(bare.rows, [], 'ID= contributes no entry');
    assert.deepEqual(bare.problems, [], 'an empty ID does not make the layer untrustworthy; it is simply no identifier');

    const mixed = indexGff3FeatureRows([GENE, 'toy\tpilot\tgene\t1\t9\t.\t+\t.\tID='].join('\n'));
    assert.deepEqual(mixed.rows, [{ id: 'toy-a', type: 'gene', line: 1 }], 'the empty ID on the second row contributes nothing beside the real one');

    const firstEmpty = indexGff3FeatureRows('toy\tpilot\tgene\t10\t30\t.\t+\t.\tID=;ID=x');
    assert.deepEqual(firstEmpty.rows, [], 'the first ID tag holds the slot even when empty: the oracle resolves x to not-found, so this must not fall through to the second tag');
  });

  it('counts feature rows separately from the ID entries they yield (#11, item 1)', () => {
    // K4 must be able to tell "the layer has no rows" (absent: abstain) from
    // "the rows carry no identifiers" (not-found: reject). The oracle's index
    // distinguishes them because its row list holds every feature row, with or
    // without an ID; this index records only ID-carrying entries, so the scan
    // itself has to carry the count.
    assert.equal(indexGff3FeatureRows('##gff-version 3\n#~schema: "x"\n').featureRows, 0, 'a header-only carrier has no feature layer');
    assert.equal(indexGff3FeatureRows(EXON).featureRows, 1, 'a row with no ID is still a feature row');
    assert.equal(indexGff3FeatureRows(`${GENE}\n${RNA}\n${EXON}`).featureRows, 3, 'three feature rows yield two ID entries and one count of three');
    assert.equal(indexGff3FeatureRows(`${GENE}\n##FASTA\n${GENE}`).featureRows, 1, 'nothing below ##FASTA is a feature row');
    assert.equal(indexGff3FeatureRows(new TextEncoder().encode(`${GENE}\n${EXON}\n`)).featureRows, 2, 'the bytes path counts the same way');
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
