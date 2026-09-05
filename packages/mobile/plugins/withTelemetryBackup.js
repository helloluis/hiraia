const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

// expo-sqlite Android stores databases under files/SQLite, not databases/.
// Excluding all sidecars keeps installation IDs and pending events off restored/cloned phones.
const exclusions = ['', '-wal', '-shm', '-journal']
  .map((suffix) => `    <exclude domain="file" path="SQLite/hiraia-telemetry.db${suffix}" />`)
  .join('\n');
function writeRules(projectRoot) {
  const dir = path.join(projectRoot, 'android/app/src/main/res/xml');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'hiraia_telemetry_backup.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<full-backup-content>\n${exclusions}\n</full-backup-content>\n`
  );
  fs.writeFileSync(
    path.join(dir, 'hiraia_telemetry_transfer.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<data-extraction-rules>\n  <cloud-backup>\n${exclusions}\n  </cloud-backup>\n  <device-transfer>\n${exclusions}\n  </device-transfer>\n</data-extraction-rules>\n`
  );
}
function withTelemetryBackup(config) {
  config = withAndroidManifest(config, (config) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    app.$['android:fullBackupContent'] = '@xml/hiraia_telemetry_backup';
    app.$['android:dataExtractionRules'] = '@xml/hiraia_telemetry_transfer';
    return config;
  });
  return withDangerousMod(config, [
    'android',
    async (config) => {
      writeRules(config.modRequest.projectRoot);
      return config;
    },
  ]);
}
module.exports = withTelemetryBackup;
module.exports.writeRules = writeRules;
