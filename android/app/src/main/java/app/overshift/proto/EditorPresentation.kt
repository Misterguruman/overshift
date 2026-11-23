package app.overshift.proto

import android.app.Presentation
import android.content.Context
import android.os.Bundle
import android.view.Display
import android.view.WindowManager
import android.webkit.WebView

/**
 * The program editor on the second (smaller) screen.
 *
 * The window is FLAG_NOT_FOCUSABLE: it still takes touch, but Android never moves key focus to it,
 * so gamepad buttons always reach the deck window on the main screen. Without this, touching the
 * bottom screen would steal the controller from the game (the Thor's single-focus behaviour).
 */
class EditorPresentation(
    outerContext: Context,
    display: Display,
    private val onMessage: (String) -> Unit,
) : Presentation(outerContext, display) {

    lateinit var web: WebView
        private set

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window?.addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE)
        window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        web = makeGameWebView(context, PageBridge({ "editor" }, onMessage), "editor")
        setContentView(web)
        web.loadUrl(GAME_URL)
    }

    override fun onStop() {
        web.destroy()
        super.onStop()
    }
}
