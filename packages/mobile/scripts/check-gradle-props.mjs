/**
 * Smoke-test the gradle.properties config plugin WITHOUT running a prebuild.
 *
 * The plugin (`plugins/withGradleProps.js`) is the only thing that carries our Gradle
 * settings into an EAS cloud build, and a mistake there fails in the least visible way
 * possible: the APK still builds, it is just fat, unminified, multi-ABI and 145 MB
 * heavier on the wire. So assert the transform here — it is a pure function over the
 * parsed properties list, which is exactly the shape prebuild hands it.
 *
 *   node scripts/check-gradle-props.mjs
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AndroidConfig } = require('@expo/config-plugins');
const { applyManagedProps } = require('../plugins/withGradleProps.js');
const MANAGED_PROPS = require('./gradle-props.cjs');

const { parsePropertiesFile, propertiesListToString } = AndroidConfig.Properties;

// A realistic slice of what `expo prebuild` emits, including the two values it hardcodes
// AGAINST us (all four ABIs, legacy packaging off).
const TEMPLATE = [
  '# Project-wide Gradle settings.',
  'org.gradle.jvmargs=-Xmx512m -XX:MaxMetaspaceSize=512m',
  'android.useAndroidX=true',
  '# Use this property to specify which architecture you want to build.',
  'reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64',
  'expo.useLegacyPackaging=false',
  '',
].join('\n');

const out = propertiesListToString(applyManagedProps(parsePropertiesFile(TEMPLATE)));
const parsed = parsePropertiesFile(out).filter((i) => i.type === 'property');

let failed = 0;
const check = (ok, msg) => {
  if (!ok) {
    console.error(`FAIL  ${msg}`);
    failed++;
  }
};

for (const [key, value] of MANAGED_PROPS) {
  const hits = parsed.filter((i) => i.key === key);
  check(hits.length === 1, `${key}: expected exactly one entry, found ${hits.length}`);
  check(hits[0]?.value === value, `${key}: expected "${value}", got "${hits[0]?.value}"`);
}
// Untouched keys must survive.
check(
  parsed.some((i) => i.key === 'android.useAndroidX' && i.value === 'true'),
  'android.useAndroidX was dropped — the transform is deleting properties it does not own'
);
// Idempotent: prebuild + a re-run must not stack duplicates.
const twice = parsePropertiesFile(
  propertiesListToString(applyManagedProps(parsePropertiesFile(out)))
).filter((i) => i.type === 'property' && i.key === 'expo.useLegacyPackaging');
check(twice.length === 1, `not idempotent: ${twice.length} copies of expo.useLegacyPackaging`);

if (failed) {
  console.error(`\n${failed} check(s) failed. Generated file:\n${out}`);
  process.exit(1);
}
console.log(`[check-gradle-props] OK — ${MANAGED_PROPS.length} properties pinned, idempotent`);
