// Used only before registration against the temporary local server. Never retain
// the raw Next log, request bodies, environment values or production responses.
function startupError(log, paths = []) {
  const clean = log.slice(0, 32768).replace(/\x1b\[[0-9;]*m/g, '');
  let line = clean.split(/\r?\n/).find(value => /\b(?:Error|TypeError|ConfigError|SqliteError|ReferenceError|RangeError)\b/.test(value)) || '';
  for (const path of paths) if (path) line = line.split(path).join('<local-path>');
  line = line.replace(/\b(?:password|passwd|authorization|token|secret|api[_-]?key|cookie)\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^,;\s]+)/gi, '[credential field redacted]')
    .replace(/\bBearer\s+\S+/gi, '[bearer redacted]')
    .replace(/https?:\/\/[^\s"']+/g, '<url>')
    .slice(0, 600);
  return { firstErrorLine: line || null, errorCodes: [...new Set(clean.match(/\b(?:ERR|SQLITE|EAI)_[A-Z0-9_]+\b/g) || [])].slice(0, 8) };
}
module.exports = { startupError };
