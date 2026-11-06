import { describe, expect, it, vi } from "vitest";
import type { FrontendApplicationStateService } from "@theia/core/lib/browser/frontend-application-state";
import { MissionControlContribution } from "./mission-control-contribution";
import { OrreryIntelligenceContribution } from "./orrery-intelligence-contribution";
import { OrreryToolsContribution } from "./orrery-tools-contribution";
import { OrreryWorkbenchContribution, refitSidePanels } from "./orrery-workbench-contribution";

function workbenchWith(openView: (args?: unknown) => Promise<unknown>, reachedState: () => Promise<void> = async () => undefined) {
  const opened: Array<{ view: string; args: unknown }> = [];
  const stub = (view: string) => ({ openView: (args?: unknown) => { opened.push({ view, args }); return openView(args); } });
  const workbench = new OrreryWorkbenchContribution(
    stub("mission-control") as unknown as MissionControlContribution,
    stub("intelligence") as unknown as OrreryIntelligenceContribution,
    stub("tools") as unknown as OrreryToolsContribution,
    { reachedState } as unknown as FrontendApplicationStateService,
  );
  return { workbench, opened };
}

describe("OrreryWorkbenchContribution", () => {
  it("opens Mission Control plus Intelligence plus Tools without activating them", async () => {
    const openView = vi.fn(async () => undefined);
    const { workbench, opened } = workbenchWith(openView);
    await workbench.initializeLayout({} as never);
    expect(openView).toHaveBeenCalledTimes(3);
    for (const call of openView.mock.calls as Array<readonly [unknown?]>) {
      expect(call[0]).toEqual({ activate: false, reveal: true });
    }
    expect(opened.map(entry => entry.view)).toEqual(["mission-control", "intelligence", "tools"]);
  });

  it("re-measures both side panels once the application is ready", async () => {
    const left = { fit: vi.fn(), update: vi.fn() };
    const right = { fit: vi.fn(), update: vi.fn() };
    let ready!: () => void;
    const reachedState = vi.fn(() => new Promise<void>(resolve => { ready = resolve; }));
    const { workbench } = workbenchWith(async () => undefined, reachedState);
    workbench.onDidInitializeLayout({ shell: { leftPanelHandler: { container: left }, rightPanelHandler: { container: right } } } as never);
    expect(reachedState).toHaveBeenCalledWith("ready");
    expect(right.fit).not.toHaveBeenCalled();
    ready();
    await vi.waitFor(() => expect(right.update).toHaveBeenCalledOnce());
    expect(right.fit).toHaveBeenCalledOnce();
    expect(left.fit).toHaveBeenCalledOnce();
    expect(left.update).toHaveBeenCalledOnce();
  });

  it("refits by posting fit before update on each panel", () => {
    const calls: string[] = [];
    const panel = (name: string) => ({ fit: () => calls.push(`${name}.fit`), update: () => calls.push(`${name}.update`) });
    refitSidePanels({ leftPanelHandler: { container: panel("left") }, rightPanelHandler: { container: panel("right") } });
    expect(calls).toEqual(["left.fit", "left.update", "right.fit", "right.update"]);
  });
});
