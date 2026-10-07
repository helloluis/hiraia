package com.hiraia.provisioner

/**
 * Which apps a student's phone keeps, written against the first JP1's full inventory
 * (packages/provisioner/devices/jp1-packages.tsv) and Luis's choices of Sept 26 2026. Explicit
 * lists, never "everything without a launcher icon": guessing at "core" apps is how a phone ends
 * up without its keyboard or its permission screen. A package on no list is left alone.
 */
object PackagePolicy {
    /** Preloaded crypto, shopping, social and game apps. User installs, so they can be removed. */
    val UNINSTALL = listOf(
        "app.backpack.mobile",
        "coin98.crypto.finance.media",
        "com.aptoslabs.petra.wallet",
        "com.einnovation.temu",
        "com.matr1x.fire",
        "com.metamerge.xyz",
        "com.mobilecoin.moby",
        "com.mysticgames.cov",
        "com.twitter.android",
        "com.zhiliaoapp.musically",
        "com.zzkko",
        "io.yellowcard.app",
        "sleep.monitor.sleep.tracker.app",
    )

    /**
     * Built into the system image, so they cannot be removed; hidden, they cannot be seen or run.
     * Reversible: taking a package off this list unhides it at the next check-in.
     */
    val HIDE = listOf(
        "com.jambo",
        "com.google.android.youtube",
        "com.google.android.apps.youtube.music",
        "com.google.android.videos",
        "com.google.android.gm",
        "com.google.android.apps.docs",
        "com.google.android.apps.maps",
        // The Assistant's launcher icon only. The Google app behind it stays: see KEEP.
        "com.google.android.apps.googleassistant",
        "com.google.android.keep",
        "com.google.android.apps.adm",
        "com.google.android.apps.safetyhub",
        "com.android.fmradio",
        "com.android.soundrecorder",
    )

    /** The home screen's order: Hiraia first, then the rest of the students' apps. */
    val HOME_ORDER = listOf(
        "com.hiraia.app",
        "com.android.chrome",
        "com.google.android.apps.nbu.files",
        "com.google.android.apps.tachyon",
        "com.android.camera2",
        "com.google.android.apps.photos",
        "com.google.android.deskclock",
        "com.google.android.calculator",
        "com.google.android.calendar",
        "com.google.android.dialer",
        "com.google.android.apps.messaging",
        "com.google.android.contacts",
        "com.android.vending",
        "com.android.settings",
    )

    /**
     * What stays, and what the phone cannot do without. Nothing here is ever hidden or removed,
     * whatever the other lists say; anything here that is hidden gets unhidden.
     */
    val KEEP = listOf(
        // Students' apps (Luis: Hiraia, Chrome, Files, Meet, Settings; plus everyday tools,
        // phone and messaging, and the Play Store).
        "com.hiraia.app",
        "com.android.chrome",
        "com.google.android.apps.nbu.files",
        "com.google.android.apps.tachyon",
        "com.android.settings",
        "com.android.camera2",
        "com.google.android.apps.photos",
        "com.google.android.deskclock",
        "com.google.android.calculator",
        "com.google.android.calendar",
        "com.google.android.dialer",
        "com.google.android.apps.messaging",
        "com.google.android.contacts",
        "com.android.vending",
        // What the phone itself needs.
        "com.hiraia.provisioner",
        "com.android.launcher3",
        "com.android.systemui",
        "com.android.phone",
        "com.google.android.gms",
        "com.google.android.gsf",
        "com.google.android.webview",
        "com.google.android.inputmethod.latin",
        "com.google.android.permissioncontroller",
        "com.google.android.packageinstaller",
        "com.android.managedprovisioning",
        "com.google.android.setupwizard",
        // The Google app (search bar, Assistant, voice). Luis chose to hide it, but Google's own
        // device management counts it among the system apps "critical for a device to function
        // correctly" that an admin may not disallow, beside the launcher, SystemUI, Gboard and
        // setup (Workspace Admin Help, "Manage system apps on company-owned mobile devices").
        "com.google.android.googlequicksearchbox",
    )
}
