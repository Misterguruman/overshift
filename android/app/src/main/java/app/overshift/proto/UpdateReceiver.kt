package app.overshift.proto

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.util.Log
import android.widget.Toast

/**
 * Hears back from Android's package installer after [Updater] hands it a downloaded update.
 * The first answer is "needs the player's OK": we open the system's install screen. Android shows
 * it (and, the first time, asks to allow installs from Overshift). On success the app is replaced
 * and restarts from the launcher, so there is nothing to do here.
 */
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
                }
                if (confirm != null) {
                    confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(confirm)
                }
            }
            PackageInstaller.STATUS_SUCCESS -> Unit
            PackageInstaller.STATUS_FAILURE_ABORTED -> Unit // the player said no; ask again next launch
            else -> {
                val detail = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
                Log.w("Overshift", "Update install failed: status $status, $detail")
                val text = if (status == PackageInstaller.STATUS_FAILURE_CONFLICT ||
                    status == PackageInstaller.STATUS_FAILURE_INCOMPATIBLE
                ) {
                    "The update can't replace this copy of Overshift. Uninstall it, then install the new version from the releases page."
                } else {
                    "The update didn't install. Overshift will offer it again next time."
                }
                Toast.makeText(context, text, Toast.LENGTH_LONG).show()
            }
        }
    }

    companion object {
        const val ACTION = "app.overshift.proto.UPDATE_STATUS"
    }
}
