const { withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');
module.exports = (config) =>
  withDangerousMod(config, [
    'android',
    async (mod) => {
      if (process.env.TALA_QVAC !== '1')
        throw Error('QVAC native support must never enter a standard build');
      const root = mod.modRequest.platformProjectRoot;
      const java = path.join(root, 'app/src/main/java');
      const dest = path.join(java, 'com/hiraia/localai');
      fs.mkdirSync(dest, { recursive: true });
      fs.copyFileSync(
        path.join(mod.modRequest.projectRoot, 'native/local-ai/TalaAiSupportPackage.kt'),
        path.join(dest, 'TalaAiSupportPackage.kt')
      );
      const app = path.join(java, mod.android.package.replaceAll('.', '/'), 'MainApplication.kt');
      let source = fs.readFileSync(app, 'utf8');
      const marker = 'PackageList(this).packages.apply {';
      if (!source.includes(marker)) throw Error('Native package registration marker missing');
      source = source.replace(
        marker,
        marker + '\n              add(com.hiraia.localai.TalaAiSupportPackage())'
      );
      fs.writeFileSync(app, source);
      return mod;
    },
  ]);
