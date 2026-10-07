package com.hiraia.provisioner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class PackagePolicyTest {
    private val keep = PackagePolicy.KEEP.toSet()
    private val hide = PackagePolicy.HIDE.toSet()
    private val uninstall = PackagePolicy.UNINSTALL.toSet()

    /** package -> kind, launcher-visible, from the first JP1's inventory. */
    private val inventory: Map<String, Pair<String, Boolean>> =
        File("../../devices/jp1-packages.tsv").readLines()
            .filter { !it.startsWith("#") && !it.startsWith("package\t") && it.isNotBlank() }
            .associate { line -> line.split('\t').let { it[0] to (it[1] to (it[3] == "yes")) } }

    @Test
    fun noPackageIsOnTwoLists() {
        assertEquals(emptySet<String>(), keep intersect hide)
        assertEquals(emptySet<String>(), keep intersect uninstall)
        assertEquals(emptySet<String>(), hide intersect uninstall)
    }

    @Test
    fun whatThePhoneCannotDoWithoutIsKept() {
        for (name in listOf("com.hiraia.app", "com.hiraia.provisioner", "com.android.launcher3", "com.android.settings",
                "com.google.android.gms", "com.google.android.inputmethod.latin", "com.google.android.permissioncontroller",
                "com.android.systemui", "com.google.android.webview")) {
            assertTrue(name, name in keep)
        }
    }

    /**
     * Google's device management will not let an admin disallow these, "critical for a device to
     * function correctly" (Google Workspace Admin Help, "Manage system apps on company-owned mobile
     * devices", read Sept 26 2026). Hiding one is a bet Google itself will not make.
     */
    private val googleCritical = setOf(
        "android", "com.android.bluetooth", "com.android.contacts", "com.android.keychain",
        "com.android.keyguard", "com.android.launcher", "com.android.nfc", "com.android.phone",
        "com.android.providers.downloads", "com.android.settings", "com.android.systemui",
        "com.android.vending", "com.google.android.deskclock", "com.google.android.dialer",
        "com.google.android.gms", "com.google.android.GoogleCamera", "com.google.android.googlequicksearchbox",
        "com.google.android.gsf", "com.google.android.gsf.login", "com.google.android.inputmethod.latin",
        "com.google.android.marvin.talkback", "com.google.android.nfcprovision", "com.google.android.setupwizard",
        "com.google.android.webview", "com.samsung.android.contacts", "com.samsung.android.phone",
    )

    @Test
    fun nothingGoogleCallsCriticalIsHiddenOrRemoved() {
        assertEquals(emptySet<String>(), googleCritical intersect (hide + uninstall))
    }

    @Test
    fun uninstallOnlyNamesUserInstallsAndHideOnlySystemApps() {
        for (name in uninstall) assertEquals(name, "preinstalled-user", inventory[name]?.first)
        for (name in hide) assertEquals(name, "system", inventory[name]?.first)
    }

    @Test
    fun everyAppAStudentCouldSeeIsDecided() {
        val visible = inventory.filter { it.value.second }.keys
        assertEquals(emptySet<String>(), visible - keep - hide - uninstall)
    }

    @Test
    fun androidIsToldAboutEveryPackageThePolicyTouches() {
        val manifest = File("src/main/AndroidManifest.xml").readText()
        val declared = Regex("""<package android:name="([^"]+)"""").findAll(manifest).map { it.groupValues[1] }.toSet()
        assertEquals(emptySet<String>(), keep + hide + uninstall - declared)
    }

    @Test
    fun theWallpaperShipsWithTheApp() {
        // DeviceSetup sets it from the APK's assets; without it every phone reports a failure.
        val image = File("src/main/assets/${DeviceSetup.WALLPAPER_ASSET}")
        assertTrue("missing $image: add the Hiraia wallpaper (a PNG) before building", image.isFile)
        val png = byteArrayOf(0x89.toByte(), 'P'.code.toByte(), 'N'.code.toByte(), 'G'.code.toByte())
        assertTrue("$image is not a PNG", image.readBytes().copyOf(4).contentEquals(png))
    }
}
