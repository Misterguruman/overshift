package app.overshift.proto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VersionsTest {
    @Test fun parsesTagsAndVersionNames() {
        assertEquals(listOf(0, 4, 0), Versions.parse("v0.4.0"))
        assertEquals(listOf(1, 12, 3), Versions.parse("1.12.3"))
        assertEquals(listOf(2, 0, 10), Versions.parse(" v2.0.10 "))
    }

    @Test fun devBuildsAndOddTagsHaveNoVersion() {
        assertNull(Versions.parse("dev-c45fb6c"))
        assertNull(Versions.parse("0.1-prototype"))
        assertNull(Versions.parse("v1.2"))
        assertNull(Versions.parse("v1.2.3-beta"))
        assertNull(Versions.parse(null))
    }

    @Test fun comparesPartByPartNotAsText() {
        assertTrue(Versions.isNewer(listOf(0, 10, 0), listOf(0, 9, 9)))
        assertTrue(Versions.isNewer(listOf(1, 0, 0), listOf(0, 99, 99)))
        assertTrue(Versions.isNewer(listOf(0, 4, 1), listOf(0, 4, 0)))
        assertFalse(Versions.isNewer(listOf(0, 4, 0), listOf(0, 4, 0)))
        assertFalse(Versions.isNewer(listOf(0, 3, 9), listOf(0, 4, 0)))
    }
}
