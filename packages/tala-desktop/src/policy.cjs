'use strict';
const ORIGIN = 'https://tala.hiraia.org';
const SAFE_EXTENSIONS = new Set(['pdf', 'docx', 'pptx', 'xlsx', 'csv', 'txt', 'json', 'png', 'jpg', 'jpeg', 'webp']);
function parsed(value) {
  try { return new URL(value); } catch { return null; }
}
function internal(value, origin = ORIGIN) {
  const u = parsed(value);
  return !!u && u.origin === origin && !u.username && !u.password && u.protocol === 'https:';
}
function blob(value, origin = ORIGIN) {
  const u = parsed(value);
  return !!u && u.protocol === 'blob:' && u.origin === origin;
}
function external(value, origin = ORIGIN) {
  const u = parsed(value);
  return !!u && u.protocol === 'https:' && !u.username && !u.password && !internal(value, origin);
}
function download(value, origin = ORIGIN) { return internal(value, origin) || blob(value, origin); }
function filename(value) {
  // The remote filename is a suggestion only; never accept a path, executable,
  // Windows reserved device name, bidi control, or trailing dot/space.
  const name = value.replace(/[\\/:*?"<>|\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '_').replace(/[. ]+$/, '').slice(0, 180);
  const ext = name.split('.').pop().toLowerCase();
  if (!SAFE_EXTENSIONS.has(ext) || !name.includes('.') || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)) return null;
  return name;
}
function preferences(partition) {
  return { partition, nodeIntegration: false, nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true,
    webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
    navigateOnDragDrop: false, safeDialogs: true };
}
module.exports = { ORIGIN, internal, blob, external, download, filename, preferences };
