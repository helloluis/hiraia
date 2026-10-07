package com.hiraia.provisioner

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DpcUpdateTest {
    @Test
    fun aNewerVersionIsTakenUntilAndroidHasRefusedItTwice() {
        assertTrue(Provisioner.wantsDpcUpdate(offered = 6, running = 5, tries = 0))
        assertTrue(Provisioner.wantsDpcUpdate(offered = 6, running = 5, tries = 1))
        assertFalse(Provisioner.wantsDpcUpdate(offered = 6, running = 5, tries = 2))
    }

    @Test
    fun theSameOrAnOlderVersionIsNeverTaken() {
        assertFalse(Provisioner.wantsDpcUpdate(offered = 5, running = 5, tries = 0))
        assertFalse(Provisioner.wantsDpcUpdate(offered = 4, running = 5, tries = 0))
    }
}
