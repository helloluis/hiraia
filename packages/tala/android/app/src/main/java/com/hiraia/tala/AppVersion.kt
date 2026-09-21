package com.hiraia.tala

import android.content.Context

/** Installed package identity shared by Settings and activity uploads. */
data class AppVersion(val version: String, val build: Long) {
    companion object {
        fun installed(context: Context): AppVersion {
            val info = context.packageManager.getPackageInfo(context.packageName, 0)
            return AppVersion(info.versionName ?: "unknown", info.longVersionCode)
        }
    }
}
