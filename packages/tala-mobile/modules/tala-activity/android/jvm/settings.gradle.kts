// Standalone JVM build for the module's pure-Kotlin classes and their unit tests. The Android
// library itself (../build.gradle) is built by the Expo app (Worker E); this file lets Worker P run
// the protocol tests on the shared host without an Android project:
//   gradle -p modules/tala-activity/android/jvm test --max-workers 2
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        google()
    }
}
rootProject.name = "tala-activity-jvm"
