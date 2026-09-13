const { withAppBuildGradle } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const line = 'apply from: new File(rootDir, "../scripts/illustration-assets.gradle")';
function configure(source) {
  return source.includes(line) ? source : source.replace(/\s*$/, '\n') + '\n' + line + '\n';
}
function install(mobile) {
  const file = path.join(mobile, 'android/app/build.gradle');
  if (!fs.existsSync(file)) return;
  const before = fs.readFileSync(file, 'utf8');
  const after = configure(before);
  if (after !== before) fs.writeFileSync(file, after);
}
module.exports = config => withAppBuildGradle(config, result => {
  result.modResults.contents = configure(result.modResults.contents);
  return result;
});
module.exports.install = install;
