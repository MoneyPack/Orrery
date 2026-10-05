# Mission Control Theia Extension

`@orrery/mission-control-theia` is a composable Eclipse Theia `1.75.0` extension. It contributes a Mission Control frontend view, a narrow Electron preload, and an Electron-main contribution. It is an extension package, not a standalone application or distribution.

## Package Boundary

The package is self-contained and publishable. Its public mission DTOs live in `src/common/mission-control-contracts.ts`; they intentionally duplicate only the narrow serialized shapes needed at the extension boundary — mission lifecycle, redacted intelligence settings/transcript, and redacted MCP catalog/activity. Nothing that crosses the bridge carries provider credentials, server commands, argument vectors, or full endpoint URLs. The package has no runtime dependency on Orrery's root packages and no `file:` dependencies.

All consumed Theia packages are pinned exactly:

```json
{
  "dependencies": {
    "@theia/core": "1.75.0",
    "@theia/electron": "1.75.0"
  }
}
```

The extension's isolated Electron dev dependency is `42.8.1`, matching `@theia/electron@1.75.0`'s peer contract. The root Orrery desktop remains independent.

## Integration Points

Theia `1.75.0`'s installed `@theia/application-package` declares `electronMain` and discovers it through `ApplicationPackage.electronMainModules`. This package declares all three integration points:

- `frontend`: renders the workbench Mission Control, Orrery Intelligence, and Orrery Tools views.
- `preload`: exposes exactly one bridge key, `window.orreryMissionControl`, carrying the 21 fixed-channel methods of `MissionControlPublicApi` (`src/common/mission-control-contracts.ts`) and nothing else — no raw `invoke` handle and no subscription API cross the bridge.
- `electronMain`: registers exactly those 21 channels (plus an internal `mission:v1:host-ready` handshake) during `ElectronMainApplicationContribution.onStart`.

The exposed surface is intentionally flat, and it is grouped into three trust tiers documented on `MissionControlPublicApi`:

- **Missions** — `intakeRepository`, `create`, `run`, `cancel`, `list`, `getSnapshot`, `inspect`, `reviewAndPromote`.
- **Intelligence** — `getIntelligenceSettings`, `setIntelligenceSettings`, `listIntelligenceMessages`, `sendIntelligenceMessage`, `clearIntelligenceThread`, `getIntelligenceTurnStatus`, `cancelIntelligenceTurn`.
- **MCP** — `listMcpCatalog`, `registerMcpServer`, `removeMcpServer`, `setMcpToolDecision`, `invokeMcpTool`, `listMcpActivity`.

This breadth is safe because the preload's main world is trusted first-party Theia frontend code: the bridge reaches only the assembled application's own renderer, and every channel's payload is re-validated in Electron main before delegation. The exact key set is pinned by `src/electron-browser/mission-control-preload.test.ts` and `src/packaging.test.ts`, so any added or removed method fails tests.

Browser code imports no Electron, daemon, kernel, filesystem, process, command, or Git implementation. Electron-main code depends only on Electron IPC, Theia's lifecycle, and the extension-local `MissionControlHostService` contract. It does not import root Electron files or expose generic IPC.

## Assembled Host Adapter

The assembled Orrery Theia application must bind `MissionControlHostService` before Electron-main startup. Missing injection causes startup to fail explicitly rather than leaving a misleading partial tracer:

```ts
import { ContainerModule } from "@theia/core/shared/inversify";
import { MissionControlHostService } from "@orrery/mission-control-theia";

export default new ContainerModule((bind) => {
  bind(MissionControlHostService).toConstantValue({
    getTrustedRendererUrl: () => assembledTheiaWindow.webContents.mainFrame.url,
    // ...the remaining MissionControlPublicApi methods, delegated to daemonClient.
  });
});
```

`daemonClient` should be one constructed or reused `MissionControlDaemonClient` owned by the assembled Orrery host. The adapter belongs in that host, where daemon lifecycle and the actual Theia `BrowserWindow` are available. The trusted URL resolver must return the exact current main-frame URL after Theia loads it; requests from nested frames or any other URL are rejected. Only validated payloads are delegated.

Enforcement lives at the Electron-main boundary in `src/electron-main/mission-control-electron-main-contribution.ts`. Every handler runs `trustedContext`, which requires `event.senderFrame === event.sender.mainFrame` and a non-null host request context before any delegation — anything from a nested frame or an unknown sender is rejected. Effectful calls that can raise a native confirmation (`intakeRepository`, `reviewAndPromote`, `sendIntelligenceMessage`, `registerMcpServer`, `setMcpToolDecision`, `invokeMcpTool`) additionally go through the window-bound `requestContext`, so the confirmation is parented to the exact originating window. Each payload then passes a strict per-channel parser (exact key sets, bounded strings, prototype-polluting identifiers refused, tool arguments bounded by graph traversal) before it reaches the host service.

The isolated assembled host now lives in `../../theia-app`. Its host-only Electron-main module supplies this adapter, tracks Theia's actual main frame/window, owns one daemon client, and performs shutdown cleanup. The existing root Electron host remains an independent product path.

## Verification

```bash
npm run theia:install
npm run theia:typecheck
npm run theia:test
npm run theia:build
npm run theia-app:install
npm run theia-app:build
npm run theia-app:test
npm run theia-app:smoke
```

The extension is excluded from the root npm workspace and uses its own lockfile. Tests verify Theia metadata discovery, strict IPC behavior, browser privilege boundaries, package structure, and installation of an `npm pack` tarball from an unrelated temporary consumer.
