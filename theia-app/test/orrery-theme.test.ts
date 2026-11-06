import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// The real MonacoThemingService pulls monaco-editor-core and its CSS into the module graph,
// which Node cannot load. The contribution only needs the DI token, so that is all we supply.
vi.mock("@theia/monaco/lib/browser/monaco-theming-service", () => ({ MonacoThemingService: Symbol("MonacoThemingService") }));

import {
  ORRERY_DARK_PALETTE,
  ORRERY_DARK_THEME,
  ORRERY_DARK_THEME_ID,
  ORRERY_LIGHT_PALETTE,
  ORRERY_LIGHT_THEME,
  ORRERY_LIGHT_THEME_ID,
  alpha,
  buildOrreryTheme
} from "../host/src/browser/orrery-theme";
import { ORRERY_CHROME_STYLE, ORRERY_CHROME_STYLE_ID, OrreryThemeContribution, ensureOrreryChromeStyle } from "../host/src/browser/orrery-theme-frontend-module";

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;

describe("Orrery workbench themes", () => {
  it.each([
    ["dark", ORRERY_DARK_THEME, ORRERY_DARK_PALETTE],
    ["light", ORRERY_LIGHT_THEME, ORRERY_LIGHT_PALETTE]
  ] as const)("%s theme uses only well-formed hex colours", (_kind, theme, palette) => {
    for (const [key, value] of Object.entries(theme.colors)) expect(value, key).toMatch(HEX);
    for (const token of theme.tokenColors) {
      if (token.settings.foreground) expect(token.settings.foreground, String(token.scope)).toMatch(HEX);
    }
    for (const value of Object.values(palette.ansi)) expect(value).toMatch(HEX);
  });

  it("builds both themes from one structure so no surface is missed in either", () => {
    expect(Object.keys(ORRERY_LIGHT_THEME.colors).sort()).toEqual(Object.keys(ORRERY_DARK_THEME.colors).sort());
    expect(ORRERY_LIGHT_THEME.tokenColors.map(token => token.scope)).toEqual(ORRERY_DARK_THEME.tokenColors.map(token => token.scope));
    expect(ORRERY_DARK_THEME.type).toBe("dark");
    expect(ORRERY_LIGHT_THEME.type).toBe("light");
  });

  it("lands the design-system tokens on the surfaces that define the workbench", () => {
    const c = ORRERY_DARK_THEME.colors;
    expect(c["editor.background"]).toBe(ORRERY_DARK_PALETTE.bg);
    expect(c["activityBar.background"]).toBe(ORRERY_DARK_PALETTE.bgDeep);
    expect(c["sideBar.background"]).toBe(ORRERY_DARK_PALETTE.surface);
    expect(c["statusBar.background"]).toBe(ORRERY_DARK_PALETTE.bgDeep);
    expect(c["button.background"]).toBe(ORRERY_DARK_PALETTE.accent);
    expect(c["focusBorder"]).toBe(ORRERY_DARK_PALETTE.focus);
    expect(c["tab.activeBorderTop"]).toBe(ORRERY_DARK_PALETTE.accent);
    expect(c["terminal.ansiRed"]).toBe(ORRERY_DARK_PALETTE.danger);
    expect(c["gitDecoration.addedResourceForeground"]).toBe(ORRERY_DARK_PALETTE.success);
    // The marketplace Install button is the most-clicked control in the Extensions view.
    expect(c["extensionButton.prominentBackground"]).toBe(ORRERY_DARK_PALETTE.accent);
    expect(c["extensionButton.prominentForeground"]).toBe(ORRERY_DARK_PALETTE.accentInk);
  });

  it("covers every workbench region plus editor, terminal, diff, git, and syntax", () => {
    const keys = Object.keys(ORRERY_DARK_THEME.colors);
    for (const prefix of ["activityBar.", "sideBar.", "tab.", "editor.", "editorGroup", "panel.", "statusBar.", "titleBar.", "menu.", "terminal.", "diffEditor.", "gitDecoration.", "notifications.", "quickInput", "list.", "input.", "button.", "scrollbarSlider.", "minimap", "breadcrumb", "peekView"]) {
      expect(keys.some(key => key.startsWith(prefix)), prefix).toBe(true);
    }
    expect(keys.length).toBeGreaterThan(300);
    const scopes = ORRERY_DARK_THEME.tokenColors.flatMap(token => (Array.isArray(token.scope) ? token.scope : [token.scope]));
    for (const scope of ["comment", "keyword", "string", "constant.numeric", "entity.name.function", "entity.name.type", "variable", "entity.name.tag", "entity.other.attribute-name", "markup.heading", "markup.inserted", "markup.deleted", "invalid"]) {
      expect(scopes, scope).toContain(scope);
    }
    expect(ORRERY_DARK_THEME.semanticHighlighting).toBe(true);
    expect(Object.keys(ORRERY_DARK_THEME.semanticTokenColors)).toEqual(expect.arrayContaining(["function", "type", "keyword", "string", "comment"]));
  });

  it("derives alpha colours without leaving the hex grammar", () => {
    expect(alpha("#c98a36", 0.22)).toBe("#c98a3638");
    expect(alpha("#c98a36", 1)).toBe("#c98a36ff");
    expect(alpha("#c98a36", 0)).toBe("#c98a3600");
    expect(alpha("#c98a36", 2)).toBe("#c98a36ff");
  });

  it("is a pure function of its palette", () => {
    expect(buildOrreryTheme("A", "dark", ORRERY_DARK_PALETTE)).toEqual(buildOrreryTheme("A", "dark", ORRERY_DARK_PALETTE));
  });
});

describe("Orrery theme contribution", () => {
  it("registers both themes as parsed JSON, dark on vs-dark and light on vs", () => {
    const registerParsedTheme = vi.fn(() => ({ dispose: () => undefined }));
    new OrreryThemeContribution({ registerParsedTheme } as never).initialize();
    expect(registerParsedTheme).toHaveBeenCalledTimes(2);
    expect(registerParsedTheme).toHaveBeenCalledWith(expect.objectContaining({ id: ORRERY_DARK_THEME_ID, uiTheme: "vs-dark", json: ORRERY_DARK_THEME }));
    expect(registerParsedTheme).toHaveBeenCalledWith(expect.objectContaining({ id: ORRERY_LIGHT_THEME_ID, uiTheme: "vs", json: ORRERY_LIGHT_THEME }));
  });

  it("adds the chrome stylesheet once and scopes every rule to the Orrery themes", () => {
    const appended: Array<{ id: string; textContent: string }> = [];
    const target = {
      getElementById: (id: string) => appended.find(node => node.id === id) ?? null,
      createElement: () => ({ id: "", textContent: "" }),
      head: { appendChild: (node: { id: string; textContent: string }) => { appended.push(node); return node; } }
    } as unknown as Document;
    ensureOrreryChromeStyle(target);
    ensureOrreryChromeStyle(target);
    expect(appended).toHaveLength(1);
    expect(appended[0].id).toBe(ORRERY_CHROME_STYLE_ID);
    const selectors = ORRERY_CHROME_STYLE.split("{")[0] ? ORRERY_CHROME_STYLE.match(/^[^@\s{}][^{}]*(?=\{)/gm) ?? [] : [];
    for (const selector of selectors) expect(selector.trim(), selector).toMatch(/^body\.orrery-(dark|light)/);
    expect(ORRERY_CHROME_STYLE).toContain("prefers-reduced-motion");
  });

  it("is composed by the host as a frontend module with the default theme and preference block", () => {
    const host = JSON.parse(readFileSync(resolve("host/package.json"), "utf8"));
    expect(host.theiaExtensions[0].frontend).toBe("lib/browser/orrery-theme-frontend-module");
    expect(host.dependencies["@theia/monaco"]).toBe("1.75.0");
    const app = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    const config = app.theia.frontend.config;
    expect(config.defaultTheme).toBe(ORRERY_DARK_THEME_ID);
    // Theia only applies `defaultTheme` as the `workbench.colorTheme` default when the config
    // carries a `preferences` object (FrontendApplicationPreferenceConfig.is); without it the
    // schema default wins and the workbench opens light.
    expect(config.preferences).toEqual(expect.objectContaining({ "workbench.colorTheme": ORRERY_DARK_THEME_ID }));
    const generated = readFileSync(resolve("src-gen/frontend/index.js"), "utf8");
    expect(generated).toContain('"workbench.colorTheme": "orrery-dark"');
    expect(generated).toContain("@orrery/theia-host/lib/browser/orrery-theme-frontend-module");
  });
});
