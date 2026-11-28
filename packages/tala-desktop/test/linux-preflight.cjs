const { spawnSync } = require('node:child_process');

function missingLibraries(output) {
  return [...new Set(output.split('\n').flatMap(line => {
    const match = /^\s*([A-Za-z0-9_+.-]+)\s+=>\s+not found\s*$/.exec(line);
    return match ? [match[1]] : [];
  }))].sort();
}
function preflight(executable) {
  if (process.platform !== 'linux') throw new Error('Dependency preflight is Linux-only');
  // ldd inspects the exact trusted Electron executable this harness will launch.
  // Honour the owner's private LD_LIBRARY_PATH, without touching system packages.
  const result = spawnSync('ldd', [executable], { encoding: 'utf8', timeout: 10000 });
  const missing = missingLibraries(result.stdout || '');
  for (const name of missing) console.error(name);
  if (missing.length) return false;
  if (result.error || result.status !== 0) {
    console.error('Electron dependency preflight could not run');
    return false;
  }
  return true;
}
if (require.main === module) {
  if (!preflight(process.env.TALA_DESKTOP_EXECUTABLE || require('electron'))) process.exitCode = 2;
}
module.exports = { preflight, missingLibraries };
