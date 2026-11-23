package app.overshift.proto

import android.app.Activity
import android.app.AlertDialog
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.KeyEvent
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Checks GitHub for a newer Overshift release when the app starts, and offers to install it.
 *
 * - Reads the repository's latest release from the public GitHub API (no account or token; the
 *   repository must be public). Drafts and pre-releases are never offered.
 * - Compares its tag (vX.Y.Z) with this app's versionName. Dev builds ("dev-<commit>") never ask.
 * - On "Update", streams the release's APK into an Android PackageInstaller session; Android then
 *   shows its own install screen, so the player always confirms ([UpdateReceiver]).
 * - No network, a GitHub hiccup or a release without an APK: nothing is shown, the game just runs.
 *
 * The dialogs work by touch and by controller (d-pad to move, A to choose, B to close).
 */
class Updater(private val activity: Activity) {

    private data class Release(val tag: String, val version: List<Int>, val apkUrl: String, val apkSize: Long)

    private val main = Handler(Looper.getMainLooper())

    fun checkOnLaunch() {
        if (checkedThisRun) return
        checkedThisRun = true
        val installed = installedVersion()
        val current = Versions.parse(installed) ?: return // dev build: nothing to compare with
        thread(name = "overshift-update-check", isDaemon = true) {
            try {
                val latest = fetchLatest() ?: return@thread
                if (Versions.isNewer(latest.version, current)) main.post { offer(latest, installed!!) }
            } catch (e: Exception) {
                Log.i("Overshift", "Update check skipped: ${e.javaClass.simpleName}: ${e.message}")
            }
        }
    }

    private fun installedVersion(): String? = try {
        activity.packageManager.getPackageInfo(activity.packageName, 0).versionName
    } catch (e: Exception) {
        null
    }

    private fun fetchLatest(): Release? {
        val conn = (URL(LATEST_RELEASE_URL).openConnection() as HttpURLConnection).apply {
            connectTimeout = 8000
            readTimeout = 8000
            setRequestProperty("Accept", "application/vnd.github+json")
            setRequestProperty("User-Agent", "Overshift-updater")
        }
        try {
            if (conn.responseCode != 200) {
                Log.i("Overshift", "Update check: GitHub answered ${conn.responseCode}")
                return null
            }
            val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            val tag = json.optString("tag_name")
            val version = Versions.parse(tag) ?: return null
            val assets = json.optJSONArray("assets") ?: return null
            for (i in 0 until assets.length()) {
                val asset = assets.getJSONObject(i)
                val url = asset.optString("browser_download_url")
                if (asset.optString("name").endsWith(".apk") && url.startsWith("https://")) {
                    return Release(tag, version, url, asset.optLong("size", -1))
                }
            }
            return null
        } finally {
            conn.disconnect()
        }
    }

    private fun alive() = !activity.isFinishing && !activity.isDestroyed

    private fun offer(release: Release, installed: String) {
        if (!alive()) return
        val size = if (release.apkSize > 0) " (%.1f MB)".format(release.apkSize / 1_000_000.0) else ""
        val dialog = AlertDialog.Builder(activity, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Update available")
            .setMessage("Overshift ${release.tag} is out. You have v$installed.\n\nDownload it now$size? Android will ask you to confirm the install. Your saves stay.")
            .setPositiveButton("Update") { _, _ -> download(release) }
            .setNegativeButton("Later", null)
            .create()
        dialog.setOnKeyListener(padKeys(dialog))
        dialog.show()
        dialog.getButton(AlertDialog.BUTTON_POSITIVE)?.requestFocus()
    }

    private fun download(release: Release) {
        if (!alive()) return
        var cancelled = false
        val progress = AlertDialog.Builder(activity, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Downloading ${release.tag}")
            .setMessage("Starting…")
            .setCancelable(false)
            .setNegativeButton("Cancel") { _, _ -> cancelled = true }
            .create()
        progress.setOnKeyListener(padKeys(progress))
        progress.show()

        val context = activity.applicationContext
        thread(name = "overshift-update-download", isDaemon = true) {
            val installer = context.packageManager.packageInstaller
            var sessionId = -1
            try {
                val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
                params.setAppPackageName(context.packageName)
                sessionId = installer.createSession(params)
                installer.openSession(sessionId).use { session ->
                    val conn = (URL(release.apkUrl).openConnection() as HttpURLConnection).apply {
                        connectTimeout = 15000
                        readTimeout = 30000
                        setRequestProperty("User-Agent", "Overshift-updater")
                    }
                    try {
                        if (conn.responseCode != 200) throw IllegalStateException("download answered ${conn.responseCode}")
                        val total = conn.contentLengthLong.takeIf { it > 0 } ?: release.apkSize
                        session.openWrite("overshift.apk", 0, total).use { out ->
                            conn.inputStream.use { input ->
                                val buffer = ByteArray(64 * 1024)
                                var done = 0L
                                var lastShown = -1
                                while (true) {
                                    if (cancelled) throw InterruptedException("cancelled")
                                    val n = input.read(buffer)
                                    if (n < 0) break
                                    out.write(buffer, 0, n)
                                    done += n
                                    val pct = if (total > 0) (done * 100 / total).toInt() else -1
                                    if (pct != lastShown) {
                                        lastShown = pct
                                        val text = if (pct >= 0) "$pct%" else "%.1f MB".format(done / 1_000_000.0)
                                        main.post { if (progress.isShowing) progress.setMessage(text) }
                                    }
                                }
                            }
                            session.fsync(out)
                        }
                    } finally {
                        conn.disconnect()
                    }
                    val status = Intent(context, UpdateReceiver::class.java).setAction(UpdateReceiver.ACTION)
                    val pending = PendingIntent.getBroadcast(
                        context, sessionId, status,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
                    )
                    session.commit(pending.intentSender)
                }
                main.post { if (progress.isShowing) progress.dismiss() }
            } catch (e: Exception) {
                if (sessionId >= 0) try { installer.abandonSession(sessionId) } catch (_: Exception) {}
                Log.w("Overshift", "Update download failed", e)
                main.post {
                    if (progress.isShowing) progress.dismiss()
                    if (!cancelled && alive()) {
                        val failed = AlertDialog.Builder(activity, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                            .setTitle("Update didn't download")
                            .setMessage("Check the connection and try again. Overshift will offer it again next time it starts.")
                            .setPositiveButton("OK", null)
                            .create()
                        failed.setOnKeyListener(padKeys(failed))
                        failed.show()
                    }
                }
            }
        }
    }

    /** A chooses the focused button, B backs out. The d-pad moves focus between buttons by itself. */
    private fun padKeys(dialog: AlertDialog) = android.content.DialogInterface.OnKeyListener { _, code, event ->
        when (code) {
            KeyEvent.KEYCODE_BUTTON_A -> {
                if (event.action == KeyEvent.ACTION_UP) dialog.currentFocus?.performClick()
                true
            }
            KeyEvent.KEYCODE_BUTTON_B -> {
                if (event.action == KeyEvent.ACTION_UP) {
                    (dialog.getButton(AlertDialog.BUTTON_NEGATIVE) ?: dialog.getButton(AlertDialog.BUTTON_POSITIVE))?.performClick()
                }
                true
            }
            else -> false
        }
    }

    companion object {
        /** The public repository the releases come from. */
        const val LATEST_RELEASE_URL = "https://api.github.com/repos/Misterguruman/overshift/releases/latest"

        /** Once per process: coming back to the app from the home screen doesn't ask again. */
        private var checkedThisRun = false
    }
}
