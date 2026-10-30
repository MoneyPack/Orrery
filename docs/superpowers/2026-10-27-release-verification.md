# Release verification matrix — 2026-10-27

## Environment

- **OS:** Windows 10.0.26200 (win32, x64)
- **Node:** v26.3.0
- **npm:** 11.16.0
- **Commit:** 0b5bf85 (`fix(kernel): harden workspace containment to canonical paths`)
- **Date (UTC):** 2026-10-27
- **Scope:** Verification only — no fixes applied. Failing gates were recorded and the run continued to the next independent gate.

## Results

| # | Gate | Command | Result | Notes |
|---|------|---------|--------|-------|
| 1 | typecheck | `npm run typecheck` | **PASS** | Clean, no output, exit 0 |
| 2 | unit tests | `npx vitest run` | **PASS** | 56 files, 752 passed, 4 skipped, ~72s |
| 3 | production build | `npm run build` | **PASS** | Built in 3.58s; non-fatal postcss warning about `@import` order for `mission-replay-debugger.css` |
| 4 | real mission smoke | `npm run mission:smoke` | **PASS** | "Real mission smoke passed", mission promoted and reviewed |
| 5 | daemon smoke | `npm run daemon:smoke` | **PASS** | "Authoritative daemon smoke passed", incl. reconnect/restart durability and cancellation |
| 6 | desktop build | `npm run desktop:build` | **PASS** | main (166.62 kB), preload (1.90 kB), daemon (210.48 kB) all built |
| 7 | desktop package | `npm run desktop:package` | **PASS** | electron-builder `--dir --win` produced `release\win-unpacked` |
| 8 | desktop smoke | `npm run desktop:smoke` | **FAIL** | Packaged exe exits code 1 before writing `result.json` (reproduced 2x) — see below |
| 9 | Playwright e2e | `npm run test:e2e` (after `npx playwright install chromium`) | **PASS** | Chromium install exit 0; 3/3 specs passed in 12.3s |
| 10 | Theia typecheck | `npm run theia:typecheck` | **PASS** | Extension + test configs clean, exit 0 |
| 11 | Theia tests | `npm run theia:test` | **FAIL** | 189/189 collected tests passed, but `src/structure.test.ts` suite failed to load — Electron binary missing in extension workspace — see below |
| 12 | Theia-app typecheck | `npm run theia-app:typecheck` | **PASS** | Host + test configs clean, exit 0 |
| 13 | Theia-app tests | `npm run theia-app:test` | **PASS** | 4 files, 39/39 passed; non-fatal `Error: disconnect failed` teardown noise in `test/host.test.ts:173` |
| 14 | Theia-app smoke | `npm run theia-app:smoke` | **PASS** | "Full build completed and every Mission Control view rendered in the real renderer" |

**Tally: 12 pass, 2 fail.**

## Failure details

### 8. `desktop:smoke` — FAIL (exit 1, reproduced twice)

Command: `npm run desktop:smoke` (spawns `release\win-unpacked\orrery-mission-control.exe --orrery-smoke --orrery-smoke-result=...`).

Output excerpt (identical both runs):

```text
> orrery-mission-control@0.0.0 desktop:smoke
> node scripts/desktop-smoke.mjs

file:///C:/Users/blazi/orrery/scripts/desktop-smoke.mjs:73
      throw new Error(`Desktop exited before writing a result (code ${code}, signal ${signal ?? "none"})`);
            ^

Error: Desktop exited before writing a result (code 1, signal none)
    at file:///C:/Users/blazi/orrery/scripts/desktop-smoke.mjs:73:13
```

- **Suspected cause:** The packaged executable terminates with code 1 during startup before reaching smoke-mode result emission. No app output was visible (child uses `stdio: "inherit"`, nothing printed). Candidates, untested: (a) headless/no-GUI session prevents Electron startup; (b) a startup exception in the packaged main process (e.g. resource path or smoke-flag handling after packaging changes). Next step for a fix task: launch the exe with `ELECTRON_ENABLE_LOGGING=1` or capture main-process stderr to a file to see the real startup error.

### 11. `theia:test` — FAIL (1 suite unloadable, 189/189 collected tests pass)

Command: `npm run theia:test`.

Output excerpt:

```text
 Test Files  1 failed | 18 passed (19)
      Tests  189 passed (189)

 FAIL  src/structure.test.ts [ src/structure.test.ts ]
Error: Electron failed to install correctly. Please delete `node_modules/electron` and run "npx install-electron --no" manually.
  ❯ getElectronPath node_modules/electron/index.js:43:13
  ❯ Object.<anonymous> node_modules/electron/index.js:52:18
  ❯ Object.<anonymous> node_modules/@theia/electron/shared/electron/index.js:1:18
```

- **Suspected cause:** Environment/install gap, not a code failure. `theia:install` runs with `--ignore-scripts`, which skips the Electron postinstall binary download, so `theia-extensions/mission-control/node_modules/electron` has no usable binary and any suite importing `@theia/electron` fails at import time. Every test that could load passed (189/189). Next step for a fix task: run the manual electron install inside `theia-extensions/mission-control` (per the error message) and re-run; consider whether `theia:install` should download Electron as a separate step.

## Addendum — 2026-10-29: all gates green

Re-ran against commit `eaa2733` (plus uncommitted `desktop:smoke` flag-propagation fix) on Windows 11 (win32 x64), Node v26.3.0, npm 11.16.0:

- `theia:test` now **PASSES**: 19 files, 203/203 (the 2026-10-27 failure was an environment gap — Electron binary missing under `theia-extensions/mission-control/node_modules` because `theia:install` uses `--ignore-scripts`; the binary has since been installed).
- `desktop:smoke` now **PASSES** after the flag-propagation fix: main forwards `--orrery-smoke` to the window via `webPreferences.additionalArguments` (`createWindowOptions` → `secureWebPreferences`), since the sandboxed preload never sees the launcher's `process.argv`. Added covering tests in `electron/main.test.ts` and `packages/electron-security-policy/src/index.test.ts`.
- Full re-run tally **14/14 PASS**: typecheck clean; `npx vitest run` 61 files, 800 passed, 4 skipped; `npm run build` OK; mission and daemon smokes print their pass lines; `desktop:build`, `desktop:package` (`ORRERY_UNSIGNED_LOCAL=1`), and `desktop:smoke` ("Packaged desktop smoke passed."); Playwright e2e 3/3; `theia:typecheck`, `theia:test`, `theia-app:typecheck`, `theia-app:test` (39/39), `theia-app:smoke` all pass.
- Remaining non-blocking noise unchanged: postcss `@import` order warning for `mission-replay-debugger.css`, `disconnect failed` teardown noise in `theia-app:test`.
- No commits made in this session; changes are uncommitted working-tree edits.

## Addendum — 2026-10-29 (evening): Relume-native motion pass, all gates green

Re-ran all 14 gates after the Relume-inspired native motion layer (no Tailwind/shadcn deps; CSS `[data-reveal]`/`[data-stagger]`/`.meter`/`.beacon`/`[data-tick]` + `useReveal`/`useCountUp` hooks wired into welcome-state, runtime-timeline, lifecycle-rail, and replay debugger):

- `typecheck` **PASS** — clean.
- `npx vitest run` **PASS** — full suite green (one assertion updated: boot-sequence welcome assertion now uses `toHaveClass` since reveal adds `is-visible`).
- `npm run build` **PASS** — and the long-standing postcss `@import` order warning is now **fixed**: `mission-replay-debugger.css` import moved to the top of `styles.css`, warning gone.
- `mission:smoke` / `daemon:smoke` **PASS** — pass lines printed.
- `desktop:build` **PASS**; `desktop:package` **PASS** (with `ORRERY_UNSIGNED_LOCAL=1`; plain packaging still exits 1 on code-signing, expected for unsigned local builds); `desktop:smoke` **PASS** ("Packaged desktop smoke passed.").
- `test:e2e` **PASS** — 3/3 Playwright specs.
- `theia:typecheck` **PASS**; `theia:test` **PASS** (203/203); `theia-app:typecheck` **PASS**; `theia-app:test` **PASS** (39/39; known non-fatal `disconnect failed` teardown noise unchanged); `theia-app:smoke` **PASS**.

**Tally: 14/14 PASS.** Remaining noise: none blocking (postcss warning eliminated).

## Addendum — 2026-10-29 (night): welcome launcher + motion fixes, all gates green

Re-ran all 14 gates after adding the pre-boot welcome launcher (`src/components/launch-screen.tsx` + `LaunchGate` in `src/main.tsx`) and a reduced-motion fix for the launcher emblem:

- Launcher: isolate / approve / verify pillars, live mission count via `useCountUp`, single "Enter Mission Control" action (Enter/Space), once per session via `orrery.launched` flag, skipped automatically in packaged smoke mode (`reportSmokeReadiness` present) so the readiness gate never waits on a click. Shell and boot tests render `AppShell` directly, untouched by the gate.
- Fix: the universal `prefers-reduced-motion` kill-switch zeroed the launcher emblem's entrance animation but left its base `opacity: 0` — the emblem was invisible in reduced-motion browsers (including the review harness). The reduced-motion block now pins `.launch-orrery` to its final resting state, matching the boot sequence's treatment. Verified live at opacity 0.95 after reload.
- `e2e/mission-flow.spec.ts` gains an `enterMissionControl` click-through after each fresh-context load.

- `typecheck` **PASS** — clean.
- `npx vitest run` **PASS** — 62 files, 804 passed, 4 skipped (includes the new 4-test `launch-screen.test.tsx`).
- `npm run build` **PASS** — no warnings.
- `mission:smoke` / `daemon:smoke` **PASS** — pass lines printed.
- `desktop:build` **PASS**; `desktop:package` **PASS** (with `ORRERY_UNSIGNED_LOCAL=1`); `desktop:smoke` **PASS** ("Packaged desktop smoke passed.").
- `test:e2e` **PASS** — 3/3 Playwright specs.
- `theia:typecheck` **PASS**; `theia:test` **PASS** (203/203); `theia-app:typecheck` **PASS**; `theia-app:test` **PASS** (39/39; known non-fatal `disconnect failed` teardown noise unchanged); `theia-app:smoke` **PASS**.

**Tally: 14/14 PASS.** Remaining noise: none blocking.

## Concerns for release

- **Packaged desktop app is unverified end-to-end:** `desktop:package` succeeds but `desktop:smoke` fails, so the shipped `.exe` has no green startup check on this machine. Do not treat the desktop artifact as release-verified until the smoke failure is root-caused (likely needs a GUI-capable machine or a main-process log).
- **Theia suite has an install-time Electron gap:** one structural suite cannot load until Electron is installed in the extension workspace; the remaining 189 tests are green.
- **Non-blocking warnings worth a later cleanup:** the `@import must precede all other statements` postcss warning appears in both `build` and the e2e webserver output (`mission-replay-debugger.css` imported mid-file), and `theia-app:test` prints `Error: disconnect failed` teardown noise while passing.
