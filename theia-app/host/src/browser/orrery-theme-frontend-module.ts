import { ContainerModule, inject, injectable } from "@theia/core/shared/inversify";
import { FrontendApplicationContribution } from "@theia/core/lib/browser/frontend-application-contribution";
import { MonacoThemingService } from "@theia/monaco/lib/browser/monaco-theming-service";
import { ORRERY_DARK_THEME, ORRERY_DARK_THEME_ID, ORRERY_LIGHT_THEME, ORRERY_LIGHT_THEME_ID } from "./orrery-theme";

export const ORRERY_CHROME_STYLE_ID = "orrery-chrome-style";

/**
 * Chrome polish that colours alone cannot express. Scoped to the Orrery themes so switching to
 * a stock Theia theme restores stock chrome. Font stacks fall back gracefully when Inter or
 * JetBrains Mono are not installed; the design intent survives on Segoe UI plus Cascadia.
 */
export const ORRERY_CHROME_STYLE = `
body.orrery-dark, body.orrery-light {
  --theia-ui-font-family: Inter, "Segoe UI", system-ui, -apple-system, sans-serif;
  --theia-code-font-family: "JetBrains Mono", "Cascadia Code", "SFMono-Regular", Consolas, monospace;
  --orrery-ease-out: cubic-bezier(.22, 1, .36, 1);
  font-feature-settings: "cv11", "ss01", "tnum";
  -webkit-font-smoothing: antialiased;
}
body.orrery-dark .theia-sidepanel-title,
body.orrery-light .theia-sidepanel-title,
body.orrery-dark .theia-view-container-part-title .theia-view-container-part-label,
body.orrery-light .theia-view-container-part-title .theia-view-container-part-label {
  font-family: var(--theia-code-font-family);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: .13em;
  text-transform: uppercase;
}
body.orrery-dark .lm-TabBar-tab,
body.orrery-light .lm-TabBar-tab {
  transition: background-color 140ms var(--orrery-ease-out), color 140ms var(--orrery-ease-out);
}
body.orrery-dark .lm-TabBar-tab.lm-mod-current::before,
body.orrery-light .lm-TabBar-tab.lm-mod-current::before {
  content: "";
  position: absolute;
  left: 0; right: 0; top: 0;
  height: 2px;
  background: var(--theia-tab-activeBorderTop);
}
body.orrery-dark .theia-statusBar,
body.orrery-light .theia-statusBar {
  font-family: var(--theia-code-font-family);
  font-size: 10px;
  letter-spacing: .06em;
}
body.orrery-dark .theia-statusBar .element,
body.orrery-light .theia-statusBar .element {
  text-transform: uppercase;
}
body.orrery-dark :focus-visible,
body.orrery-light :focus-visible {
  outline: 2px solid var(--theia-focusBorder);
  outline-offset: 1px;
}
body.orrery-dark .theia-ApplicationShell .lm-SplitPanel-handle,
body.orrery-light .theia-ApplicationShell .lm-SplitPanel-handle {
  transition: background-color 140ms var(--orrery-ease-out);
}
body.orrery-dark .theia-ApplicationShell .lm-SplitPanel-handle:hover,
body.orrery-light .theia-ApplicationShell .lm-SplitPanel-handle:hover {
  background: var(--theia-sash-hoverBorder);
}
@media (prefers-reduced-motion: reduce) {
  body.orrery-dark *, body.orrery-light * {
    transition-duration: .01ms !important;
    animation-duration: .01ms !important;
  }
}
`;

export function ensureOrreryChromeStyle(target: Pick<Document, "getElementById" | "createElement" | "head"> | undefined = typeof document === "undefined" ? undefined : document): void {
  if (!target || target.getElementById(ORRERY_CHROME_STYLE_ID)) return;
  const style = target.createElement("style");
  style.id = ORRERY_CHROME_STYLE_ID;
  style.textContent = ORRERY_CHROME_STYLE;
  target.head.appendChild(style);
}

/**
 * Registers the Orrery colour themes with Theia's Monaco theming service.
 *
 * Registration goes through the parsed-theme path, so the theme JSON is bundled code rather
 * than a file read at startup: there is no file to go missing, and the renderer never asks the
 * backend for it. `ThemeService.register` re-validates the configured theme on every register,
 * so `workbench.colorTheme: orrery-dark` takes effect the moment this runs, regardless of
 * whether preferences became ready before or after.
 */
@injectable()
export class OrreryThemeContribution implements FrontendApplicationContribution {
  constructor(@inject(MonacoThemingService) private readonly theming: MonacoThemingService) {}

  initialize(): void {
    ensureOrreryChromeStyle();
    this.theming.registerParsedTheme({ id: ORRERY_DARK_THEME_ID, label: ORRERY_DARK_THEME.name, uiTheme: "vs-dark", json: ORRERY_DARK_THEME });
    this.theming.registerParsedTheme({ id: ORRERY_LIGHT_THEME_ID, label: ORRERY_LIGHT_THEME.name, uiTheme: "vs", json: ORRERY_LIGHT_THEME });
  }
}

export default new ContainerModule(bind => {
  bind(OrreryThemeContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(OrreryThemeContribution);
});
