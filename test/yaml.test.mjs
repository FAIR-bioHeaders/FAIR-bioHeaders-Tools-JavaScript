/**
 * Tests for the YAML stage: R8, R12, R13 and the reader limits.
 *
 * `scripts/capability/yaml-portability-differential.mjs` compares the same
 * reader against the released Python toolkit over a large scalar corpus; these
 * tests pin the behaviour this library promises locally, without a Python.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HeaderError } from '../src/errors.js';
import { loadHeaderYaml } from '../src/yaml.js';
import { plainScalarIsPortable, plainScalarOverflows, resolveCore, resolveYaml11 } from '../src/scalars.js';

describe('R12 plain-scalar resolution', () => {
  it('reads the YAML 1.2 core types', () => {
    assert.equal(resolveCore('10').tag, 'int');
    assert.equal(resolveCore('10').value, 10n);
    assert.equal(resolveCore('010').value, 10n);
    assert.equal(resolveCore('0o17').value, 15n);
    assert.equal(resolveCore('0x1f').value, 31n);
    assert.equal(resolveCore('1.5').tag, 'float');
    assert.equal(resolveCore('1e3').tag, 'float');
    assert.equal(resolveCore('yes').tag, 'str');
    assert.equal(resolveCore('true').tag, 'bool');
    assert.equal(resolveCore('2026-10-11').tag, 'str');
    assert.equal(resolveCore('~').tag, 'null');
  });

  it('reads the YAML 1.1 types the toolkit compares against', () => {
    assert.equal(resolveYaml11('010').value, 8n); // octal channel
    assert.equal(resolveYaml11('0b101').value, 5n);
    assert.equal(resolveYaml11('1_000').value, 1000n);
    assert.equal(resolveYaml11('1:30').value, 90n); // sexagesimal
    assert.equal(resolveYaml11('yes').tag, 'bool');
    assert.equal(resolveYaml11('n').tag, 'bool');
    assert.equal(resolveYaml11('on').value, true);
    assert.equal(resolveYaml11('1e3').tag, 'str'); // 1.1 wants a dot or a signed exponent
    assert.equal(resolveYaml11('1.5e3').tag, 'str'); // and a sign in the exponent
    assert.equal(resolveYaml11('1.5e+3').tag, 'float');
    assert.equal(resolveYaml11('2026-10-11').tag, 'str'); // a date stays a date-less string per R12
    assert.equal(resolveYaml11('+.5').tag, 'str');
  });

  it('refuses what R12 names, and keeps what every reader reads alike', () => {
    for (const text of ['010', '017', '01', '00', '1_000', '0b101', '0o17', '1:30', '10:30:00', 'yes', 'no', 'on', 'off', 'y', 'n', 'Yes', '1e3', '1.5e3', '+.5', '-.5', '=', '<<', '1.7976931348623157e309']) {
      assert.equal(plainScalarIsPortable(text), false, `${text} must be refused`);
    }
    for (const text of ['0', '10', '0x1f', '1.0', '2.10', '.5', '1.5e+3', '-0', 'true', 'FALSE', '~', 'null', 'not-masked', '2026-10-11', 'GCA_000001405.29', 'diptera_odb12.2', 'x-a', 'a b', '-', '+']) {
      assert.equal(plainScalarIsPortable(text), true, `${text} must be accepted`);
    }
  });

  it('reads .nan, .inf and their signed forms only as whole scalars', () => {
    // The YAML 1.1 NaN pattern was once unanchored at the start, so any plain
    // scalar ending in ".nan" (release.nan, see build.NaN) was read as a float by
    // the YAML 1.1 side and refused as non-portable. The toolkit's resolver
    // anchors it, and so do these tables now.
    for (const text of ['release.nan', 'see build.NaN', 'x.NAN', 'a.nan', 'release.inf', 'x-.inf', 'build+.Inf']) {
      assert.equal(resolveYaml11(text).tag, 'str', `${text} is a string to YAML 1.1`);
      assert.equal(resolveCore(text).tag, 'str', `${text} is a string to YAML 1.2`);
      assert.equal(plainScalarIsPortable(text), true, `${text} must be accepted`);
    }
    for (const text of ['.nan', '.NaN', '.NAN', '.inf', '-.inf', '+.Inf', '.INF']) {
      assert.equal(resolveYaml11(text).tag, 'float', text);
      assert.equal(resolveCore(text).tag, 'float', text);
    }
    for (const text of ['.Nan', '.nAn', '-.nan', '+.nan', '.Inf.', '.infinity']) {
      assert.equal(resolveYaml11(text).tag, 'str', text);
      assert.equal(resolveCore(text).tag, 'str', text);
    }
  });

  it('flags a value that overflows to infinity (R13)', () => {
    assert.equal(plainScalarOverflows('1.7976931348623157e309'), true);
    assert.equal(plainScalarOverflows('1.5'), false);
  });
});

describe('loadHeaderYaml', () => {
  it('returns YAML 1.2 core values', () => {
    const { metadata } = loadHeaderYaml('genome: x\nversion: 10\nf: 1.5\nb: true\n');
    assert.deepEqual(metadata, { genome: 'x', version: 10, f: 1.5, b: true });
  });

  it('refuses a duplicate key (R8)', () => {
    assert.throws(() => loadHeaderYaml('genome: a\ngenome: b'), (error) => error instanceof HeaderError && /duplicate/i.test(error.message));
  });

  it('refuses an anchor and an alias (R8)', () => {
    assert.throws(() => loadHeaderYaml('genome: &a x\ntaxon: *a'), /anchor|alias/);
    assert.throws(() => loadHeaderYaml('genome: &a x'), /anchor/);
  });

  it('refuses a merge key (R8) and the bare 1.1 value key (R12)', () => {
    assert.throws(() => loadHeaderYaml('base: &b {x: 1}\ntaxon:\n  <<: *b'), /merge key|anchor|alias/);
    assert.throws(() => loadHeaderYaml('k: ='), /read differently/);
  });

  it('refuses an explicit tag (R12)', () => {
    assert.throws(() => loadHeaderYaml('genome: !!str x'), /explicit tag|tag/);
    assert.throws(() => loadHeaderYaml('genome: !x y'), /tag/);
  });

  it('refuses a mapping key that is not a string, at any depth', () => {
    for (const source of ['1: a', '1.5: a', '~: a', 'null: a', 'true: a', 'FALSE: a', '0x1f: a', 'x-k:\n  1: a', 'x-k: {~: a}', 'x-k: [{true: a}]', 'x-k: {: a}']) {
      assert.throws(() => loadHeaderYaml(source), (error) => error instanceof HeaderError && /keys must be strings/.test(error.message), source);
    }
  });

  it('accepts the same keys quoted', () => {
    assert.deepEqual(loadHeaderYaml("'1': a\n'~': b\n\"true\": c").metadata, { 1: 'a', '~': 'b', true: 'c' });
  });

  it('treats only a plain << as a merge key', () => {
    assert.throws(() => loadHeaderYaml('x-m: {<<: 1}'), /merge key/);
    assert.deepEqual(loadHeaderYaml("x-m: {'<<': 1}").metadata, { 'x-m': { '<<': 1 } });
    assert.deepEqual(loadHeaderYaml('x-m:\n  "<<": 1').metadata, { 'x-m': { '<<': 1 } });
  });

  it('refuses a bare n: key, the historic defect (R12)', () => {
    assert.throws(() => loadHeaderYaml('n: value\ngenome: x'), /read differently/);
  });

  it('accepts the indicator characters inside quoted scalars (R8)', () => {
    const { metadata } = loadHeaderYaml('documentation: "anchor & alias * merge << tags"\nx-note: \'yes\'\'s\'');
    assert.deepEqual(metadata, { documentation: 'anchor & alias * merge << tags', 'x-note': "yes's" });
  });

  it('decodes the R11 escapes', () => {
    const { metadata } = loadHeaderYaml('documentation: "contact \\x40 example.org; contigs \\x3E 1000 bp"');
    assert.deepEqual(metadata, { documentation: 'contact @ example.org; contigs > 1000 bp' });
  });

  it('refuses NaN and infinities (R13)', () => {
    for (const text of ['.nan', '.inf', '-.inf']) assert.throws(() => loadHeaderYaml(`gc: ${text}`), /finite|R13/, text);
  });

  it('refuses a second document', () => {
    assert.throws(() => loadHeaderYaml('a: 1\n---\nb: 2'), /one YAML document/);
  });

  it('refuses nesting deeper than the reader limit', () => {
    assert.throws(() => loadHeaderYaml(`a: ${'['.repeat(70)}${']'.repeat(70)}`), /maxDepth|nested/);
  });

  it('keeps big integers as numbers but does not lose them silently', () => {
    // js-yaml has no BigInt channel, so the value is rounded: the reader limit
    // for what this is allowed to do is documented in docs/CAPABILITY.md.
    const { metadata, warnings } = loadHeaderYaml('total: 9007199254740993');
    assert.equal(typeof metadata.total, 'number');
    assert.equal(warnings.length, 1, 'the rounding must be reported, not hidden');
    assert.match(warnings[0], /precision warning/);
  });
});

describe('untrusted-input handling', () => {
  it('does not let a __proto__ key touch Object.prototype (js-yaml 5.5.0 behaviour this library relies on)', () => {
    const before = {}.polluted;
    const { metadata } = loadHeaderYaml('__proto__:\n  polluted: 1');
    assert.equal({}.polluted, before, 'Object.prototype must be untouched');
    assert.deepEqual(Object.keys(metadata), ['__proto__'], 'the key is held as an own property, so the contract can refuse it as unknown');
    assert.equal({}.polluted, undefined);
  });

  it('refuses a nested __proto__ the same way', () => {
    const { metadata } = loadHeaderYaml('taxon:\n  __proto__:\n    polluted: 1\n  name: x');
    assert.equal({}.polluted, undefined);
    assert.deepEqual(Object.keys(metadata.taxon.__proto__ ?? {}), ['polluted']);
  });

  it('bounds alias expansion (the billion-laughs shape)', () => {
    const bomb = ['a: &a ["x","y","z"]', 'b: &b [*a,*a,*a]', 'c: &c [*b,*b,*b]', 'd: [*c,*c,*c]'].join('\n');
    // Anchors themselves are already refused (R8); maxAliases: 0 is the second lock.
    assert.throws(() => loadHeaderYaml(bomb), /anchor|alias/);
  });

  it('bounds node count and depth', () => {
    assert.throws(() => loadHeaderYaml(`a: ${'['.repeat(70)}${']'.repeat(70)}`), /maxDepth|nested/);
    const wide = Array.from({ length: 20_001 }, (_, i) => `k${i}: 1`).join('\n');
    assert.throws(() => loadHeaderYaml(wide), /node limit/);
  });

  it('accepts a %YAML or %TAG directive, as the toolkit does', () => {
    for (const source of ['%YAML 1.2\n---\na: 1', '%YAML 1.1\n---\na: 1', '%TAG !e! tag:example.com,2000:\n---\na: 1']) {
      assert.deepEqual(loadHeaderYaml(source).metadata, { a: 1 }, source);
    }
  });

  it('still refuses a %YAML 2 directive and a tag a %TAG handle names', () => {
    assert.throws(() => loadHeaderYaml('%YAML 2.0\n---\na: 1'), /not readable YAML/);
    assert.throws(() => loadHeaderYaml('%TAG !e! tag:example.com,2000:\n---\na: !e!x 1'), /explicit tag/);
  });

  it('holds __proto__ inside an x- value as plain data, without touching any prototype', () => {
    const { metadata } = loadHeaderYaml("x-p: {__proto__: {polluted: 1}, constructor: {prototype: {polluted: 1}}}");
    assert.equal({}.polluted, undefined);
    assert.deepEqual(Object.getOwnPropertyNames(metadata['x-p']), ['__proto__', 'constructor']);
    assert.equal(Object.getPrototypeOf(metadata['x-p']), Object.prototype, 'an own __proto__ property is not the prototype');
    assert.equal(Object.getPrototypeOf(metadata), Object.prototype);
  });
});
