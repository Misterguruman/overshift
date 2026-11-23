package app.overshift.proto

import android.app.Activity
import android.content.Context
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Display
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.WebView

/**
 * Overshift's Android shell.
 *
 * The main screen shows the deck page, which owns all game state. If a second display exists,
 * an [EditorPresentation] shows the editor page there; the two pages talk only through this
 * Activity (each page calls OvershiftNative.send, the shell calls Overshift.receive on the other).
 * With one display, the deck page switches to its side-by-side layout and shows the editor too.
 * Displays can come and go mid-run (the Thor's bottom-screen-off button, the Retroid add-on);
 * the game state lives in the deck page, so nothing is lost.
 *
 * All controller input is caught here and forwarded to the deck page, whatever screen was touched.
 */
class MainActivity : Activity() {

    private lateinit var deck: WebView
    private var editor: EditorPresentation? = null
    private lateinit var displays: DisplayManager
    private val main = Handler(Looper.getMainLooper())
    private lateinit var pad: PadMapper

    private val displayListener = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(displayId: Int) = refreshScreens()
        override fun onDisplayRemoved(displayId: Int) = refreshScreens()
        override fun onDisplayChanged(displayId: Int) = refreshScreens()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        displays = getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
        pad = PadMapper { button, down -> deck.callGame("Overshift.nativeButton('$button', $down)") }

        deck = makeGameWebView(this, PageBridge({ "deck" }, ::fromDeck), "deck")
        setContentView(deck)
        deck.webViewClient = object : android.webkit.WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) = applyLayout()
        }
        deck.loadUrl(GAME_URL)
        deck.requestFocus()
        hideSystemBars()
        Updater(this).checkOnLaunch() // offers a newer GitHub release, if there is one
    }

    override fun onResume() {
        super.onResume()
        displays.registerDisplayListener(displayListener, main)
        refreshScreens()
    }

    override fun onPause() {
        deck.callGame("Overshift.onPause()") // the game pauses (and has already saved) on losing focus
        displays.unregisterDisplayListener(displayListener)
        super.onPause()
    }

    override fun onDestroy() {
        editor?.dismiss()
        editor = null
        deck.destroy()
        super.onDestroy()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    // ---------- screens ----------

    /**
     * Pick the screen for the editor: a presentation display other than ours. Screens are matched by
     * role, never by a hard-coded id (the Thor's bottom panel has shown up as display 4).
     * If the second display is larger than ours, we log it; the deck stays with this Activity.
     */
    private fun editorDisplay(): Display? {
        val mine = deck.display?.displayId ?: Display.DEFAULT_DISPLAY
        return displays.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION)
            .firstOrNull { it.displayId != mine && it.state != Display.STATE_OFF }
    }

    private fun refreshScreens() {
        val target = editorDisplay()
        val current = editor
        if (current != null && (target == null || current.display.displayId != target.displayId || !current.isShowing)) {
            current.dismiss()
            editor = null
        }
        if (editor == null && target != null) {
            try {
                val p = EditorPresentation(this, target, ::fromEditor)
                p.setOnDismissListener { if (editor === p) { editor = null; applyLayout() } }
                p.show()
                editor = p
            } catch (e: WindowManager.InvalidDisplayException) {
                Log.w("Overshift", "Second display went away before the editor could open", e)
                editor = null
            }
        }
        applyLayout()
    }

    private fun applyLayout() {
        deck.callGame("Overshift.setLayout('${if (editor != null) "deck" else "both"}')")
    }

    // ---------- bridge between the two pages ----------

    private fun fromDeck(json: String) {
        editor?.takeIf { it.isShowing }?.web?.deliver(json)
    }

    private fun fromEditor(json: String) {
        deck.deliver(json)
    }

    // ---------- controller input: always to the deck page ----------

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (pad.onKey(event)) return true
        return super.dispatchKeyEvent(event)
    }

    override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
        if (pad.onMotion(event)) return true
        return super.dispatchGenericMotionEvent(event)
    }

    @Suppress("DEPRECATION")
    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        }
    }
}
