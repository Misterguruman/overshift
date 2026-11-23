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
2. builds the Android APK, signed with a debug key, ready to sideload.

Download the results from the run's page under **Artifacts**: `overshift-apk` (the APK to sideload),
`overshift-browser` (the one-file game) and `screenshots` (from the browser test).

To publish a release, open **Actions > Build > Run workflow** on GitHub, type a version like `v0.2.0`
and run it (or push a version tag: `git tag v0.2.0 && git push origin v0.2.0`). The workflow then
makes a GitHub Release with the APK and `overshift.html` attached, so the Thor can download the
APK straight from the release page.

## What's in this build

- All 8 starting instructions, 5 stations, 10 chapter 1 contracts, 3 visible and 2 hidden streams
  from contract 7 on. Par sizes come from the design doc; par cycles from the reference solutions.
- Step, Step back, Run, Fast, Reset; faults stop the line and light the line that caused them.
- Size and Cycles, Cleared / Lean / Fast chips, best scores, contracts unlock in order, autosave.
- Gamepad, touch and keyboard. Trace-back: tap a shipped or scrapped cell (or right stick + R3).
- Synthesized sound: each shipped cell plays a note pitched by its charge.

## Differences from the design doc, for now

- One autosaved program per contract instead of 3 save slots.
- D-pad left/right changes the value on the cursor line (the doc has the cursor move onto the value).
- L3 opens the contract board (the doc has it toggle the order ticket, which is always shown here).
- No drag-to-insert, long-press menu, ambience pad, rain, haptics or narrow two-row deck layout yet.
