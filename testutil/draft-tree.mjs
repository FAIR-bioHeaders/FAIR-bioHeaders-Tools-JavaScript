/**
 * A throwaway copy of this build whose draft registry states something else.
 *
 * Why a copy, and not a `--registry` flag or a setter: `src/drafts.js` reads
 * `drafts/provenance.json` once, at import, and that import-time read *is* the
 * behaviour under test - a pin the module could be told about later is a different
 * design. Handing the tests a second tree keeps the production path free of any
 * injection point while still letting a test say "suppose this registry stated no
 * suite pin for FHGM", which is the one situation the `UNPINNED` label exists for
 * and which this build's own registry no longer exhibits now that both drafts are
 * pinned. Without it, those branches would be code no test can reach.
 *
 * Nothing here writes to the repository: the copy goes to a temporary directory and
 * the caller deletes it. `src/` and `scripts/` are copied as real files, not
 * symlinks - Node resolves a module's own URL to its real path, so a symlinked `src`
 * would put `DRAFT_DIR` back on the repository's own `drafts/` and the test would
 * quietly check nothing.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The parts of the tree a draft-lane reading needs: the library, the tooling, the released schemas. */
const COPIED = ['src', 'scripts', 'schemas'];

/**
 * Build the copy.
 *
 * @param {(registry: object) => void} [mutate] edits applied to `drafts/provenance.json`
 *   in the copy; the repository's own file is only ever read
 * @returns {{dir: string, registry: object, load: (relative: string) => Promise<object>}}
 *   `load` imports a module *from the copy*, so it sees the copy's registry
 */
export function draftTreeWith(mutate = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fhr-draft-tree-'));
  for (const part of COPIED) cpSync(join(ROOT, part), join(dir, part), { recursive: true });
  // `"type": "module"` lives here, and without it `src/*.js` loads as CommonJS - a copy
  // that fails for that reason would test the fixture harness, not the lane.
  cpSync(join(ROOT, 'package.json'), join(dir, 'package.json'));
  // Dependencies are the one part that is linked rather than copied: `ajv` is resolved by
  // package lookup from the importing file, so a link is enough, and copying node_modules
  // to answer one lookup would make the fixture slower than what it proves.
  if (!existsSync(join(ROOT, 'node_modules'))) {
    throw new Error('testutil/draft-tree.mjs: this checkout has no node_modules, so a lane run from a fixture copy cannot resolve ajv; run `npm ci --ignore-scripts` first');
  }
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir');
  const registry = JSON.parse(readFileSync(join(ROOT, 'drafts', 'provenance.json'), 'utf8'));
  mutate(registry);
  mkdirSync(join(dir, 'drafts'), { recursive: true });
  writeFileSync(join(dir, 'drafts', 'provenance.json'), `${JSON.stringify(registry, null, 2)}\n`);
  // The bytes the registry names have to be there too, or a load fails for the wrong
  // reason. They are copied unmodified: this fixture is about the registry, not the bytes.
  for (const row of Object.values(registry.drafts)) {
    cpSync(join(ROOT, 'drafts', row.file), join(dir, 'drafts', row.file));
    if (row.transportOverlay !== undefined) cpSync(join(ROOT, 'drafts', row.transportOverlay.file), join(dir, 'drafts', row.transportOverlay.file));
  }
  return {
    dir,
    registry,
    load: (relative) => import(pathToFileURL(join(dir, relative)).href),
  };
}

/**
 * @param {{dir: string}} tree
 */
export function removeDraftTree(tree) {
  // Unlink the dependency link first, so the recursive removal can never be read as a
  // walk into the repository's own node_modules.
  unlinkSync(join(tree.dir, 'node_modules'));
  rmSync(tree.dir, { recursive: true, force: true });
}
