# Orrery VSCode Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assemble the isolated Theia host into a VSCode-class workbench with explorer, editor, terminal, palette, and Mission Control side views.

**Architecture:** Keep `theia-extensions/mission-control` lean on `@theia/core` plus `@theia/electron`; widen only `theia-app` with pinned IDE packages so composition supplies files, editor, terminal, and quick-open while Orrery views stay left plus right.

**Tech Stack:** Eclipse Theia 1.75.0, Electron 42.8.1, Node 24.19.0 engines, Inversify DI, React via `@theia/core/shared/react`.

**Spec:** This plan implements the VSCode-remake request from conversation: full IDE layout in `theia-app` with Mission Control side views, verified by typecheck plus tests plus build plus smokes.

## Global Constraints

- Theia packages stay pinned to `1.75.0`; Electron stays `42.8.1`; `theia-app` engines stay Node `24.19.0`.
- Extension keeps no runtime dependency on root packages and no `file:` dependencies.
- Preload exposes only `window.orreryMissionControl` with 21 fixed channels; no raw invoke and no subscription API cross the bridge.
- Electron-main keeps trusted main-frame checks plus window-bound confirmations and strict per-channel parsers.
- Native CSS plus React hooks only; respect `prefers-reduced-motion` and forced-colors.
- Do not weaken settle-time abort proof or signed-by-default release policy.
- Launcher runs before boot sequence; smoke mode skips launcher via `window.orreryDesktop.reportSmokeReadiness`.

---

### Task 1: Widen theia-app composition with IDE packages

**Files:**
- Modify: `theia-app/package.json:21-35`
- Test: `theia-app/test/host.test.ts:19-30`

**Interfaces:**
- Consumes: existing `theia.target electron` frontend config and `ApplicationPackage` discovery.
- Produces: installed `@theia/filesystem`, `@theia/workspace`, `@theia/navigator`, `@theia/editor`, `@theia/monaco`, `@theia/terminal`, `@theia/search-in-workspace`, `@theia/preferences`, `@theia/output`, `@theia/markers` all at `1.75.0` for Task 2 DI resolution.

- [ ] **Step 1: Write the failing test**

```ts
// theia-app/test/host.test.ts — add after discovery test
it("composes explorer plus editor plus terminal plus palette", () => {
  const application = new ApplicationPackage({ projectPath: process.cwd() });
  const frontend = [...application.frontendModules.values()];
  for (const id of [
    "@theia/navigator/lib/browser/navigator-frontend-module",
    "@theia/editor/lib/browser/editor-frontend-module",
    "@theia/terminal/lib/browser/terminal-frontend-module",
  ]) {
    expect(frontend).toContain(id);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix theia-app test -- --run test/host.test.ts`
Expected: FAIL with missing navigator plus editor plus terminal modules

- [ ] **Step 3: Write minimal implementation**

```json
// theia-app/package.json dependencies — add pinned IDE entries
"@theia/filesystem": "1.75.0",
"@theia/workspace": "1.75.0",
"@theia/navigator": "1.75.0",
"@theia/editor": "1.75.0",
"@theia/monaco": "1.75.0",
"@theia/terminal": "1.75.0",
"@theia/preferences": "1.75.0",
"@theia/output": "1.75.0",
"@theia/markers": "1.75.0",
"@theia/search-in-workspace": "1.75.0",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run theia-app:install` then `npm --prefix theia-app test -- --run test/host.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add theia-app/package.json theia-app/package-lock.json theia-app/test/host.test.ts
git commit -m "feat(theia): compose explorer editor terminal palette"
```

### Task 2: Drop stub bindings now that real providers exist

**Files:**
- Modify: `theia-extensions/mission-control/src/browser/mission-control-frontend-module.ts:29-75`
- Test: `theia-extensions/mission-control/src/browser/mission-control-frontend-module.test.ts:43-60`

**Interfaces:**
- Consumes: Task 1 IDE packages providing `QuickAccessRegistry`, `QuickInputService`, and named `PreferenceProvider` bindings.
- Produces: conflict-free frontend container where Mission Control plus Intelligence plus Tools contributions resolve against real Theia services.

- [ ] **Step 1: Write the failing test**

```ts
it("does not stub quick-input or preferences once the workbench provides them", async () => {
  const source = readFileSync(resolve(root, "src/browser/mission-control-frontend-module.ts"), "utf8");
  expect(source).not.toContain("QuickAccessRegistry");
  expect(source).not.toContain("QuickInputService");
  expect(source).not.toContain("DefaultsPreferenceProvider");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix theia-extensions/mission-control test -- --run src/browser/mission-control-frontend-module.test.ts`
Expected: FAIL on stub strings still present

- [ ] **Step 3: Write minimal implementation**

```ts
// delete the QuickAccessRegistry plus QuickInputService constantValue bindings
// and the PreferenceScope DefaultsPreferenceProvider loop;
// keep MissionControlDesktopAdapter plus widget factories plus SmokeViewOpener.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run theia:typecheck` then `npm run theia:test -- --run src/browser/mission-control-frontend-module.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add theia-extensions/mission-control/src/browser/mission-control-frontend-module.ts theia-extensions/mission-control/src/browser/mission-control-frontend-module.test.ts
git commit -m "refactor(theia): use real palette and preferences providers"
```

### Task 3: Update composition assertions for the wider graph

**Files:**
- Modify: `theia-app/test/host.test.ts:19-39`
- Modify: `theia-extensions/mission-control/src/structure.test.ts:26-40`
- Test: `theia-app/scripts/smoke.mjs:99-109`

**Interfaces:**
- Consumes: Task 1 generated `src-gen/backend/electron-main.js` plus `src-gen/frontend/preload.js`.
- Produces: assertions that accept IDE modules while still pinning versions and bridge wiring.

- [ ] **Step 1: Write the failing test**

```ts
expect([...application.electronMainModules.values()]).toEqual(
  expect.arrayContaining([
    "@orrery/mission-control-theia/lib/electron-main/mission-control-electron-main-module",
    "@orrery/theia-host/lib/electron-main/mission-control-host-module",
  ]),
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix theia-app test -- --run test/host.test.ts`
Expected: FAIL on exact-equals before fix

- [ ] **Step 3: Write minimal implementation**

```ts
// replace toEqual with arrayContaining for electronMainModules;
// keep preload assertion as contains for both Orrery entries;
// keep extension structure test pinned to core plus electron only.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix theia-app run generate` then `npm --prefix theia-app test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add theia-app/test/host.test.ts theia-extensions/mission-control/src/structure.test.ts
git commit -m "test(theia): accept wider workbench composition"
```

### Task 4: Verify workbench green

**Files:**
- Verify: `theia-app/package.json`, `theia-extensions/mission-control/package.json`
- Test: `theia-app/test/host.test.ts`, `theia-app/scripts/smoke.mjs`

**Interfaces:**
- Consumes: Tasks 1-3 composition.
- Produces: green typecheck plus tests plus generate plus smoke fallback or full launch.

- [ ] **Step 1: Typecheck extension and host**

Run: `npm run theia:typecheck` then `npm run theia-app:typecheck`
Expected: PASS with no errors

- [ ] **Step 2: Run unit tests**

Run: `npm run theia:test` then `npm --prefix theia-app test`
Expected: PASS

- [ ] **Step 3: Generate plus smoke**

Run: `npm run theia-app:build` then `npm run theia-app:smoke`
Expected: PASS via full launch on Node 24 or explicit fallback validation on Node 26

- [ ] **Step 4: Commit verification fixes only if needed**

```bash
git status --short
```

## Self-Review

- **Spec coverage:** Explorer plus editor plus terminal plus palette plus Mission Control views map to Tasks 1-2; composition assertions map to Task 3; green gates map to Task 4.
- **Placeholder scan:** No TBD plus TODO plus later; every step has exact file plus command plus expected result.
- **Type consistency:** `ApplicationPackage.frontendModules` plus `electronMainModules` names match Theia 1.75 generator output; `MissionControlHostService` binding unchanged.
