package app.overshift.proto

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.util.Log
import org.json.JSONObject

/** Where the game's pages live inside the APK (copied there by `node tools/build.js`). */
const val GAME_URL = "file:///android_asset/web/index.html"

/**
 * The page's side of the bridge. Each WebView gets one, exposed to JavaScript as
 * `window.OvershiftNative`. `role()` tells the page which screen it is ("deck", "editor" or "both");
 * `send(json)` hands a message to the shell, which delivers it to the other screen.
 */
class PageBridge(private val role: () -> String, private val onMessage: (String) -> Unit) {
    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun role(): String = role.invoke()

    @JavascriptInterface
    fun send(json: String) {
        // JavascriptInterface calls arrive on a background thread; WebViews live on the main thread.
        main.post { onMessage(json) }
    }
}

@SuppressLint("SetJavaScriptEnabled")
fun makeGameWebView(context: Context, bridge: PageBridge, tag: String): WebView {
    WebView.setWebContentsDebuggingEnabled(true) // inspect both screens from chrome://inspect
    return WebView(context).apply {
        setBackgroundColor(Color.BLACK)
        overScrollMode = View.OVER_SCROLL_NEVER
        isVerticalScrollBarEnabled = false
        isHorizontalScrollBarEnabled = false
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true           // saves and progress (localStorage)
        settings.allowFileAccess = true              // file:///android_asset pages
        settings.mediaPlaybackRequiresUserGesture = false // synthesized sound on the first button press
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false
        addJavascriptInterface(bridge, "OvershiftNative")
        webViewClient = WebViewClient()
        webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                Log.d("Overshift/$tag", "${m.message()} (${m.sourceId()}:${m.lineNumber()})")
                return true
            }
        }
    }
}

/** Calls `Overshift.receive(json)` in a page, with the JSON passed as a quoted string literal. */
fun WebView.deliver(json: String) {
    evaluateJavascript("window.Overshift && Overshift.receive(${JSONObject.quote(json)})", null)
}

fun WebView.callGame(js: String) {
    evaluateJavascript("window.Overshift && $js", null)
}
