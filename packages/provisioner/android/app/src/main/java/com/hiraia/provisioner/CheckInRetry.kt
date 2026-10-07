package com.hiraia.provisioner

/** Outside the warehouse, a boot must not leave the radio retrying indefinitely. */
internal const val CHECK_IN_RETRY_WINDOW_MS = 15 * 60 * 1000L

internal fun withinCheckInRetryWindow(deadline: Long, now: Long): Boolean =
    deadline > now && deadline - now <= CHECK_IN_RETRY_WINDOW_MS
