/**
 * The `ajv` configuration is a claim this build makes, so it is asserted as one.
 *
 * `docs/CAPABILITY.md` states the exact configuration and the two strict-mode relaxations
 * the released bytes require. Until this file existed, that statement described a literal
 * inside a private function in `src/validate.js`, and it mattered unevenly. Four drifts you
 * can inject into that literal fail the suite loudly — a draft-07 entry point,
 * `validateFormats: false`, or either relaxation removed — but replacing `strict: true` with
 * `strict: 'log'`, keeping the two relaxations, changes nothing any vector can observe. It
 * compiles the same bytes, in the same silence, and quietly drops the guarantee that a
 * strict-mode violation this library has *not* relaxed is still an error rather than a log
 * line. Measured on `ajv` 8.20.0 against the vendored copies (see the table in
 * `docs/CAPABILITY.md`): both configurations produce `compiled, 0 warnings` for FHR, FHP and
 * FHGFF3 at `v0.6.0`.
 *
 * So the configuration is an exported frozen value (`AJV_ENTRY`, `AJV_CONFIG`,
 * `AJV_FORMATS`), every instance is built through `createCompiler()` — including the ones in
 * `scripts/capability/ajv-dialect.mjs`, which used to restate the literals and therefore
 * measured a configuration the library did not use — and it is asserted two ways here: as a
 * value, and as a behaviour that differs from the substitution it exists to prevent.
 *
 * Every expectation in this file is a measurement of the vendored bytes, not a memory of
 * documentation. Where a measurement stops being true, the message says to change
 * `AJV_CONFIG` and `docs/CAPABILITY.md` in the same commit.
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import * as publicApi from '../src/index.js';
import { AJV_CONFIG, AJV_ENTRY, AJV_FORMATS, createCompiler } from '../src/validate.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const provenance = JSON.parse(readFileSync(join(ROOT, 'schemas', 'provenance.json'), 'utf8'));
const formatsVersion = require('ajv-formats/package.json').version;
const ajvVersion = require('ajv/package.json').version;

/** Every contract copy this build bundles, as `[type, release]`, in registry order. */
const bundled = [];
for (const [release, row] of Object.entries(provenance.releases)) {
  for (const [type, entry] of Object.entries(row)) {
    if (entry !== null && typeof entry === 'object' && typeof entry.file === 'string') bundled.push([type, release]);
  }
}

/**
 * The vendored bytes of one contract, with `$id` removed the way `src/validate.js` does it
 * (the copies share their raw-main `$id` across releases, which is what the schema registry
 * keys on).
 *
 * @param {string} type
 * @param {string} release
 * @param {boolean} [keepId]
 */
function contract(type, release, keepId = false) {
  const schema = structuredClone(JSON.parse(readFileSync(join(ROOT, 'schemas', provenance.releases[release][type].file), 'utf8')));
  if (!keepId) delete schema.$id;
  return schema;
}

/**
 * An instance of the declared configuration that records where its complaints go, so
 * "it compiled" and "it compiled and said nothing" are different answers here.
 *
 * @param {Record<string, unknown>} [overrides]
 */
function instrumented(overrides = {}) {
  /** @type {string[]} */
  const logged = [];
  const instance = createCompiler({ logger: { log: (...a) => logged.push(a.join(' ')), warn: (...a) => logged.push(a.join(' ')), error: (...a) => logged.push(a.join(' ')) }, ...overrides });
  return { instance, logged };
}

/**
 * Compile one contract, reporting the outcome rather than throwing.
 *
 * @param {import('ajv').default} instance
 * @param {string} type
 * @param {string} release
 */
function compileOutcome(instance, type, release) {
  try {
    instance.compile(contract(type, release));
    return null;
  } catch (error) {
    return String(error.message).split('\n')[0];
  }
}

describe('the declared ajv configuration', () => {
  it('is exactly the documented six keys, and nothing else', () => {
    // The case no vector can see, stated as its own assertion so the failure message
    // names it: 'log' behaves identically to `true` on these bytes, so only an identity
    // check keeps it from silently replacing it.
    assert.equal(AJV_CONFIG.strict, true, `AJV_CONFIG.strict must be the boolean true, not ${JSON.stringify(AJV_CONFIG.strict)}: 'log' downgrades every strict-mode violation this build has not deliberately relaxed into a log line`);
    assert.deepEqual(
      { ...AJV_CONFIG },
      {
        strict: true,
        strictRequired: false,
        strictTypes: false,
        validateFormats: true,
        allowUnionTypes: true,
        allErrors: false,
      },
      'AJV_CONFIG changed. docs/CAPABILITY.md and the reasoning recorded on the export speak to each key; change the doc in the same commit',
    );
  });

  it('cannot be mutated through the export', () => {
    assert.ok(Object.isFrozen(AJV_CONFIG), 'AJV_CONFIG must be frozen: a mutable guarantee is not one');
    assert.ok(Object.isFrozen(AJV_FORMATS), 'AJV_FORMATS must be frozen for the same reason');
    assert.throws(() => {
      AJV_CONFIG.validateFormats = false;
    }, TypeError);
    assert.equal(AJV_CONFIG.validateFormats, true, 'and the attempt must not have changed the value');
  });

  it('is reachable from the public entry point', () => {
    for (const name of ['AJV_CONFIG', 'AJV_ENTRY', 'AJV_FORMATS', 'createCompiler']) {
      assert.ok(name in publicApi, `src/index.js must export ${name}: the study and the tests read the configuration through the public surface, so a consumer can too`);
    }
    assert.equal(publicApi.AJV_CONFIG, AJV_CONFIG, 'and it must be the same object, not a second copy');
  });

  it('names the draft/2020-12 entry point, which the released bytes insist on', () => {
    assert.equal(AJV_ENTRY, 'ajv/dist/2020');
    assert.deepEqual([...AJV_FORMATS], ['date', 'uri']);
    // The alternative is not a preference. The plain `ajv` entry point is a draft-07
    // build, and the released bytes refuse it by declaring their dialect: measured here
    // on the vendored fhgff3-1.2.json, with the $id kept, because that is how a
    // consumer would add it.
    const Ajv07 = require('ajv').default;
    let refusal = 'the draft-07 build accepted the 2020-12 bytes without complaint';
    try {
      new Ajv07({ strict: false }).compile(contract('FHGFF3', 'v0.6.0', true));
    } catch (error) {
      refusal = String(error.message).split('\n')[0];
    }
    assert.match(
      refusal,
      /no schema with key or ref "https:\/\/json-schema\.org\/draft\/2020-12\/schema"/,
      `a draft-07 build must be refused by the released bytes themselves, saw: ${refusal}`,
    );
  });
});

describe('what the declared strict settings are worth', () => {
  it('compiles all 17 bundled contract copies in silence', () => {
    // Silence is the point: `strict: true` is affordable on these bytes only because they
    // provoke no strict-mode complaint beyond the two that are relaxed. If a re-vendor
    // makes this noisy, that is a real finding about new bytes, not a test to relax.
    assert.equal(bundled.length, 17, 'the set under test is the 17 copies v0.3.0-v0.6.0 publish');
    const { instance, logged } = instrumented();
    const failures = [];
    for (const [type, release] of bundled) {
      const complaint = compileOutcome(instance, type, release);
      if (complaint !== null) failures.push(`${type}@${release}: ${complaint}`);
    }
    assert.deepEqual(failures, [], 'every vendored copy must compile under the declared configuration');
    assert.deepEqual(logged, [], 'and the declared configuration must compile them without a single strict-mode complaint');
  });

  it('needs each of the two relaxations, and says so if it no longer does', () => {
    const complaints = {
      strictRequired: [
        ['FHP', 'strict mode: required property "completeness" is not defined at "#/allOf/1/if" (strictRequired)'],
        ['FHGFF3', 'strict mode: required property "genomeReference" is not defined at "#/anyOf/0" (strictRequired)'],
      ],
      strictTypes: [
        ['FHP', 'strict mode: missing type "object" for keyword "properties" at "#/allOf/1/then/properties/completeness" (strictTypes)'],
        ['FHGFF3', 'strict mode: missing type "array" for keyword "contains" at "#/anyOf/1/properties/derivedFrom" (strictTypes)'],
      ],
    };
    for (const [key, rows] of Object.entries(complaints)) {
      for (const [type, expected] of rows) {
        const complaint = compileOutcome(createCompiler({ [key]: true }), type, 'v0.6.0');
        assert.notEqual(
          complaint,
          null,
          `with ${key}: true the released ${type} bytes compiled, so that relaxation may no longer be needed - change AJV_CONFIG and docs/CAPABILITY.md in the same commit`,
        );
        assert.equal(complaint, expected, `${key}: the measured complaint for ${type} changed, so the recorded reason for the relaxation is out of date`);
      }
    }
    // And the relaxation is only needed by those two types: FHR compiles either way, so
    // the narrowing is per-keyword, not a blanket "the released bytes need strict off".
    for (const key of Object.keys(complaints)) {
      assert.equal(compileOutcome(createCompiler({ [key]: true }), 'FHR', 'v0.6.0'), null, `FHR@v0.6.0 must compile with ${key}: true`);
    }
  });

  it('throws where strict:"log" would only log, which is the difference this file defends', () => {
    // `strict: 'log'` is indistinguishable from `strict: true` on the released bytes
    // because they raise no un-relaxed strict complaint. It becomes distinguishable the
    // moment one does: on a schema carrying an unknown keyword, `true` refuses and 'log'
    // accepts. That is the property `AJV_CONFIG.strict` holds, so it is tested as a
    // behaviour and not only as a value.
    const stray = { type: 'object', properties: { a: { type: 'string' } }, notAKeyword: 1 };
    const enforcing = instrumented();
    let strictOutcome;
    try {
      enforcing.instance.compile(stray);
      strictOutcome = `compiled in silence (and ${enforcing.logged.length} complaint(s) logged)`;
    } catch (error) {
      strictOutcome = `threw: ${String(error.message).split('\n')[0]}`;
    }
    assert.match(
      strictOutcome,
      /^threw: strict mode: unknown keyword: "notAKeyword"$/,
      `AJV_CONFIG must make an un-relaxed strict violation an error, saw ${strictOutcome} - if this says "compiled in silence", strict has become 'log' or false`,
    );
    assert.deepEqual(enforcing.logged, [], 'and it must be refused, not reported through the logger');

    const logging = instrumented({ strict: 'log' });
    let logOutcome = 'threw';
    try {
      logging.instance.compile(stray);
      logOutcome = `compiled, ${logging.logged.length} complaint(s) logged`;
    } catch (error) {
      logOutcome = `threw: ${String(error.message).split('\n')[0]}`;
    }
    assert.equal(logOutcome, 'compiled, 1 complaint(s) logged', "the counterfactual must show what strict:'log' does, otherwise the assertion above proves nothing");
  });
});

describe('what the rest of the configuration is worth', () => {
  it('rejects a month-13 date only because formats are asserted', () => {
    const record = { ...JSON.parse(readFileSync(join(ROOT, 'examples', 'minimal-predicted.fhp.json'), 'utf8')), dateCreated: '2022-13-45' };
    const asserting = createCompiler().compile(contract('FHP', 'v0.6.0'));
    const ignoring = createCompiler({ validateFormats: false }).compile(contract('FHP', 'v0.6.0'));
    assert.equal(asserting(structuredClone(record)), false, 'a bogus date must be rejected while formats are asserted');
    assert.equal(ignoring(structuredClone(record)), true, 'and the same bytes must accept it with validateFormats off, which is why the key is pinned');
  });

  it('registers exactly the declared formats through the same seam', () => {
    // The formats this library claims to assert must be the ones its instance knows, in
    // both directions: a declared format nothing registers would be a silent no-op, and a
    // registered format nobody declares is an undeclared part of the guarantee.
    const instance = createCompiler();
    assert.deepEqual(Object.keys(instance.formats).sort(), [...AJV_FORMATS].sort(), 'the registered format set must equal AJV_FORMATS');
    assert.equal(ajvVersion, '8.20.0', 'the strict-mode behaviour recorded in docs/CAPABILITY.md was measured on ajv 8.20.0');
    assert.equal(formatsVersion, '3.0.1', 'and the format registration on ajv-formats 3.0.1');
  });

  it('is the instance the library compiles on, not a copy of it', () => {
    // Wiring, not just value: if src/validate.js built its singleton anywhere other than
    // createCompiler(), the assertions above would stop describing the library.
    const source = readFileSync(join(ROOT, 'src', 'validate.js'), 'utf8');
    assert.equal((source.match(/new Ajv2020\(/g) ?? []).length, 1, 'exactly one place in src/validate.js may construct an ajv instance');
    assert.match(source, /new Ajv2020\(\{ \.\.\.AJV_CONFIG, \.\.\.overrides \}\)/, 'and it must spread AJV_CONFIG');
    assert.match(source, /ajv = createCompiler\(\)/, "the library's singleton must come from createCompiler()");
    assert.equal((source.match(/addFormats\(/g) ?? []).length, 1, 'and one place may register formats, so the declared list is the only one');
  });

  it('is imported by the capability study instead of being restated there', () => {
    // The study is the repository's evidence about what ajv does with the released bytes.
    // While it wrote the literals out again - in four places, each omitting `allErrors` -
    // it proved properties of a configuration it had invented rather than the one shipped.
    const study = readFileSync(join(ROOT, 'scripts', 'capability', 'ajv-dialect.mjs'), 'utf8');
    assert.ok(!/new Ajv2020\(/.test(study), 'scripts/capability/ajv-dialect.mjs must not construct a 2020-12 instance directly: build it through createCompiler()');
    assert.ok(!/addFormats\(/.test(study), 'scripts/capability/ajv-dialect.mjs must not register formats itself');
    assert.match(study, /import \{[^}]*AJV_CONFIG[^}]*createCompiler[^}]*\} from '\.\.\/\.\.\/src\/validate\.js'/, 'it must import the declared configuration from src/validate.js');
    assert.match(study, /createCompiler\(\)/, 'and build its instances from it');
    // A deliberate counterfactual must name the key it varies, so no site silently
    // becomes a second undocumented configuration.
    const varied = [...study.matchAll(/createCompiler\((\{[^)]*\})\)/g)].map((match) => match[1]);
    assert.ok(varied.length >= 2, 'the study must still measure the documented counterfactuals (validateFormats off, strict relaxations off)');
    for (const overrides of varied) {
      assert.match(overrides, /strictRequired|strictTypes|validateFormats|strict/, `counterfactual ${overrides} must name the key it varies`);
    }
    assert.ok(study.includes('configuration under study'), 'and it must print the configuration it measured');
  });
});
