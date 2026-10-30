import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissionProvider } from "../state/mission-context";
import { AppShell } from "./app-shell";
import { hasBootedThisSession } from "./boot-sequence";

function renderBooting() {
  return render(
    <MissionProvider runtimeDelay={0}>
      <AppShell boot />
    </MissionProvider>,
  );
}

describe("Boot sequence", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("shows live telemetry and hands off to the shell on its own", async () => {
    window.localStorage.setItem("orrery.theme", "dark");
    renderBooting();
    const boot = screen.getByRole("status", { name: /starting orrery/i });
    expect(boot).toBeInTheDocument();
    expect(boot).toHaveTextContent("orrery.missions.v1");
    expect(boot).toHaveTextContent("00 restored");
    expect(boot).toHaveTextContent("dark / motion");
    expect(screen.getByRole("main")).toHaveClass("welcome-state");

    await act(async () => { vi.advanceTimersByTime(3400); });
    expect(boot).toHaveAttribute("data-phase", "exit");
    await act(async () => { vi.advanceTimersByTime(520); });
    expect(screen.queryByRole("status", { name: /starting orrery/i })).not.toBeInTheDocument();
    expect(hasBootedThisSession()).toBe(true);
  });

  it("skips immediately on Escape and does not replay within the session", async () => {
    const { unmount } = renderBooting();
    expect(screen.getByRole("status", { name: /starting orrery/i })).toBeInTheDocument();
    await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); });
    await act(async () => { vi.advanceTimersByTime(520); });
    expect(screen.queryByRole("status", { name: /starting orrery/i })).not.toBeInTheDocument();
    unmount();

    render(<MissionProvider runtimeDelay={0}><AppShell /></MissionProvider>);
    expect(screen.queryByRole("status", { name: /starting orrery/i })).not.toBeInTheDocument();
  });

  it("reports the desktop bridge when the preload API is present", async () => {
    window.orreryDesktop = {
      getRuntime: async () => ({ platform: "win32", versions: { chrome: "1", electron: "44.0.0" } }),
      missions: {} as never,
    };
    try {
      renderBooting();
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByRole("status", { name: /starting orrery/i })).toHaveTextContent("electron 44.0.0 / win32");
    } finally {
      delete window.orreryDesktop;
    }
  });
});
