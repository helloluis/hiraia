package com.hiraia.app

import android.util.Log
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Canary_Android
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Experimental_Android
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsProvider

/** RN 0.81 otherwise measures text with a constant font-size multiplier in Fabric's
 * cache key. After a system font change, glyphs and cached bounds disagree. Enable
 * the upstream fix at application bootstrap, before any React runtime/surface exists.
 * Keep every other flag exactly as DefaultNewArchitectureEntryPoint configured it.
 * Remove this compatibility shim when upgrading to RN's enabled-by-default fix.
 */
object HiraiaFontScale {
  fun install() {
    if (!BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) return
    val defaults: ReactNativeFeatureFlagsProvider = when (DefaultNewArchitectureEntryPoint.releaseLevel) {
      ReleaseLevel.EXPERIMENTAL -> ReactNativeFeatureFlagsOverrides_RNOSS_Experimental_Android()
      ReleaseLevel.CANARY -> ReactNativeFeatureFlagsOverrides_RNOSS_Canary_Android()
      ReleaseLevel.STABLE -> ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android(true, true, true)
    }
    // The entry point already registered a provider. Replace it only here, before
    // ApplicationLifecycleDispatcher can create a React context; never at runtime.
    val accessed = ReactNativeFeatureFlags.dangerouslyForceOverride(
      object : ReactNativeFeatureFlagsProvider by defaults {
        override fun enableFontScaleChangesUpdatingLayout(): Boolean = true
      }
    )
    Log.i("HiraiaFontScale", "Font measurement fix enabled before React startup; prior flags: ${accessed ?: "none"}")
  }
}
