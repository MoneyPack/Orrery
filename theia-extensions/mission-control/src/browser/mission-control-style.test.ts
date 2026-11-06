import { describe, expect, it } from "vitest";
import { ensureMissionControlStyle, MISSION_CONTROL_STYLE } from "./mission-control-style";

describe("Mission Control design contract", () => {
  it("injects the stylesheet exactly once per document", () => {
    const created: Array<{ id: string; textContent: string }> = [];
    const head = { appendChild: (node: { id: string; textContent: string }) => created.push(node) };
    const target = {
      getElementById: (id: string) => created.find(node => node.id === id) ?? null,
      createElement: () => ({ id: "", textContent: "" }),
      head,
    } as unknown as Document;
    ensureMissionControlStyle(target);
    ensureMissionControlStyle(target);
    expect(created).toHaveLength(1);
    expect(created[0].id).toBe("orrery-mission-control-style");
    expect(created[0].textContent).toBe(MISSION_CONTROL_STYLE);
  });

  it("tolerates a missing document", () => {
    expect(() => ensureMissionControlStyle(undefined)).not.toThrow();
  });

  it("follows theme variables instead of hardcoded brand colors", () => {
    expect(MISSION_CONTROL_STYLE).toContain("var(--theia-foreground)");
    expect(MISSION_CONTROL_STYLE).toContain("var(--theia-editorGroup-border)");
    expect(MISSION_CONTROL_STYLE.replace(/var\(--theia-focusBorder, #3794ff\)|#3794ff/g, "")).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("animates only compositor-friendly properties and never uses transition: all", () => {
    expect(MISSION_CONTROL_STYLE).not.toMatch(/transition:\s*all/);
    expect(MISSION_CONTROL_STYLE).toMatch(/transition-property:\s*transform, background-color, color, opacity/);
  });

  it("marks the mission states a reviewer must notice", () => {
    expect(MISSION_CONTROL_STYLE).toMatch(/__status--ready_for_review[\s\S]*?editorWarning-foreground/);
    expect(MISSION_CONTROL_STYLE).toMatch(/__status--failed[\s\S]*?errorForeground/);
    expect(MISSION_CONTROL_STYLE).toMatch(/__status--accepted[\s\S]*?addedResourceForeground/);
  });

  it("keeps a visible focus ring on every interactive control", () => {
    for (const selector of ["__field input:focus-visible", "__field select:focus-visible", "__field textarea:focus-visible", "button:focus-visible"]) {
      expect(MISSION_CONTROL_STYLE).toContain(selector);
    }
    expect(MISSION_CONTROL_STYLE).toContain("var(--theia-focusBorder)");
  });

  it("gates hover behind a real pointer and keeps a press affordance", () => {
    expect(MISSION_CONTROL_STYLE).toContain("@media (hover: hover) and (pointer: fine)");
    expect(MISSION_CONTROL_STYLE).toMatch(/button:active:not\(:disabled\) \{ transform: scale\(0\.97\); \}/);
  });

  it("uses concentric radii and tabular figures like the other Orrery surfaces", () => {
    expect(MISSION_CONTROL_STYLE).toContain("--orrery-radius-outer: 7px");
    expect(MISSION_CONTROL_STYLE).toContain("--orrery-radius-inner: 4px");
    expect(MISSION_CONTROL_STYLE).toContain("font-variant-numeric: tabular-nums");
  });

  it("wraps paths and branch names instead of letting them break the layout", () => {
    expect(MISSION_CONTROL_STYLE).toMatch(/__facts dd \{[\s\S]*?overflow-wrap: anywhere;/);
    expect(MISSION_CONTROL_STYLE).toMatch(/__changes code \{[\s\S]*?overflow-wrap: anywhere;/);
  });

  it("honors a reduced-motion preference", () => {
    const reduced = MISSION_CONTROL_STYLE.slice(MISSION_CONTROL_STYLE.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain("orrery-mission-control-fade");
    expect(reduced).toMatch(/button:active:not\(:disabled\) \{ transform: none; \}/);
  });
});
