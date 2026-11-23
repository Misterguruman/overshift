# Overshift Android shell

A small Kotlin app that runs Overshift on dual-screen Android handhelds (AYN Thor, AYANEO Pocket DS,
Retroid with the dual-screen add-on) and on ordinary single-screen phones.

## What it does

- **Top / main screen:** `MainActivity` shows the deck page in a WebView. That page owns all game state.
- **Bottom / second screen:** `EditorPresentation` (an Android `Presentation`) shows the editor page in a
  second WebView. Its window is `FLAG_NOT_FOCUSABLE`, so touching it never steals the controller.
- **Bridge:** each page calls `OvershiftNative.send(json)`; the Activity hands the message to the other
  page with `Overshift.receive(json)`. The editor sends taps, the deck sends back state snapshots.
- **Controller:** `MainActivity.dispatchKeyEvent` / `dispatchGenericMotionEvent` catch every gamepad
  event and pass it to the deck page as `Overshift.nativeButton(name, pressed)` (`PadMapper.kt`).
  The page's own Gamepad API polling is switched off inside the shell to avoid double input.
- **Hot-plug:** a `DisplayManager` listener opens or closes the editor screen when a presentation display
  appears, disappears or turns off (the Thor's long-press to turn off the bottom screen, the Retroid
  add-on unplugged). The deck page then switches between its deck-only and side-by-side layouts.
  Game state lives in the deck page, so a run in progress is not lost.
- **One screen:** with no second display the deck page shows the deck and editor side by side.

Screens are found at runtime by role (`DISPLAY_CATEGORY_PRESENTATION`), never by a fixed display id.

## Build

Needs Android Studio (Ladybug or newer) or the Android SDK command-line tools with platform 35, and JDK 17+.

1. Copy the latest game files into the app's assets (run from the `overshift` folder):
   ```
   node tools/build.js
   ```
   This refreshes `app/src/main/assets/web/` from `web/`.
2. Build the APK, either by opening this `android` folder in Android Studio and choosing
   Build > Build APK(s), or from a terminal in this folder:
   ```
   ./gradlew assembleDebug
   ```
   If Gradle can't find the SDK, create `local.properties` with `sdk.dir=/path/to/Android/sdk`.
   The APK lands in `app/build/outputs/apk/debug/app-debug.apk`.

## Install on the Thor

1. On the Thor: Settings > About > tap Build number 7 times, then Developer options > USB debugging on.
2. Connect it by USB and run:
   ```
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```
   Or copy the APK to the device and open it from a file manager (allow installs from that app).
3. Long-press the Overshift icon > Screen Launch > Top, so the deck opens on the big screen.
4. To debug either screen's page, open `chrome://inspect` on a computer while the device is connected.

## Status

- Not built or run here: the cloud machine this was written on could not download the Android SDK
  (Google's download host is blocked from it), so there is no APK yet.
- The Kotlin sources were compiled against the Android 13 framework classes (Robolectric's
  `android-all`) to catch errors; they compile cleanly. That check does not cover the Gradle
  Android build, the manifest or resources, so expect to fix small things on the first real build.
- Unverified on hardware: input focus with the non-focusable bottom window, which display the Thor
  reports as the presentation display, audio start-up in WebView, and two-WebView performance on
  the Snapdragon 865 Lite. These are the first things to check on a device.
- If the second display is larger than the main one (some devices), the deck still stays on the main
  screen; swapping roles by size is a to-do.
