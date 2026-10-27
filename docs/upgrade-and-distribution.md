# Upgrade and Distribution Policy

This document records the maintenance decisions that are easy to lose track of because
they are enforced nowhere in code.

## Versioning (SemVer, 0.x line)

- Root `package.json` is at **0.1.0** — the first pre-release local-validation line.
  The placeholder `0.0.0` is retired; workspace packages under `packages/*` stay on
  `0.0.0` until they stabilize independently.
- Stay on `0.x` until public 1.0, which is gated on two things: production signing
  identities in place (Windows EV/OV, Apple Developer ID + notarization) and the
  enforcement-matrix fuzzer green. Breaking changes during `0.x` bump the minor
  (`0.1.0` -> `0.2.0`); patches bump the patch segment.
- Tag releases as `v<version>` (e.g. `v0.1.0`). Only signed tags cut from a green
  release-gate run count as releases; anything else is a snapshot.

## Release channels

- **`local` (unsigned, never distributed):** built with `ORRERY_UNSIGNED_LOCAL=1`.
  Same-machine validation only. Never share the binary, never attach it to a release.
- **`internal` (signed, machine-owned certs):** default signed build
  (`forceCodeSigning: true`), SHA256 checksums generated per CI release-gate run.
  For operator / stakeholder validation on known machines.
- **`public` (deferred):** no public channel exists yet. Opening one requires
  procurement of production signing identities plus a green fuzzer run, then a
  decision recorded here. Until then, every build is local or internal.

## Release notes

- Every `v*` tag ships with short notes: what changed, which channel it targets,
  signing/verification status (signer identity + checksum file), and known limitations.
- Notes live with the tag (GitHub release body or `docs/releases/<version>.md` once
  that folder exists — create it on the first internal release, not before).

## Rollback

- Rollback = re-install the prior **signed** tag for the same channel. Unsigned
  local builds are never a rollback target.
- Limitation: the daemon data dir is append-only / single-version (no schema
  downgrade path). Rolling back the binary does not roll back data written by a
  newer version — back up the data dir before upgrading, and say so in the
  release notes while this limitation stands.

## Do not publish unsigned artifacts (enforcement)

- `electron-builder.config.cjs` signs by default; unsigned output requires the
  explicit `ORRERY_UNSIGNED_LOCAL=1` opt-in and prints a do-not-distribute warning.
- The CI `release-gate` job fails if `ORRERY_UNSIGNED_LOCAL=1` is set, asserts the
  signed-by-default config, and generates SHA256 checksums for release artifacts.
  Unsigned binaries must never be attached to a release or published to any channel.

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
