package app.overshift.proto

/** Release versions are tags like v0.4.0. Anything else (dev builds) has no version to compare. */
object Versions {
    private val pattern = Regex("""^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})$""")

    /** [major, minor, patch], or null for anything that isn't a plain vX.Y.Z / X.Y.Z. */
    fun parse(text: String?): List<Int>? =
        text?.trim()?.let { pattern.matchEntire(it) }?.groupValues?.drop(1)?.map { it.toInt() }

    /** True when [candidate] is a later release than [current]. */
    fun isNewer(candidate: List<Int>, current: List<Int>): Boolean {
        for (i in 0 until 3) {
            if (candidate[i] != current[i]) return candidate[i] > current[i]
        }
        return false
    }
}
