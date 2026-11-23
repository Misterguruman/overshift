# Overshift prototype

A playable first slice of Overshift, a factory-automation programming puzzle for dual-screen handhelds.
The deck runs on the top screen; you write Servo's program on the bottom screen.

## Folders

- `web/` the game: plain HTML, CSS and JavaScript, no build step. Open `web/index.html` through any
  local web server (for example `npx http-server web`).
  - `?screen=both` (default) one page: deck and editor side by side (landscape) or stacked (portrait)
  - `?screen=deck` and `?screen=editor` in two browser windows: mimics two screens on a laptop
  - `?unlock=all` opens every contract
- `web/js/core.js` contracts, program model and the Servo interpreter (pure, runs in node too)
- `web/js/game.js` the game host: editing, running, step back, scoring, saves, button handling
- `web/js/deck.js` the top-screen canvas view; `editor.js` the bottom-screen editor; `input.js`
  keyboard, Gamepad API and shell buttons; `audio.js` synthesized sound; `main.js` screen roles and transport
- `dist/overshift.html` one self-contained file of the whole game (made by `node tools/build.js`)
- `android/` the Kotlin dual-screen shell (see `android/README.md`)
- `.github/workflows/build.yml` the GitHub Actions build (see Builds on GitHub below)
- `test/` `run-tests.js` (node, headless: every contract's reference solution on every stream, faults,
  compile errors, editing and running by simulated buttons) and `browser-check.js` (headless Chromium:
  page errors, layouts, playing contract 1, two-window mode, hot-plug layout switch)

## Run the tests

```
npm install
npm test                                   # headless game tests
npm run build                              # dist/overshift.html and the Android assets
npx http-server web -p 8765 &              # then, in another shell:
node test/browser-check.js /tmp/shots      # headless Chromium smoke test
```

## Builds on GitHub

`.github/workflows/build.yml` runs on every push to `main` and every pull request:

1. runs the headless tests, bundles `dist/overshift.html` and runs the browser smoke test;
2. runs the Android unit tests and builds the APK, signed with Overshift's fixed key (below), ready
   to sideload.

Download the results from the run's page under **Artifacts**: `overshift-apk` (the APK to sideload),
`overshift-browser` (the one-file game) and `screenshots` (from the browser test).

To publish a release, open **Actions > Build > Run workflow** on GitHub, type a version like `v0.2.0`
and run it (or push a version tag: `git tag v0.2.0 && git push origin v0.2.0`). The workflow then
makes a GitHub Release with the APK and `overshift.html` attached, so the Thor can download the
APK straight from the release page. Release APKs are named after the version (`overshift-v0.4.0.apk`)
and carry it as their versionName and versionCode, so each one installs over the last.

## Updates inside the app

When the app starts it reads this repository's latest release from the public GitHub API (no
account or token, so the repository has to be public). If the release's tag is newer than the
installed version, it offers to download the APK and hands it to Android's installer, which asks
the player to confirm. Dev builds from plain pushes (versionName `dev-<commit>`) never ask, and no
network just means no prompt. Code: `android/app/src/main/java/app/overshift/proto/Updater.kt`.

## Signing key

Android only installs an update over an app signed with the same key, so every CI build is signed
with one fixed key. It is never stored anywhere: `tools/signing-key.py` rebuilds the same key and
certificate on every run from one repository secret, **`OVERSHIFT_SIGNING_PASSWORD`**
(Settings > Secrets and variables > Actions). The script's header says exactly how.

- Set it once to a long random password (24+ characters, from a password manager) and never change
  it: a new password means a new key, and every installed copy would need uninstalling once.
- Releases refuse to build without it. Plain builds without it (pull requests from forks, local
  builds) fall back to Gradle's debug key.
- Apps signed with the old debug key (v0.1.0 to v0.3.0) must be uninstalled once before installing
  the first release signed with the fixed key (each of those was signed with a different throwaway
  key). Uninstalling deletes the app's saves; updates after that keep them.

## What's in this build

- All 8 starting instructions, 5 stations, 10 chapter 1 contracts, 3 visible and 2 hidden streams
  from contract 7 on. Par sizes come from the design doc; par cycles from the reference solutions.
- Step, Step back, Run, Fast, Reset; faults stop the line and light the line that caused them.
- Size and Cycles, Cleared / Lean / Fast chips, best scores, contracts unlock in order, autosave.
- Gamepad, touch and keyboard. Trace-back: tap a shipped or scrapped cell (or right stick + R3).
- Synthesized sound: each shipped cell plays a note pitched by its charge.

## Differences from the design doc, for now

- One autosaved program per contract instead of 3 save slots.
- L3 opens the contract board (the doc has it toggle the order ticket, which is always shown here).
- No drag-to-insert, long-press menu, ambience pad, rain, haptics or narrow two-row deck layout yet.
