import { inject, injectable } from "@theia/core/shared/inversify";
import type { FrontendApplication } from "@theia/core/lib/browser/frontend-application";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser/frontend-application-contribution";
import { FrontendApplicationStateService } from "@theia/core/lib/browser/frontend-application-state";
import { animationFrame } from "@theia/core/lib/browser/browser";
import { MissionControlContribution } from "./mission-control-contribution";
import { OrreryIntelligenceContribution } from "./orrery-intelligence-contribution";
import { OrreryToolsContribution } from "./orrery-tools-contribution";

/** The slice of a Theia side-panel container the refit needs; keeps the logic unit-testable. */
export interface RefittablePanel { fit(): void; update(): void }
export interface RefittableShell {
  readonly leftPanelHandler: { readonly container: RefittablePanel };
  readonly rightPanelHandler: { readonly container: RefittablePanel };
}

/**
 * Re-measures both side panels after startup.
 *
 * A side panel's box layout is first computed while the panel is still collapsed at its 48px
 * tab-bar minimum. When a view opens during layout initialisation the panel expands, but under
 * some startup timings Lumino never re-sends a resize to the box, leaving the tab bar at the
 * wrong edge and the content at its minimum width. Posting fit plus update re-measures from
 * the real node size and is a no-op when the layout was already right.
 */
export function refitSidePanels(shell: RefittableShell): void {
  for (const handler of [shell.leftPanelHandler, shell.rightPanelHandler]) {
    handler.container.fit();
    handler.container.update();
  }
}

/**
 * First-run workbench layout for the Orrery desktop.
 *
 * Theia already owns the VSCode regions — Activity Bar plus Side Bar plus
 * Editor Group plus Panel plus Status Bar come from the composed
 * `@theia/navigator`, `@theia/editor`, `@theia/terminal`, and friends packages.
 * Explorer and Terminal each declare their own `initializeLayout`, so they
 * self-place. This contribution gives the three Orrery views the same
 * treatment: Mission Control left, Intelligence plus Tools right.
 *
 * Runs only when no stored layout exists — `FrontendApplication` calls
 * `initializeLayout` solely on the `createDefaultLayout` path, so a saved
 * user layout is never clobbered.
 */
@injectable()
export class OrreryWorkbenchContribution implements FrontendApplicationContribution {
  constructor(
    @inject(MissionControlContribution) private readonly missions: MissionControlContribution,
    @inject(OrreryIntelligenceContribution) private readonly intelligence: OrreryIntelligenceContribution,
    @inject(OrreryToolsContribution) private readonly tools: OrreryToolsContribution,
    @inject(FrontendApplicationStateService) private readonly state: FrontendApplicationStateService,
  ) {}

  async initializeLayout(_app: FrontendApplication): Promise<void> {
    await this.missions.openView({ activate: false, reveal: true });
    await this.intelligence.openView({ activate: false, reveal: true });
    await this.tools.openView({ activate: false, reveal: true });
  }

  onDidInitializeLayout(app: FrontendApplication): void {
    // Runs for restored layouts too: the race is in panel expansion, not in who opened the view.
    void this.state.reachedState("ready")
      .then(() => animationFrame())
      .then(() => refitSidePanels(app.shell as unknown as RefittableShell));
  }
}
