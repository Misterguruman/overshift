package app.overshift.proto

import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent

/**
 * Turns Android controller events into the game's virtual buttons
 * (up down left right A B X Y L1 R1 L2 R2 L3 R3 start select rsLeft rsRight).
 * Sticks, the hat and analog triggers become digital buttons with thresholds,
 * and only changes are reported, through [emit] (button name, pressed).
 */
class PadMapper(private val emit: (String, Boolean) -> Unit) {

    private val axisState = HashMap<String, Boolean>()

    fun keyName(keyCode: Int): String? = when (keyCode) {
        KeyEvent.KEYCODE_DPAD_UP -> "up"
        KeyEvent.KEYCODE_DPAD_DOWN -> "down"
        KeyEvent.KEYCODE_DPAD_LEFT -> "left"
        KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
        KeyEvent.KEYCODE_BUTTON_A, KeyEvent.KEYCODE_DPAD_CENTER -> "A"
        KeyEvent.KEYCODE_BUTTON_B -> "B"
        KeyEvent.KEYCODE_BUTTON_X -> "X"
        KeyEvent.KEYCODE_BUTTON_Y -> "Y"
        KeyEvent.KEYCODE_BUTTON_L1 -> "L1"
        KeyEvent.KEYCODE_BUTTON_R1 -> "R1"
        KeyEvent.KEYCODE_BUTTON_L2 -> "L2"
        KeyEvent.KEYCODE_BUTTON_R2 -> "R2"
        KeyEvent.KEYCODE_BUTTON_THUMBL -> "L3"
        KeyEvent.KEYCODE_BUTTON_THUMBR -> "R3"
        KeyEvent.KEYCODE_BUTTON_START -> "start"
        KeyEvent.KEYCODE_BUTTON_SELECT -> "select"
        else -> null
    }

    private fun isPad(source: Int): Boolean =
        source and InputDevice.SOURCE_GAMEPAD == InputDevice.SOURCE_GAMEPAD ||
            source and InputDevice.SOURCE_JOYSTICK == InputDevice.SOURCE_JOYSTICK ||
            source and InputDevice.SOURCE_DPAD == InputDevice.SOURCE_DPAD

    /** Returns true when the event was a controller button the game used. */
    fun onKey(event: KeyEvent): Boolean {
        var name = keyName(event.keyCode)
        // Some controllers report B as BACK when nothing handles BUTTON_B; treat it as B.
        if (name == null && event.keyCode == KeyEvent.KEYCODE_BACK && isPad(event.source)) name = "B"
        if (name == null) return false
        when (event.action) {
            KeyEvent.ACTION_DOWN -> if (event.repeatCount == 0) emit(name, true)
            KeyEvent.ACTION_UP -> emit(name, false)
        }
        return true // the page repeats held buttons itself
    }

    /** Sticks, hat and analog triggers. Returns true when the event came from a controller. */
    fun onMotion(event: MotionEvent): Boolean {
        if (!isPad(event.source) || event.action != MotionEvent.ACTION_MOVE) return false
        val hatX = event.getAxisValue(MotionEvent.AXIS_HAT_X)
        val hatY = event.getAxisValue(MotionEvent.AXIS_HAT_Y)
        val lx = event.getAxisValue(MotionEvent.AXIS_X)
        val ly = event.getAxisValue(MotionEvent.AXIS_Y)
        val rx = event.getAxisValue(MotionEvent.AXIS_Z)
        val lt = maxOf(event.getAxisValue(MotionEvent.AXIS_LTRIGGER), event.getAxisValue(MotionEvent.AXIS_BRAKE))
        val rt = maxOf(event.getAxisValue(MotionEvent.AXIS_RTRIGGER), event.getAxisValue(MotionEvent.AXIS_GAS))

        set("hat:up", hatY < -0.5f, "up")
        set("hat:down", hatY > 0.5f, "down")
        set("hat:left", hatX < -0.5f, "left")
        set("hat:right", hatX > 0.5f, "right")
        set("ls:up", ly < -0.55f, "up")
        set("ls:down", ly > 0.55f, "down")
        set("ls:left", lx < -0.55f, "left")
        set("ls:right", lx > 0.55f, "right")
        set("rs:left", rx < -0.6f, "rsLeft")
        set("rs:right", rx > 0.6f, "rsRight")
        set("lt", lt > 0.5f, "L2")
        set("rt", rt > 0.5f, "R2")
        return true
    }

    private fun set(key: String, pressed: Boolean, button: String) {
        val was = axisState[key] ?: false
        if (was == pressed) return
        axisState[key] = pressed
        emit(button, pressed)
    }
}
