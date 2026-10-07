package com.hiraia.provisioner

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ResolveInfo
import android.graphics.Color
import android.os.Bundle
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.widget.GridLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * The phone's home screen: the student's apps in one tidy grid over the Hiraia wallpaper, Hiraia
 * first. The stock launcher cannot be arranged from outside (its layout is private to it), and
 * removing the preloaded apps left its pages full of gaps; a device owner may instead make its own
 * screen the home screen, which DeviceSetup does. The stock launcher stays installed: Android's
 * recent-apps view still comes from it.
 *
 * Operators reach Hiraia Setup by long-pressing the background, so it is not a tile students tap.
 */
class HomeActivity : Activity() {
    private lateinit var grid: GridLayout
    private val changes = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) = render()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setDecorFitsSystemWindows(false)
        val density = resources.displayMetrics.density
        grid = GridLayout(this).apply { columnCount = COLUMNS }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                addView(grid)
            })
            setOnApplyWindowInsetsListener { view, insets ->
                val bars = insets.getInsets(WindowInsets.Type.systemBars())
                view.setPadding((12 * density).toInt(), bars.top + (40 * density).toInt(),
                    (12 * density).toInt(), bars.bottom + (16 * density).toInt())
                insets
            }
            setOnLongClickListener { openSetup(); true }
        }
        grid.setOnLongClickListener { openSetup(); true }
        setContentView(scroll)
    }

    override fun onResume() {
        super.onResume()
        registerReceiver(changes, IntentFilter().apply {
            addAction(Intent.ACTION_PACKAGE_ADDED)
            addAction(Intent.ACTION_PACKAGE_REMOVED)
            addAction(Intent.ACTION_PACKAGE_CHANGED)
            addDataScheme("package")
        })
        render()
    }

    override fun onPause() {
        unregisterReceiver(changes)
        super.onPause()
    }

    /** Home is the bottom of the stack: Back has nowhere to go. */
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() = Unit

    private fun render() {
        grid.removeAllViews()
        val cell = (resources.displayMetrics.widthPixels - (24 * resources.displayMetrics.density).toInt()) / COLUMNS
        for (app in apps()) grid.addView(tile(app, cell))
    }

    /** Launchable apps: the policy's order first, anything installed later after, by name. */
    private fun apps(): List<ResolveInfo> {
        val launchable = packageManager.queryIntentActivities(
            Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
            .filter { it.activityInfo.packageName != packageName && it.activityInfo.packageName !in NOT_ON_HOME }
            .distinctBy { it.activityInfo.packageName }
        val order = PackagePolicy.HOME_ORDER.withIndex().associate { (index, name) -> name to index }
        return launchable.sortedWith(compareBy<ResolveInfo> { order[it.activityInfo.packageName] ?: Int.MAX_VALUE }
            .thenBy { it.loadLabel(packageManager).toString().lowercase() })
    }

    private fun tile(app: ResolveInfo, width: Int): View {
        val density = resources.displayMetrics.density
        val label = app.loadLabel(packageManager).toString()
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, (10 * density).toInt(), 0, (14 * density).toInt())
            layoutParams = GridLayout.LayoutParams().apply { this.width = width }
            contentDescription = label
            isClickable = true
            background = context.getDrawable(android.R.drawable.list_selector_background)
            addView(ImageView(context).apply {
                setImageDrawable(app.loadIcon(packageManager))
                layoutParams = LinearLayout.LayoutParams((56 * density).toInt(), (56 * density).toInt())
            })
            addView(TextView(context).apply {
                text = label
                textSize = 13f
                setTextColor(INK)
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
                gravity = Gravity.CENTER
                setPadding((4 * density).toInt(), (6 * density).toInt(), (4 * density).toInt(), 0)
            })
            setOnClickListener {
                val launch = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
                    .setClassName(app.activityInfo.packageName, app.activityInfo.name)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
                runCatching { startActivity(launch) }
            }
        }
    }

    private fun openSetup() {
        startActivity(Intent(this, StatusActivity::class.java))
    }

    companion object {
        private const val COLUMNS = 4
        /** The website's ink green, readable on the cream wallpaper. */
        private val INK = Color.parseColor("#1C3B2E")
        /**
         * Launchable, but not something a student opens from home. The Google app stays installed
         * because the phone needs it (see PackagePolicy.KEEP), though Luis chose to hide it; this is
         * how it stays out of sight.
         */
        private val NOT_ON_HOME = setOf(
            "com.android.launcher3",
            "com.google.android.googlequicksearchbox",
            "com.google.android.apps.googleassistant",
            "com.android.stk", // SIM toolkit
        )
    }
}
