import * as Application from 'expo-application';
import Constants from 'expo-constants';

// Settings and telemetry describe the installed APK. Expo config is only a
// development fallback; it can differ from Android's installed PackageInfo.
export const APP_VERSION = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? 'unknown';
export const APP_BUILD = Application.nativeBuildVersion ?? String(Constants.expoConfig?.android?.versionCode ?? 'unknown');
