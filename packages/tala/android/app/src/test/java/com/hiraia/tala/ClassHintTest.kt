package com.hiraia.tala

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ClassHintTest {
    // The same vectors are checked by the student app; a mismatch means no phone ever connects.
    @Test
    fun hintsMatchTheSharedTestVectors() {
        assertEquals("WlOusN1s", ClassHint.of("0f8fad5b-d9cb-469f-a165-70867728950e"))
        assertEquals("x3ejyN5T", ClassHint.of("7c9e6679-7425-40de-944b-e07fc1f90ae7"))
    }

    @Test
    fun endpointNameIsTheVersionedPrefixAndOneHint() {
        val name = ClassHint.endpointName("0f8fad5b-d9cb-469f-a165-70867728950e")
        assertEquals("Hiraia Tala 2 WlOusN1s", name)
        // Nearby endpoint info is small; leave room for more hints after this one.
        assertTrue(name.toByteArray(Charsets.UTF_8).size <= 32)
    }
}
