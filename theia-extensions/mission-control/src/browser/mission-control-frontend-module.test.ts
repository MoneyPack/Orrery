import { describe, expect, it } from "vitest";
import { Container } from "@theia/core/shared/inversify";
import { WidgetFactory, WidgetManager } from "@theia/core/lib/browser/widget-manager";
import { ApplicationShell } from "@theia/core/lib/browser/shell/application-shell";
import { QuickAccessRegistry } from "@theia/core/lib/browser/quick-input/quick-access";

// Theia's quick-input module runs browser feature detection at import time, and jsdom does not
// implement the legacy `document.queryCommandSupported`. Stubbing it lets this suite import the
// real module graph rather than a mock, so the bindings under test are the shipped ones.
if (typeof document !== "undefined" && !document.queryCommandSupported) {
  (document as unknown as { queryCommandSupported: () => boolean }).queryCommandSupported = () => false;
}

const { default: frontendModule } = await import("./mission-control-frontend-module");
const { MISSION_CONTROL_WIDGET_ID } = await import("./mission-control-widget");
const { ORRERY_INTELLIGENCE_WIDGET_ID } = await import("./orrery-intelligence-widget");
const { ORRERY_TOOLS_WIDGET_ID } = await import("./orrery-tools-widget");
const { MissionControlContribution } = await import("./mission-control-contribution");
const { OrreryIntelligenceContribution } = await import("./orrery-intelligence-contribution");
const { OrreryToolsContribution } = await import("./orrery-tools-contribution");

const factories = () => {
  const container = new Container();
  container.load(frontendModule);
  return container.getAll<WidgetFactory>(WidgetFactory);
};

describe("mission control frontend container module", () => {
  it("registers one widget factory per view without unbound constructor dependencies", () => {
    expect(() => factories()).not.toThrow();
    expect(factories().map(factory => factory.id).sort()).toEqual([ORRERY_INTELLIGENCE_WIDGET_ID, ORRERY_TOOLS_WIDGET_ID, MISSION_CONTROL_WIDGET_ID].sort());
  });

  it.each([MISSION_CONTROL_WIDGET_ID, ORRERY_INTELLIGENCE_WIDGET_ID, ORRERY_TOOLS_WIDGET_ID])("creates a fresh %s widget after the previous widget is disposed", async (id) => {
    const factory = factories().find(candidate => candidate.id === id)!;
    const first = await factory.createWidget();
    first.dispose();
    const second = await factory.createWidget();
    expect(second).not.toBe(first);
    expect(second.isDisposed).toBe(false);
  });

  it("binds the first-run workbench layout alongside the widget factories", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const root = process.cwd().endsWith("mission-control") ? process.cwd() : resolve(process.cwd(), "theia-extensions/mission-control");
    const source = readFileSync(resolve(root, "src/browser/mission-control-frontend-module.ts"), "utf8");
    // Bound via toService so Theia calls initializeLayout on first run and
    // opens Mission Control plus Intelligence plus Tools beside Explorer.
    expect(source).toContain("OrreryWorkbenchContribution");
    expect(source).toContain("FrontendApplicationContribution).toService(OrreryWorkbenchContribution");
  });

  it("leaves quick-input to the workbench instead of stubbing it", async () => {
    // The wider application now composes @theia/monaco, which owns QuickAccessRegistry.
    // This module must not rebind that symbol: a local stub would shadow the real palette.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const root = process.cwd().endsWith("mission-control") ? process.cwd() : resolve(process.cwd(), "theia-extensions/mission-control");
    const source = readFileSync(resolve(root, "src/browser/mission-control-frontend-module.ts"), "utf8");
    expect(source).not.toContain("QuickAccessRegistry");
    expect(source).not.toContain("QuickInputService");
    expect(source).not.toContain("DefaultsPreferenceProvider");
  });
});
