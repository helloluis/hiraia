const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('@expo/config-plugins');
function installMemoryModule(mobile) {
  const dir = path.join(mobile, 'android/app/src/main/java/com/hiraia/app');
  const app = path.join(dir, 'MainApplication.kt');
  let source = fs.readFileSync(app, 'utf8');
  if (!source.includes('add(HiraiaMemoryPackage())')) {
    const marker = 'PackageList(this).packages.apply {';
    if (!source.includes(marker)) throw new Error('Cannot register HiraiaMemoryPackage');
    source = source.replace(marker, marker + '\n              add(HiraiaMemoryPackage())');
    fs.writeFileSync(app, source);
  }
  fs.copyFileSync(path.join(mobile, 'native/memory/HiraiaMemoryPackage.kt'), path.join(dir, 'HiraiaMemoryPackage.kt'));
}
module.exports = config => withDangerousMod(config, ['android', async config => {
  installMemoryModule(config.modRequest.projectRoot);
  return config;
}]);
module.exports.installMemoryModule = installMemoryModule;
