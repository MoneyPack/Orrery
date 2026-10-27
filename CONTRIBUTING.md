# Contributing to Orrery Mission Control

Local-first desktop app. Small, reviewed, tested changes beat big ones.

## Quick start

```bash
npm install
npm run dev          # renderer on Vite
npm run typecheck    # must be clean before every commit
npm test -- --run    # full unit + component suite
```

## Ground rules

- **One concern per commit.** Conventional messages: `feat:`, `fix:`, `refactor:`, `docs:`, `ci:`, `chore:`, `test:`.
- **Typecheck is the gate.** `npm run typecheck` must pass; CI runs it on ubuntu + windows.
- **Tests prove behavior.** New logic ships with tests that fail without the fix and pass with it. 780+ tests today — keep them green.
- **Framework-free domain.** `packages/mission-control-domain` must never import node, electron, or UI code — `index.test.ts` enforces this. Put policy there, wiring elsewhere.
- **Never weaken a security check to make a test pass.** If a containment, signing, or permission test fails, the test is telling you something — ask before loosening.
- **Docs for decisions.** Trust-boundary or security tradeoff? Write or update an ADR in `docs/superpowers/adrs/` (see `README.md` there).

## Before opening a PR

1. `npm run typecheck`
2. Focused tests for what you changed, then `npm test -- --run`
3. Relevant smokes: `npm run mission:smoke`, `npm run daemon:smoke`
4. Link the spec or plan in `docs/superpowers/` if one exists.

## Release channels

`local` (unsigned, never distributed) vs `internal` (signed, known machines) vs `public` (deferred — needs procurement + green fuzzer). Details: [`docs/upgrade-and-distribution.md`](docs/upgrade-and-distribution.md).
