import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import axe from "axe-core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { MissionProvider } from "../state/mission-context";
import { AppShell } from "./app-shell";

function renderApp() {
  return render(
    <MissionProvider runtimeDelay={0}>
      <AppShell />
    </MissionProvider>,
  );
}

async function expectNoSeriousViolations(container: HTMLElement) {
  // color-contrast is unreliable under jsdom: it requires real layout and computed paint,
  // which jsdom does not implement, so it false-positives on themed custom properties.
  const results = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  const serious = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  expect(serious.map((violation) => violation.id)).toEqual([]);
}

async function createMission(user: ReturnType<typeof userEvent.setup>, title = "Audit keyboard paths") {
  await user.click(screen.getByRole("button", { name: "New mission" }));
  await user.type(screen.getByLabelText("Mission title"), title);
  await user.type(screen.getByLabelText("Goal"), "Reach every control without a pointer");
  await user.click(screen.getByRole("button", { name: "Create mission" }));
}

async function prepareDraftPlan(user: ReturnType<typeof userEvent.setup>) {
  await createMission(user);
  await user.clear(screen.getByLabelText("Scope"));
  await user.type(screen.getByLabelText("Scope"), "Keep the plan editable until approval.");
  await user.clear(screen.getByLabelText("Action 1"));
  await user.type(screen.getByLabelText("Action 1"), "Tab through the dialog");
  await user.clear(screen.getByLabelText("Acceptance criterion 1"));
  await user.type(screen.getByLabelText("Acceptance criterion 1"), "Focus never leaves the modal");
  await user.click(screen.getByRole("button", { name: "Save plan" }));
}

async function prepareReadyForReview(user: ReturnType<typeof userEvent.setup>) {
  await prepareDraftPlan(user);
  await user.click(screen.getByRole("button", { name: "Approve plan" }));
  await user.click(screen.getByRole("button", { name: "Start fixture run" }));
  await screen.findByRole("region", { name: "Permission required" });
  await user.click(screen.getByRole("button", { name: "Deny" }));
  await waitFor(() =>
    expect(screen.getAllByText("Fixture implementation complete. One file changed and verification passed.")).not.toHaveLength(0),
  );
}

function mockMatchMedia(matches: boolean): MockInstance<(query: string) => MediaQueryList> {
  return vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? matches : false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("accessibility (axe-core)", () => {
  // axe.run on a mounted jsdom tree is expensive; give it more than the default 5s budget.
  const AXE_TIMEOUT = 30_000;

  it("reports no critical or serious violations for the welcome state", async () => {
    const { container } = renderApp();
    await expectNoSeriousViolations(container);
  }, AXE_TIMEOUT);

  it("reports no critical or serious violations for the open new-mission dialog", async () => {
    const user = userEvent.setup();
    const { container } = renderApp();
    await user.click(screen.getByRole("button", { name: "New mission" }));
    await screen.findByRole("dialog");
    await expectNoSeriousViolations(container);
  }, AXE_TIMEOUT);

  it("reports no critical or serious violations for a draft plan canvas", async () => {
    const user = userEvent.setup();
    const { container } = renderApp();
    await prepareDraftPlan(user);
    await expectNoSeriousViolations(container);
  }, AXE_TIMEOUT);

  it("reports no critical or serious violations in ready_for_review", async () => {
    const user = userEvent.setup();
    const { container } = renderApp();
    await prepareReadyForReview(user);
    expect(screen.getByRole("button", { name: "Accept mission" })).toBeEnabled();
    await expectNoSeriousViolations(container);
  }, AXE_TIMEOUT);

  it("reports no critical or serious violations for a timeline with events", async () => {
    const user = userEvent.setup();
    const { container } = renderApp();
    await prepareReadyForReview(user);
    const timeline = screen.getByRole("region", { name: /runtime timeline/i });
    expect(within(timeline).getAllByRole("listitem").length).toBeGreaterThan(0);
    await expectNoSeriousViolations(container);
  }, AXE_TIMEOUT);
});

describe("keyboard access", () => {
  it("reaches the New Mission button by tabbing from the top of the document", async () => {
    const user = userEvent.setup();
    renderApp();
    const trigger = screen.getByRole("button", { name: "New mission" });
    (document.body as HTMLElement).focus?.();
    let guard = 0;
    while (document.activeElement !== trigger && guard < 25) {
      await user.tab();
      guard += 1;
    }
    expect(document.activeElement).toBe(trigger);
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("closes the native dialog with Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    renderApp();
    const trigger = screen.getByRole("button", { name: "New mission" });
    await user.click(trigger);
    await screen.findByRole("dialog");
    expect(screen.getByLabelText("Mission title")).toHaveFocus();

    await user.keyboard("{Escape}");

    // The <dialog> node stays mounted; it is closed by removing the `open` attribute, which
    // removes it from the accessibility tree.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe("reduced motion", () => {
  it("gates transitions behind the prefers-reduced-motion media query", () => {
    const sheet = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    expect(sheet).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(sheet).toMatch(/transition-duration: \.01ms !important/);
    expect(sheet).toMatch(/animation-duration: \.01ms !important/);
  });

  it("reports reduced-motion preference through matchMedia when emulated", () => {
    const reduced = mockMatchMedia(true);
    expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
    reduced.mockRestore();
    const animated = mockMatchMedia(false);
    expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(false);
    animated.mockRestore();
  });
});
