/**
 * `format: uri`, as RFC 3986 defines an absolute URI.
 *
 * The released contracts declare `format: uri`, and docs/SCHEMA-VERSIONS.md
 * requires a validator to assert it. JSON Schema defines that format as an
 * RFC 3986 URI: `scheme ":" hier-part [ "?" query ] [ "#" fragment ]`, where
 * `hier-part` may be `path-empty`. So `urn:`, `doi:` and `mailto:` are URIs.
 * `ajv-formats` 3.0.1 refuses a URI with an empty `hier-part`, while the Python
 * toolkit (jsonschema's format checker, through `rfc3987`'s `URI` rule) accepts
 * it. This module is the RFC 3986 grammar written out as one regular
 * expression, rule by rule, in the order RFC 3986 appendix A gives it, so the
 * two implementations decide the same values the same way.
 *
 * One deliberate difference: `rfc3987` anchors its pattern with Python's `$`,
 * which also matches before a final line feed, so the toolkit accepts
 * `"https://example.org/\n"`. A line feed is not a URI character, and this
 * module does not copy that artefact.
 *
 * @module uri
 */

const hexdig = '[0-9A-Fa-f]';
const unreserved = '[A-Za-z0-9._~-]';
const pctEncoded = `%${hexdig}{2}`;
const subDelims = "[!$&'()*+,;=]";
const pchar = `(?:${unreserved}|${pctEncoded}|${subDelims}|[:@])`;

const scheme = '[A-Za-z][A-Za-z0-9+.-]*';
const decOctet = '(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)';
const ipv4 = `(?:${decOctet}\\.){3}${decOctet}`;
const h16 = `${hexdig}{1,4}`;
const ls32 = `(?:${h16}:${h16}|${ipv4})`;
const ipv6 = [
  `(?:${h16}:){6}${ls32}`,
  `::(?:${h16}:){5}${ls32}`,
  `(?:${h16})?::(?:${h16}:){4}${ls32}`,
  `(?:(?:${h16}:)?${h16})?::(?:${h16}:){3}${ls32}`,
  `(?:(?:${h16}:){0,2}${h16})?::(?:${h16}:){2}${ls32}`,
  `(?:(?:${h16}:){0,3}${h16})?::${h16}:${ls32}`,
  `(?:(?:${h16}:){0,4}${h16})?::${ls32}`,
  `(?:(?:${h16}:){0,5}${h16})?::${h16}`,
  `(?:(?:${h16}:){0,6}${h16})?::`,
].join('|');
const ipvFuture = `v${hexdig}+\\.(?:${unreserved}|${subDelims}|:)+`;
const ipLiteral = `\\[(?:${ipv6}|${ipvFuture})\\]`;
const regName = `(?:${unreserved}|${pctEncoded}|${subDelims})*`;
const host = `(?:${ipLiteral}|${ipv4}|${regName})`;
const userinfo = `(?:${unreserved}|${pctEncoded}|${subDelims}|:)*`;
const authority = `(?:${userinfo}@)?${host}(?::[0-9]*)?`;

const segment = `${pchar}*`;
const segmentNz = `${pchar}+`;
const pathAbempty = `(?:/${segment})*`;
const pathAbsolute = `/(?:${segmentNz}(?:/${segment})*)?`;
const pathRootless = `${segmentNz}(?:/${segment})*`;
const hierPart = `(?://${authority}${pathAbempty}|${pathAbsolute}|${pathRootless}|)`;
const query = `(?:${pchar}|[/?])*`;
const fragment = query;

/** RFC 3986 `URI`, anchored to the whole value. */
export const URI_PATTERN = new RegExp(`^${scheme}:${hierPart}(?:\\?${query})?(?:#${fragment})?$`);

/**
 * @param {unknown} value
 * @returns {boolean} whether `value` is an RFC 3986 URI; a non-string is not
 *   this format's concern (JSON Schema applies `format` to strings only)
 */
export function isUri(value) {
  if (typeof value !== 'string') return true;
  return URI_PATTERN.test(value);
}
