import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MissionProvider } from "../state/mission-context";
import { hasLaunchedThisSession, LaunchGate, LaunchScreen } from "./launch-screen";

function renderLauncher() {
  return render(
    <MissionProvider runtimeDelay={0}>
      <LaunchScreen onEnter={() => undefined} />
    </MissionProvider>,
  );
}

describe("Launch screen", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.useFakeTimers();
  });

  it("opens on the inspirational hero before the shell boots", () => {
    renderLauncher();
    expect(screen.getByRole("dialog", { name: /welcome to orrery/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /delegate the work/i })).toBeInTheDocument();
    expect(screen.getByText("Isolate")).toBeInTheDocument();
    expect(screen.getByText("Approve")).toBeInTheDocument();
    expect(screen.getByText("Verify")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enter mission control/i })).toHaveFocus();
    expect(screen.queryByRole("status", { name: /starting orrery/i })).not.toBeInTheDocument();
  });

  it("enters on click and records the session launch", async () => {
    const onEnter = vi.fn();
    render(
      <MissionProvider runtimeDelay={0}>
        <LaunchScreen onEnter={onEnter} />
      </MissionProvider>,
    );
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /enter mission control/i })); });
    expect(hasLaunchedThisSession()).toBe(true);
    await act(async () => { vi.advanceTimersByTime(420); });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("enters on Enter and skips replay within the session", async () => {
    const { unmount } = renderLauncher();
    expect(screen.getByRole("dialog", { name: /welcome to orrery/i })).toBeInTheDocument();
    await act(async () => { fireEvent.keyDown(window, { key: "Enter" }); });
    await act(async () => { vi.runOnlyPendingTimers(); });
    unmount();

    render(
      <MissionProvider runtimeDelay={0}>
        <LaunchGate><p>mission control</p></LaunchGate>
      </MissionProvider>,
    );
    expect(screen.queryByRole("dialog", { name: /welcome to orrery/i })).not.toBeInTheDocument();
    expect(screen.getByText("mission control")).toBeInTheDocument();
  });

  it("skips the launcher in smoke mode so packaged readiness never waits", () => {
    window.orreryDesktop = { getRuntime: async () => ({ platform: "win32", versions: { chrome: "1", electron: "44.0.0" } }), missions: {} as never, reportSmokeReadiness: async () => undefined };
    try {
      render(
        <MissionProvider runtimeDelay={0}>
          <LaunchGate><p>mission control</p></LaunchGate>
        </MissionProvider>,
      );
      expect(screen.queryByRole("dialog", { name: /welcome to orrery/i })).not.toBeInTheDocument();
      expect(screen.getByText("mission control")).toBeInTheDocument();
    } finally {
      delete window.orreryDesktop;
    }
  });
});
