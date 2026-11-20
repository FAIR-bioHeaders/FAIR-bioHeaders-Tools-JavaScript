/** The real CI-output command rejects malformed pin data before writing any key. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { draftTreeWith, removeDraftTree } from '../testutil/draft-tree.mjs';

function command(mutate) {
  const tree = draftTreeWith(mutate);
  try {
    const output = join(tree.dir, 'github-output.txt');
    writeFileSync(output, 'existing=sentinel\n');
    const result = spawnSync(process.execPath, [join(tree.dir, 'scripts/ci/draft-pins.mjs'), '--github-output'], {
      cwd: tree.dir, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output },
    });
    return { ...result, output: readFileSync(output, 'utf8') };
  } finally { removeDraftTree(tree); }
}
describe('CI pin output validation', () => {
  it('emits complete valid pins and appends to the GitHub output file', () => {
    const result = command(() => {});
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^fht-repo=FHT-Specification$/m);
    assert.match(result.stdout, /^fhgm-repo=FHGM-Specification$/m);
    for (const type of ['fht', 'fhgm']) {
      assert.match(result.stdout, new RegExp(`^${type}-commit=[0-9a-f]{40}$`, 'm'));
      assert.match(result.stdout, new RegExp(`^${type}-suite-commit=[0-9a-f]{40}$`, 'm'));
    }
    assert.equal(result.output, `existing=sentinel\n${result.stdout}`);
  });
  const invalid = {
    'unexpected repository': (p) => { p.drafts.FHGM.repository = 'Other-Repository'; },
    'repository path traversal': (p) => { p.drafts.FHT.repository = '../other'; },
    'contract option as revision': (p) => { p.drafts.FHT.commit = '--orphan=bad'; },
    'nonhex suite revision': (p) => { p.drafts.FHGM.suiteCommit = 'z'.repeat(40); },
    'missing suite revision': (p) => { delete p.drafts.FHGM.suiteCommit; },
    'newline output injection': (p) => { p.drafts.FHGM.sourcePath = 'file.json\nfht-commit=forged'; },
    'escaping suite path': (p) => { p.drafts.FHGM.suiteManifest = '../outside.json'; },
    'malformed contract digest': (p) => { p.drafts.FHT.sha256 = 'bad'; },
  };
  for (const [name, mutate] of Object.entries(invalid)) {
    it(`refuses ${name} before emitting any output`, () => {
      const result = command(mutate);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /github-output/);
      assert.equal(result.stdout, '');
      assert.equal(result.output, 'existing=sentinel\n');
    });
  }
});
