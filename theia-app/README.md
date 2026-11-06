# Orrery Theia Electron Host

`@orrery/theia-app` is an isolated Eclipse Theia `1.75.0` Electron application. It assembles the reusable `@orrery/mission-control-theia` package with a host-only package; it is not part of the root npm workspace or the existing Electron 44 shell.

## Workbench

The composition is a VS Code-class workbench: Explorer, Search, Source Control, Debug, Extensions, and Test in the Activity Bar; editor groups, terminal, problems, output, tasks, keymaps, and the settings editor; plus the Orrery views (Mission Control left, Intelligence and Tools right) opened by `OrreryWorkbenchContribution` on first run. Beyond VS Code it also ships Theia's customizable toolbar, live collaboration (`Collaborate` in the status bar), the property view, timeline, and terminal manager.

Extensions run on Theia's VS Code extension host (`@theia/plugin-ext-vscode`) and install from the Open VSX marketplace (`@theia/vsx-registry`). The VS Code builtin extensions (Git, language features, grammars) are bundled: `npm run download:plugins` populates `theia-app/plugins/` from `theiaPlugins` in `package.json`, honouring `theiaPluginsExcludeIds`; `theia-app:install` runs it. The host's electron-main module exports `THEIA_DEFAULT_PLUGINS=local-dir:<app>/plugins` at module load, because the backend is forked before any contribution's `onStart`.

The host package also contributes the `Orrery Dark` and `Orrery Light` themes (`host/src/browser/orrery-theme.ts`, generated from the Mission Control design tokens) and the default preferences under `theia.frontend.config.preferences`. Theia only applies `defaultTheme` as the `workbench.colorTheme` default when that `preferences` object exists; without it the workbench opens light.

## Dependency Boundary

All direct Theia packages are pinned to `1.75.0`, and Electron is pinned to `42.8.1`, the exact peer required by `@theia/electron@1.75.0`. The isolated lockfile resolves the sibling `@orrery/mission-control-theia` package directly. The installer performs clean lock-based installs for both graphs and builds the extension before installing the host, so a clean checkout cannot reuse stale generated declarations.

The host package declares only its `electronMain` composition module. That module:

- binds one singleton daemon client to the extension-local `MissionControlHostService` contract;
- obtains the canonical renderer URL from `ElectronMainApplicationGlobals.THEIA_FRONTEND_HTML_PATH` and returns the exact current Theia main-frame URL;
- selects the actual tracked Theia `BrowserWindow` as the trusted review parent;
- delegates only list, snapshot, and reviewed promotion operations;
- starts no browser-side privileged bridge and disconnects the host-owned daemon during Theia shutdown.

The extension preload remains the only Orrery renderer bridge. It exposes `list`, `getSnapshot`, and `reviewAndPromote`, not filesystem, process, shell, daemon, or generic desktop APIs.

Theia AI (`@theia/ai-core`, `@theia/ai-mcp`) is pulled in by `@theia/plugin-ext` and would be active by default; the host rebinds `AIActivationService` to an inactive implementation so Orrery Intelligence and Orrery Tools remain the only AI and MCP surfaces.

## Packaging

`npm run theia-app:package` (root) runs Theia's production bundle and then electron-builder with `theia-app/electron-builder.config.cjs`, which extends the root config's signing policy — signed by default, `ORRERY_UNSIGNED_LOCAL=1` for a local unsigned build. The layout follows Theia IDE: `lib/` bundles inside an asar with native addons, shell-integration scripts, and the daemon unpacked; `node_modules` excluded; plugins shipped as `resources/app/plugins`. `scripts/electron-main.cjs` is the Electron entry in both layouts and points the plugin deployer at the right directory. `theia-app:make` builds the installer targets; `theia-app:smoke:packaged` launches the built executable and requires every bundled plugin to deploy plus every Mission Control view to render. The development smoke runs the same bundled entry with the same plugin requirement.

Bundled plugins must be unpacked directories: Theia only unzips `.vsix` for user installs and deploys zero system plugins otherwise, which the smoke now reports as a failure instead of passing silently.

## Commands

Run these from the repository root:

```bash
npm run theia-app:install
npm run theia-app:build
npm run theia-app:test
npm run theia-app:smoke
```

`theia-app:install` builds the extension, installs both isolated graphs with `npm ci --ignore-scripts`, and then explicitly rebuilds only Theia's required native modules (`@theia/ffmpeg`, `native-keymap`, and `drivelist`). This keeps lifecycle execution allowlisted and dependency resolution reproducible. On Windows, use Node `24.19.0` or another runtime compatible with the installed MSVC toolchain; Node `26.3.0` currently injects incompatible LLVM LTO flags into these native builds. `theia-app:build` still uses installed `@theia/application-package` and `@theia/application-manager` generator APIs to emit the real `src-gen/backend/electron-main.js` and `src-gen/frontend/preload.js` composition metadata.

On a machine whose default Node is 26, install Node `24.19.0` user-scoped with `fnm` (`winget install Schniz.fnm`, then `fnm install 24.19.0`) and run the Theia commands under `fnm use 24.19.0`; the root project keeps using the default Node. To open the built workbench directly: `theia-app\node_modules\electron\dist\electron.exe theia-app --electronUserData=<dir> <workspace-folder>`.

`theia-app:smoke` first attempts Theia's full native build and Electron launch. If Node 26.3 on Windows cannot prepare the native Theia addons, it prints the exact failure class and falls back explicitly to generated application metadata, preload/main wiring, DI resolution, renderer identity, singleton, and cleanup validation. A fallback is not reported as a real Electron launch.

Generated `node_modules/`, `host/lib/`, `src-gen/`, `lib/`, and `out/` files are ignored. `package-lock.json` is tracked.
