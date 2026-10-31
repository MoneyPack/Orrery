import { describe, expect, it, vi } from "vitest";
import { MissionControlContribution } from "./mission-control-contribution";
import { OrreryIntelligenceContribution } from "./orrery-intelligence-contribution";
import { OrreryToolsContribution } from "./orrery-tools-contribution";
import { OrreryWorkbenchContribution } from "./orrery-workbench-contribution";

function contributionWith(openView: (args?: unknown) => Promise<unknown>): OrreryWorkbenchContribution {
  const opened: Array<{ view: string; args: unknown }> = [];
  const stub = (view: string) => ({ openView: (args?: unknown) => { opened.push({ view, args }); return openView(args); } });
  const workbench = new OrreryWorkbenchContribution(
    stub("mission-control") as unknown as MissionControlContribution,
    stub("intelligence") as unknown as OrreryIntelligenceContribution,
    stub("tools") as unknown as OrreryToolsContribution,
  );
  (workbench as unknown as { opened: Array<{ view: string; args: unknown }> }).opened = opened;
  return workbench;
}

describe("OrreryWorkbenchContribution", () => {
  it("opens Mission Control plus Intelligence plus Tools without activating them", async () => {
    const openView = vi.fn(async () => undefined);
    const workbench = contributionWith(openView);
    await workbench.initializeLayout({} as never);
    expect(openView).toHaveBeenCalledTimes(3);
    for (const call of openView.mock.calls as Array<readonly [unknown?]>) {
      expect(call[0]).toEqual({ activate: false, reveal: true });
    }
    expect((workbench as unknown as { opened: Array<{ view: string }> }).opened.map(entry => entry.view))
      .toEqual(["mission-control", "intelligence", "tools"]);
  });
});
