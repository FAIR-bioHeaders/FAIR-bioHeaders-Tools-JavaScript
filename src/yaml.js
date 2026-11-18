/**
 * Reading the header YAML of a FAIR-bioHeaders file.
 *
 * Rules implemented here: R8 (no duplicate keys, anchors, aliases or merge
 * keys), string mapping keys only (metadata is a JSON object), R12 (YAML 1.2 core-schema types, and every plain scalar must read the
 * same under YAML 1.1; explicit tags are invalid), R13 (finite numbers only) and
 * the reader limits of `docs/FORMAT.md`.
 *
 * Values come from `js-yaml`'s CORE_SCHEMA, which is YAML 1.2, so it reads
 * `yes`, `n` or `010` the way the 1.2 core schema does. The 1.1 side of R12
 * cannot be seen in that result, and `js-yaml`'s own YAML 1.1 tag table differs
 * from PyYAML's resolver in several corners, so both dialects are resolved
 * explicitly in `scalars.js` and compared there. `scripts/capability/` verifies
 * that comparison against the released toolkit, scalar by scalar.
 *
 * @module yaml
 */

import { createRequire } from 'node:module';

import { HeaderError } from './errors.js';
import { LIMITS } from './lines.js';
import { TAGS, plainScalarIsPortable, plainScalarOverflows, resolveCore } from './scalars.js';

const require = createRequire(import.meta.url);
/** @type {import('js-yaml')} */
const yaml = require('js-yaml');

const { CORE_SCHEMA, EVENT_ID, SCALAR_STYLE } = yaml;

const MAX_EXACT_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * R13: every numeric metadata value must be a finite JSON number.
 *
 * A `minimum` or `maximum` comparison against `NaN` is false, and JSON cannot
 * carry these values at all, so the reader has to refuse them itself.
 *
 * @param {unknown} value
 * @param {string} path
 */
function assertFinite(value, path) {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new HeaderError(`${path} is ${String(value)}, which is not a finite JSON number (FORMAT.md R13)`, {
      rule: 'R13',
      field: path,
    });
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFinite(item, `${path}[${index}]`));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) assertFinite(item, `${path}.${key}`);
  }
}

/**
 * @param {string} text a plain scalar's text
 * @returns {boolean} whether a JavaScript number cannot hold it exactly
 */
function beyondExactIntegerRange(text) {
  const core = resolveCore(text);
  if (core.tag !== TAGS.int || typeof core.value !== 'bigint') return false;
  return core.value > MAX_EXACT_INTEGER || core.value < -MAX_EXACT_INTEGER;
}

/**
 * Walk the parser's event stream and refuse what FHR metadata may not contain.
 *
 * Key and value positions are tracked so that `<<` is recognised as a merge key
 * and so an R8 or R12 finding can name the field it sits in.
 *
 * @param {ReturnType<typeof yaml.parseEvents>} events
 * @param {string} source
 * @returns {string[]} warnings about what was read but cannot be kept exactly
 */
function auditEvents(events, source) {
  let documents = 0;
  let nodes = 0;
  /** @type {string[]} */
  const warnings = [];
  /** @type {Array<{kind: 'map'|'seq', children: number, key: string|null}>} */
  const frames = [];

  const field = () => {
    const parts = frames.filter((frame) => frame.kind === 'map' && frame.key !== null).map((frame) => /** @type {string} */ (frame.key));
    return parts.length > 0 ? parts.join('.') : 'metadata';
  };
  const inKeyPosition = () => {
    const top = frames[frames.length - 1];
    return top !== undefined && top.kind === 'map' && top.children % 2 === 0;
  };
  const noteChild = () => {
    const top = frames[frames.length - 1];
    if (top !== undefined) top.children += 1;
  };

  for (const event of events) {
    if (event.type === EVENT_ID.DOCUMENT) {
      documents += 1;
      // A %YAML or %TAG directive is accepted, as the toolkit's YAML reader accepts
      // it: it changes no plain-scalar resolution here (R12 is checked against both
      // dialects regardless), and a tag a %TAG handle would expand is still refused
      // below. A %YAML major version other than 1 is refused by the parser.
      continue;
    }
    if (event.type === EVENT_ID.POP) {
      frames.pop();
      continue;
    }
    if (event.type === EVENT_ID.ALIAS) {
      throw new HeaderError(`an alias in ${field()} is not allowed in FHR metadata (FORMAT.md R8)`, { rule: 'R8', field: field() });
    }
    nodes += 1;
    if (nodes > LIMITS.yamlNodes) {
      throw new HeaderError(`the header YAML exceeds the ${LIMITS.yamlNodes} node limit`, { rule: 'limits' });
    }
    if (event.anchorStart !== undefined && event.anchorStart >= 0) {
      throw new HeaderError(`an anchor on ${field()} is not allowed in FHR metadata (FORMAT.md R8)`, { rule: 'R8', field: field() });
    }
    if (event.tagStart !== undefined && event.tagStart >= 0) {
      throw new HeaderError(`an explicit tag on ${field()} is not allowed in FHR metadata (FORMAT.md R12)`, { rule: 'R12', field: field() });
    }
    const keyPosition = inKeyPosition();
    if (event.type === EVENT_ID.MAPPING || event.type === EVENT_ID.SEQUENCE) {
      noteChild();
      frames.push({ kind: event.type === EVENT_ID.MAPPING ? 'map' : 'seq', children: 0, key: null });
      continue;
    }
    const text = yaml.getScalarValue(source, event);
    if (keyPosition) {
      // Only a plain `<<` is a merge key; a quoted '<<' is an ordinary string key.
      if (text === '<<' && event.style === SCALAR_STYLE.PLAIN) {
        throw new HeaderError(`a merge key in ${field()} is not allowed in FHR metadata (FORMAT.md R8)`, { rule: 'R8', field: field() });
      }
      // Metadata is a JSON object, so every key is a string. A plain key that the
      // YAML 1.2 core schema reads as a number, a boolean or null (`1:`, `true:`,
      // `~:`, an empty key) is not one, and the toolkit refuses it too.
      if (event.style === SCALAR_STYLE.PLAIN && resolveCore(text).tag !== TAGS.str && plainScalarIsPortable(text)) {
        throw new HeaderError(
          `the mapping key ${text === '' ? '(empty)' : JSON.stringify(text)} in ${field()} is read as ${resolveCore(text).tag}, not a string; metadata object keys must be strings, so quote it`,
          { rule: 'yaml', field: field() },
        );
      }
      frames[frames.length - 1].key = text;
    }
    // R12 covers keys as well as values: a bare `n:` key is the boolean false to
    // a YAML 1.1 reader and the string "n" to a YAML 1.2 reader, which is the
    // disagreement the rule forbids.
    if (event.style === SCALAR_STYLE.PLAIN && text !== '') {
      if (!plainScalarIsPortable(text)) {
        throw new HeaderError(
          `the plain YAML value ${JSON.stringify(text)} in ${field()} is read differently by YAML 1.1 and YAML 1.2 readers; quote it (FORMAT.md R12)`,
          { rule: 'R12', field: field() },
        );
      }
      if (plainScalarOverflows(text)) {
        throw new HeaderError(
          `the plain YAML number ${JSON.stringify(text)} in ${field()} overflows to infinity, which is not a finite JSON number (FORMAT.md R13)`,
          { rule: 'R13', field: field() },
        );
      }
      if (beyondExactIntegerRange(text)) {
        warnings.push(
          `precision warning: ${field()} is the integer ${text}, outside the range a JavaScript number holds exactly (${Number.MAX_SAFE_INTEGER}); the value is rounded`,
        );
      }
    }
    noteChild();
  }
  if (documents !== 1) {
    throw new HeaderError(`the header block must be exactly one YAML document, found ${documents} (FORMAT.md R8)`, { rule: 'R8' });
  }
  return warnings;
}

/**
 * Parse the header YAML of a FAIR-bioHeaders file.
 *
 * @param {string} source the header block's text, prefixes removed
 * @returns {{metadata: Record<string, unknown>, warnings: string[]}} the record, and what could not be kept exactly
 * @throws {HeaderError} on any R8, R12 or R13 violation, or beyond a reader limit
 */
export function loadHeaderYaml(source) {
  let events;
  try {
    events = yaml.parseEvents(source, { maxDepth: LIMITS.yamlDepth });
  } catch (error) {
    throw new HeaderError(`the header block is not readable YAML: ${messageOf(error)}`, { rule: 'yaml' });
  }
  const warnings = auditEvents(events, source);
  let documents;
  try {
    documents = yaml.constructFromEvents(events, {
      source,
      schema: CORE_SCHEMA,
      json: false, // duplicate mapping keys are an error, not an override (R8)
      maxAliases: 0, // aliases are refused above; this is the second lock (R8)
    });
  } catch (error) {
    throw new HeaderError(`the header block is not readable YAML: ${messageOf(error)}`, { rule: 'yaml' });
  }
  const metadata = documents[0];
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new HeaderError('the header block must be a YAML mapping', { rule: 'yaml' });
  }
  assertFinite(metadata, 'metadata');
  return { metadata: /** @type {Record<string, unknown>} */ (metadata), warnings };
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function messageOf(error) {
  if (error instanceof Error) return error.message.split('\n')[0];
  return String(error);
}
