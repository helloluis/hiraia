// Preserve values/array order; sort only object property names.
const { createHash } = require('node:crypto');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function recordDigest(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
module.exports = { recordDigest };
