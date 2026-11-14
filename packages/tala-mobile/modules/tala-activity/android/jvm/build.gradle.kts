plugins {
    kotlin("jvm") version "2.1.20"
}

repositories {
    mavenCentral()
    google()
}

kotlin {
    jvmToolchain(17)
    sourceSets {
        main {
            kotlin.srcDir("../src/main/java")
            // Android-only files are excluded here; everything else is plain JVM.
            kotlin.exclude("**/ClassKeys.kt", "**/TalaActivityModule.kt", "**/NearbyAdvertiser.java")
        }
        test { kotlin.srcDir("../src/test/java") }
    }
}

sourceSets {
    main { java.exclude("**/NearbyAdvertiser.java") }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20180813")
}

tasks.test {
    useJUnit()
    testLogging { events("passed", "failed", "skipped") }
}
