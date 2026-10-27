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

## Concerns for release

- **Packaged desktop app is unverified end-to-end:** `desktop:package` succeeds but `desktop:smoke` fails, so the shipped `.exe` has no green startup check on this machine. Do not treat the desktop artifact as release-verified until the smoke failure is root-caused (likely needs a GUI-capable machine or a main-process log).
- **Theia suite has an install-time Electron gap:** one structural suite cannot load until Electron is installed in the extension workspace; the remaining 189 tests are green.
- **Non-blocking warnings worth a later cleanup:** the `@import must precede all other statements` postcss warning appears in both `build` and the e2e webserver output (`mission-replay-debugger.css` imported mid-file), and `theia-app:test` prints `Error: disconnect failed` teardown noise while passing.
