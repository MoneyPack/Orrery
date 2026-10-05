import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as contracts from "./common/mission-control-contracts";
import { createMissionControlPreloadApi } from "./electron-browser/mission-control-preload-api";
import { registerMissionControlHostIpc } from "./electron-main/mission-control-electron-main-contribution";

const root = process.cwd().endsWith("mission-control") ? process.cwd() : resolve(process.cwd(), "theia-extensions/mission-control");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/** Every `*_CHANNEL` constant the common contracts export, as runtime values. */
const contractChannels = Object.entries(contracts)
  .filter(([name, value]) => name.endsWith("_CHANNEL") && typeof value === "string")
  .map(([, value]) => value as string);

/**
 * Static `import`/`export ... from` specifiers, parsed from import statements only so that
 * prose, string literals, and dynamic imports cannot trip the check.
 */
function staticImportSpecifiers(source: string): string[] {
  const pattern = /^\s*(?:import\s+(?:type\s+)?(?:[\w${}*,\s]+\s+from\s+)?|export\s+(?:type\s+)?(?:[\w*,\s]|\{[\w\s,]*\})\s+from\s+)["']([^"']+)["']/gm;
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

describe("mission control Theia extension structure", () => {
  it("pins every consumed Theia package to 1.75.0 and exposes frontend, preload, and Electron main modules", () => {
    const manifest = JSON.parse(read("package.json"));
    const theiaVersions = Object.entries({ ...manifest.dependencies, ...manifest.devDependencies }).filter(([name]) => name.startsWith("@theia/"));
    expect(theiaVersions.length).toBeGreaterThan(0);
    expect(theiaVersions.every(([, version]) => version === "1.75.0")).toBe(true);
    expect(manifest.theiaExtensions).toEqual([{
      frontend: "lib/browser/mission-control-frontend-module",
      preload: "lib/electron-browser/mission-control-preload",
      electronMain: "lib/electron-main/mission-control-electron-main-module",
    }]);
    expect(manifest.files).toContain("lib/electron-browser");
    expect(manifest.files).toContain("lib/electron-main");
    expect(Object.values(manifest.dependencies)).not.toContainEqual(expect.stringMatching(/^file:/));
    expect(manifest.dependencies).toEqual({ "@theia/core": "1.75.0", "@theia/electron": "1.75.0" });
  });

  it("keeps browser code outside privileged daemon, kernel, filesystem, process, and Git packages", () => {
    const files = ["mission-control-desktop-adapter.ts", "mission-control-view.tsx", "mission-control-widget.tsx", "mission-control-widget-factory.ts", "mission-control-contribution.ts", "mission-control-frontend-module.ts",
      "orrery-intelligence-adapter.ts", "orrery-intelligence-view.tsx", "orrery-intelligence-widget.tsx", "orrery-intelligence-contribution.ts", "orrery-intelligence-style.ts",
      "orrery-tools-adapter.ts", "orrery-tools-view.tsx", "orrery-tools-widget.tsx", "orrery-tools-contribution.ts", "orrery-tools-style.ts"];
    const forbidden = /^(?:@theia\/electron|electron|react|react-dom|node:.*|fs|process|child_process|isomorphic-git|simple-git)$/;
    const forbiddenPrefix = /^@orrery\/(mission-control-daemon|mission-kernel)$/;
    for (const file of files) {
      const specifiers = staticImportSpecifiers(read(`src/browser/${file}`));
      expect(specifiers.filter((specifier) => forbidden.test(specifier) || forbiddenPrefix.test(specifier)), file).toEqual([]);
    }
  });

  it("never reads, stores, or transports provider credentials in renderer code", () => {
    const sources = ["orrery-intelligence-adapter.ts", "orrery-intelligence-view.tsx", "orrery-intelligence-widget.tsx"].map(file => read(`src/browser/${file}`)).join("\n");
    expect(sources).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    expect(sources).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource/);
    expect(sources).not.toMatch(/Bearer\s+\$|["']x-api-key["']|authorization\s*:/i);
    expect(sources).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    expect(read("src/browser/orrery-intelligence-view.tsx")).toMatch(/type="password"/);
  });

  it("mounts Orrery Intelligence in the right shell with its own command and durable transcript", () => {
    expect(read("src/common/mission-control-commands.ts")).toContain("orrery.intelligence.open");
    expect(read("src/browser/orrery-intelligence-contribution.ts")).toMatch(/area:\s*["']right["']/);
    expect(read("src/browser/orrery-intelligence-widget.tsx")).toContain("extends ReactWidget");
    expect(read("src/browser/orrery-intelligence-adapter.ts")).toContain("window.orreryMissionControl");
  });

  it("defines stable typed command IDs and a ReactWidget contribution in the left shell", () => {
    expect(read("src/common/mission-control-commands.ts")).toContain("orrery.missionControl.open");
    expect(read("src/browser/mission-control-widget.tsx")).toContain("extends ReactWidget");
    expect(read("src/browser/mission-control-contribution.ts")).toMatch(/area:\s*["']left["']/);
  });

  it("uses Theia shared React and reads only the narrowed host capability", () => {
    const sources = read("src/browser/mission-control-view.tsx") + read("src/browser/mission-control-widget.tsx") + read("src/browser/mission-control-desktop-adapter.ts");
    expect(sources).toContain("@theia/core/shared/react");
    expect(sources).not.toMatch(/from ["']react["']/);
    expect(sources).toContain("window.orreryMissionControl");
    expect(sources).not.toContain("window.orreryDesktop");
  });

  it("builds the packaged preload and Electron main entry points the manifest advertises", () => {
    const manifest = JSON.parse(read("package.json"));
    const metadata = manifest.theiaExtensions[0] as Record<"frontend" | "preload" | "electronMain", string>;
    for (const path of Object.values(metadata)) {
      expect(existsSync(resolve(root, `${path}.js`)), path).toBe(true);
    }
    expect(read("README.md")).toContain("It is an extension package, not a standalone application or distribution.");
  });

  it("publishes exactly the contract channel surface through the preload API", async () => {
    const call = vi.fn().mockResolvedValue(undefined);
    const api = createMissionControlPreloadApi(call);
    expect(Object.keys(api)).toEqual([
      "intakeRepository", "create", "run", "cancel", "list", "getSnapshot", "inspect", "reviewAndPromote",
      "getIntelligenceSettings", "setIntelligenceSettings", "listIntelligenceMessages", "sendIntelligenceMessage", "clearIntelligenceThread", "getIntelligenceTurnStatus", "cancelIntelligenceTurn",
      "listMcpCatalog", "registerMcpServer", "removeMcpServer", "setMcpToolDecision", "invokeMcpTool", "listMcpActivity",
    ]);

    // Every method must reach its contract channel exactly once, and every contract channel
    // must be reachable from the bridge: together the two loops prove the preload surface and
    // the contract surface are the same set, with no stray channel ever emitted.
    for (const key of Object.keys(api) as Array<keyof typeof api>) {
      await (api[key] as (input?: unknown) => Promise<unknown>)({});
    }
    expect(new Set(call.mock.calls.map(([channel]) => channel))).toEqual(new Set(contractChannels));
    expect(call.mock.calls.map(([channel]) => channel).sort()).toEqual([...contractChannels].sort());
  });

  it("keeps the preload entry free of renderer-only static imports", () => {
    // A preload bundle runs in a sandboxed context before the renderer exists, so pulling in
    // React or Theia frontend packages would break the sandbox. Only static import statements
    // are checked, so a doc comment or a dynamic import cannot trip this.
    for (const file of ["mission-control-preload.ts", "mission-control-preload-api.ts"]) {
      const specifiers = staticImportSpecifiers(read(`src/electron-browser/${file}`));
      const forbidden = specifiers.filter((specifier) => specifier === "react" || specifier === "react-dom" || specifier.startsWith("react/") || specifier.startsWith("@theia/"));
      expect(forbidden, file).toEqual([]);
    }
    // The Electron bridge itself is the one privileged import the preload is allowed.
    expect(staticImportSpecifiers(read("src/electron-browser/mission-control-preload.ts"))).toContain("electron");
  });

  it("keeps every contract channel unique, namespaced, and registered exactly once in Electron main", () => {
    expect(contractChannels.length).toBeGreaterThan(0);
    expect(new Set(contractChannels).size).toBe(contractChannels.length);
    for (const channel of contractChannels) {
      expect(channel).toMatch(/^(mission|intelligence|mcp):v1:[a-z-]+$/);
    }

    const registered: string[] = [];
    const ipcMain = {
      removeHandler: (channel: string) => { const index = registered.indexOf(channel); if (index >= 0) registered.splice(index, 1); },
      handle: (channel: string) => { registered.push(channel); },
    };
    // The handler map is built entirely from constants, so the registered keys are fixed
    // regardless of what the host does; a stub host keeps this a pure wiring assertion.
    const host = new Proxy({}, { get: () => vi.fn() });
    registerMissionControlHostIpc(ipcMain as never, host as never);
    expect(registered.length).toBe(new Set(registered).size);
    expect([...registered].sort()).toEqual(["mission:v1:host-ready", ...contractChannels].sort());
  });

  it("keeps MCP transport and consent out of the extension and the renderer", () => {
    const contribution = read("src/electron-main/mission-control-electron-main-contribution.ts");
    const contractsSource = read("src/common/mission-control-contracts.ts");
    const api = read("src/electron-browser/mission-control-preload-api.ts");
    // Spawning, sockets, and the consent modal belong to Electron main, never here.
    // Matches code constructs only, so prose in doc comments does not trip this.
    expect(contribution + contractsSource + api).not.toMatch(/\bspawn\s*\(|StdioMcpTransport|HttpMcpTransport|\bnew BrowserWindow\b|"jsonrpc"/);
    // The renderer's view of a server must expose a redacted origin, never a command or URL.
    const status = contractsSource.slice(contractsSource.indexOf("interface McpServerStatus"), contractsSource.indexOf("interface McpToolStatus"));
    expect(status).toMatch(/readonly origin: string/);
    // Field declarations only, so the doc comment explaining what `origin` holds does not trip this.
    expect(status).not.toMatch(/readonly (command|endpoint|args)\b/);
    // Registering a server, granting a standing permission, and running a tool each show a
    // native modal, so all three must be window-bound rather than passed through `guarded`.
    expect(contribution).toContain("context.invokeMcpTool(parseMcpInvoke(values[0]))");
    expect(contribution).toContain("context.registerMcpServer(parseMcpRegister(values[0]))");
    expect(contribution).toContain("context.setMcpToolDecision(parseMcpSetDecision(values[0]))");
    expect(contribution).not.toMatch(/guarded\(parseMcpInvoke|guarded\(parseMcpRegister|guarded\(parseMcpSetDecision/);
  });

  it("binds a chat turn to its window, because the model may request a gated tool call", () => {
    const contribution = read("src/electron-main/mission-control-electron-main-contribution.ts");
    expect(contribution).toContain("context.sendIntelligenceMessage(parseIntelligenceSend(values[0]))");
    // `guarded` has no window, so it could not raise the native confirmation a tool call needs.
    expect(contribution).not.toMatch(/guarded\(parseIntelligenceSend/);
  });

  it("renders the tool surface without trusting server output or reaching a transport", () => {
    const sources = ["orrery-tools-adapter.ts", "orrery-tools-view.tsx", "orrery-tools-widget.tsx"].map(file => read(`src/browser/${file}`)).join("\n");
    // Untrusted tool output must never become markup, and the renderer must never speak to a server itself.
    expect(sources).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    expect(sources).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|"jsonrpc"/);
    expect(sources).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    // Every effectful path goes through the narrow preload capability, which raises a native modal in main.
    expect(read("src/browser/orrery-tools-adapter.ts")).toContain("window.orreryMissionControl");
    // Server output is rendered inside a <pre> as text, so escaping is not load-bearing on a formatter.
    expect(read("src/browser/orrery-tools-view.tsx")).toMatch(/<pre className="orrery-tools__output">\{state\.lastResult\.content\}<\/pre>/);
  });

  it("mounts Orrery Tools in the right shell with its own command", () => {
    expect(read("src/common/mission-control-commands.ts")).toContain("orrery.tools.open");
    expect(read("src/browser/orrery-tools-contribution.ts")).toMatch(/area:\s*["']right["']/);
    expect(read("src/browser/orrery-tools-widget.tsx")).toContain("extends ReactWidget");
    expect(read("src/browser/orrery-tools-view.tsx")).toContain("@theia/core/shared/react");
    expect(read("src/browser/orrery-tools-view.tsx")).not.toMatch(/from ["']react["']/);
  });
});
