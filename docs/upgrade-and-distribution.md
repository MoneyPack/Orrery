# Upgrade and Distribution Policy

This document records the maintenance decisions that are easy to lose track of because
they are enforced nowhere in code.

## Theia and Electron pins

- The Theia extension and host are pinned to **Theia 1.75.0** and **Electron 42.8.1**
  (`theia-extensions/mission-control/package.json`, `theia-app/package.json`).
- Theia releases monthly. The Electron version must always be the one the pinned Theia
  release declares as its peer/supported version — bump them together, never independently.
- **Cadence:** review Theia releases quarterly. Do not let the pin fall more than two
  minor Theia versions behind latest; older pins stop receiving Electron security fixes.
- **Upgrade procedure:** bump all `@theia/*` packages and `electron` in both package.json
  files, reinstall via `npm run theia-app:install` (which rebuilds the native modules
  `@theia/ffmpeg`, `native-keymap`, `drivelist`), then run `theia:typecheck`,
  `theia:test`, `theia-app:test`, and `theia-app:smoke`.
- The root Electron shell (`electron/`, package.json `devDependencies.electron`) tracks
  current stable Electron and is independent of the Theia pin.

## Unsigned artifacts

`electron-builder.config.cjs` deliberately disables signing (`forceCodeSigning: false`,
`signAndEditExecutable: false`, `identity: null`). Produced installers are for **local
validation only**:

- Windows SmartScreen and macOS Gatekeeper will warn or block these binaries for anyone
  else.
- Before any external distribution (public releases, auto-update, or sharing outside the
  development machine), obtain code-signing identities (EV/OV certificate for Windows,
  Apple Developer ID for macOS + notarization), re-enable signing in the builder config,
  and add a CI check that signing stays enabled on release builds.
- Do not publish the unsigned artifacts to any public release channel.

## Install scripts

`theia-app/scripts/install.mjs` uses `npm ci --ignore-scripts` to prevent arbitrary
install-time code execution, then rebuilds the three known native modules explicitly. If a
future dependency ships an install script that is actually required, add an explicit
`npm rebuild <pkg>` line there rather than dropping `--ignore-scripts`.
