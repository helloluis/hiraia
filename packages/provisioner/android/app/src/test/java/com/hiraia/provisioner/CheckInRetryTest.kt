package com.hiraia.provisioner

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CheckInRetryTest {
    @Test fun bootAndInterruptedTransferWaitForWifiWithinTheWindow() {
        val boot = 1_000_000L
        val deadline = boot + CHECK_IN_RETRY_WINDOW_MS
        assertTrue(withinCheckInRetryWindow(deadline, boot))
        assertTrue(withinCheckInRetryWindow(deadline, deadline - 1))
    }

    @Test fun leavingTheWarehouseDoesNotRetryForever() {
        val deadline = 1_000_000L + CHECK_IN_RETRY_WINDOW_MS
        assertFalse(withinCheckInRetryWindow(deadline, deadline))
        assertFalse(withinCheckInRetryWindow(deadline, deadline + 1))
        assertFalse(withinCheckInRetryWindow(0, 1_000_000))
    }

    @Test fun clockRollbackCannotExtendAnOldRetryWindow() {
        val boot = 1_000_000L
        assertFalse(withinCheckInRetryWindow(boot + CHECK_IN_RETRY_WINDOW_MS, boot - 1))
    }
}
